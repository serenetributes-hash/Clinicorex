import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { requireRole } from "../middleware/roles";
import { enqueue } from "../utils/workflow";
import { logAction } from "../utils/audit";

const router = Router();

// Generates the next Medical Record Number from a Postgres sequence, so
// concurrent registrations (two receptionists registering at once) can
// never collide. Create the sequence once via:
//   CREATE SEQUENCE mrn_seq START 1001;
async function nextMrn(): Promise<string> {
  const rows = await prisma.$queryRawUnsafe<{ nextval: bigint }[]>(
    `SELECT nextval('mrn_seq') as nextval`
  );
  return `MRN-${rows[0].nextval}`;
}

const registerSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  dob: z.string().datetime().optional(),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]),
  phone: z.string().optional(),
  nationalId: z.string().optional(),
  insuranceProvider: z.string().optional(),
  insuranceNo: z.string().optional(),
  chiefComplaint: z.string().optional(),
  type: z.enum(["OUTPATIENT", "INPATIENT", "EMERGENCY"]).default("OUTPATIENT"),
});

/**
 * POST /patients/register
 * Registers a brand-new patient and immediately opens their first
 * encounter, which enters the TRIAGE queue for any nurse to pick up.
 */
router.post("/register", requireAuth, requireRole("RECEPTIONIST", "NURSE"), async (req: AuthedRequest, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const d = parsed.data;

  const result = await prisma.$transaction(async (tx) => {
    const mrn = await nextMrn();
    const patient = await tx.patient.create({
      data: {
        mrn,
        firstName: d.firstName,
        lastName: d.lastName,
        dob: d.dob ? new Date(d.dob) : undefined,
        gender: d.gender,
        phone: d.phone,
        nationalId: d.nationalId,
        insuranceProvider: d.insuranceProvider,
        insuranceNo: d.insuranceNo,
      },
    });
    const encounter = await tx.encounter.create({
      data: {
        patientId: patient.id,
        type: d.type,
        status: "TRIAGE",
        chiefComplaint: d.chiefComplaint,
        registeredById: req.user!.id,
      },
    });
    await enqueue(tx, encounter.id, "TRIAGE");
    return { patient, encounter };
  });

  await logAction({
    userId: req.user!.id,
    action: "patient.register",
    entityType: "Patient",
    entityId: result.patient.id,
    details: { encounterId: result.encounter.id },
  });

  res.status(201).json(result);
});

/**
 * POST /patients/:id/visit
 * A returning patient (already has an MRN) is starting a new encounter —
 * avoids creating duplicate patient records for people who've been seen
 * before.
 */
router.post("/:id/visit", requireAuth, requireRole("RECEPTIONIST", "NURSE"), async (req: AuthedRequest, res) => {
  const patient = await prisma.patient.findUnique({ where: { id: req.params.id } });
  if (!patient) return res.status(404).json({ error: "Patient not found" });

  const type = ["OUTPATIENT", "INPATIENT", "EMERGENCY"].includes(req.body?.type) ? req.body.type : "OUTPATIENT";
  const chiefComplaint = typeof req.body?.chiefComplaint === "string" ? req.body.chiefComplaint : undefined;

  const encounter = await prisma.$transaction(async (tx) => {
    const enc = await tx.encounter.create({
      data: {
        patientId: patient.id,
        type,
        status: "TRIAGE",
        chiefComplaint,
        registeredById: req.user!.id,
      },
    });
    await enqueue(tx, enc.id, "TRIAGE");
    return enc;
  });

  res.status(201).json(encounter);
});

/** GET /patients?search=name-or-mrn-or-phone — for reception to find returning patients */
router.get("/", requireAuth, async (req: AuthedRequest, res) => {
  const search = (req.query.search as string) || "";
  const patients = await prisma.patient.findMany({
    where: search
      ? {
          OR: [
            { mrn: { contains: search, mode: "insensitive" } },
            { firstName: { contains: search, mode: "insensitive" } },
            { lastName: { contains: search, mode: "insensitive" } },
            { phone: { contains: search } },
            { nationalId: { contains: search, mode: "insensitive" } },
          ],
        }
      : undefined,
    orderBy: search ? [{ firstName: "asc" }, { lastName: "asc" }] : { createdAt: "desc" },
    take: 25,
  });
  res.json(patients);
});

// Roles that should see full clinical detail (vitals notes, diagnosis,
// consultation notes, lab results, nursing notes) on a patient's profile.
// Reception and cashier still see the visit timeline, status, and billing —
// just not the clinical free-text, since that's not their job to read.
const CLINICAL_ROLES = ["ADMIN", "DOCTOR", "NURSE", "LAB_TECH", "PHARMACIST", "WARD_NURSE"];

/** GET /patients/:id — full history for the patient timeline view */
router.get("/:id", requireAuth, async (req: AuthedRequest, res) => {
  const patient = await prisma.patient.findUnique({
    where: { id: req.params.id },
    include: {
      encounters: {
        orderBy: { registeredAt: "desc" },
        include: {
          triage: true,
          consultations: true,
          labOrders: true,
          prescriptions: { include: { item: true } },
          billingItems: true,
          payment: true,
          admission: { include: { bed: { include: { ward: true } }, nursingNotes: true } },
        },
      },
    },
  });
  if (!patient) return res.status(404).json({ error: "Patient not found" });

  if (CLINICAL_ROLES.includes(req.user!.role)) {
    return res.json(patient);
  }

  // Non-clinical viewer: strip free-text clinical content, keep everything
  // administrative (status, billing, who/when) intact.
  const sanitized = {
    ...patient,
    encounters: patient.encounters.map((enc) => ({
      ...enc,
      triage: enc.triage ? { ...enc.triage, notes: null } : enc.triage,
      consultations: enc.consultations.map((c) => ({ ...c, notes: null, diagnosis: null })),
      labOrders: enc.labOrders.map((o) => ({ ...o, result: null })),
      admission: enc.admission ? { ...enc.admission, admittingDiagnosis: null, nursingNotes: [] } : enc.admission,
    })),
  };
  res.json(sanitized);
});

export default router;
