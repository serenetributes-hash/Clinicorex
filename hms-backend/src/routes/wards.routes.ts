import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { requireRole } from "../middleware/roles";
import { enqueue, dischargeAdmission } from "../utils/workflow";
import { logAction } from "../utils/audit";

const router = Router();

/** GET /wards — occupancy overview */
router.get("/", requireAuth, async (_req, res) => {
  const wards = await prisma.ward.findMany({
    include: {
      beds: {
        include: {
          admissions: {
            where: { dischargedAt: null },
            include: {
              encounter: { include: { patient: true } },
              nursingNotes: { orderBy: { recordedAt: "desc" } },
            },
          },
        },
      },
    },
  });
  res.json(wards);
});

const createWardSchema = z.object({
  name: z.string().min(1),
  type: z.string().optional(),
  dailyRate: z.number().min(0),
  doctorRoundFee: z.number().min(0),
  bedCount: z.number().int().min(1).max(200),
});

/** POST /wards — admin only: add a new ward with its beds and rates */
router.post("/", requireAuth, requireRole("ADMIN"), async (req: AuthedRequest, res) => {
  const parsed = createWardSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const { bedCount, ...wardData } = parsed.data;

  const ward = await prisma.$transaction(async (tx) => {
    const w = await tx.ward.create({ data: wardData });
    for (let i = 1; i <= bedCount; i++) {
      await tx.bed.create({ data: { wardId: w.id, bedNumber: String(i).padStart(2, "0") } });
    }
    return w;
  });

  await logAction({ userId: req.user!.id, action: "ward.created", entityType: "Ward", entityId: ward.id });
  res.status(201).json(ward);
});

const updateWardSchema = z.object({
  name: z.string().min(1).optional(),
  type: z.string().optional(),
  dailyRate: z.number().min(0).optional(),
  doctorRoundFee: z.number().min(0).optional(),
});

/** PATCH /wards/:id — admin only: change a ward's name/type/rates */
router.patch("/:id", requireAuth, requireRole("ADMIN"), async (req: AuthedRequest, res) => {
  const parsed = updateWardSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const ward = await prisma.ward.update({ where: { id: req.params.id }, data: parsed.data }).catch(() => null);
  if (!ward) return res.status(404).json({ error: "Ward not found" });

  await logAction({ userId: req.user!.id, action: "ward.updated", entityType: "Ward", entityId: ward.id, details: parsed.data });
  res.json(ward);
});

const admitSchema = z.object({
  encounterId: z.string(),
  bedId: z.string(),
  admittingDiagnosis: z.string().optional(),
  expectedDischarge: z.string().datetime().optional(),
});

/** POST /admissions — admit a patient to a specific bed */
router.post("/admissions", requireAuth, requireRole("DOCTOR", "WARD_NURSE"), async (req: AuthedRequest, res) => {
  const parsed = admitSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const d = parsed.data;

  const bed = await prisma.bed.findUnique({ where: { id: d.bedId } });
  if (!bed) return res.status(404).json({ error: "Bed not found" });
  if (bed.status !== "AVAILABLE") return res.status(409).json({ error: `Bed is currently ${bed.status.toLowerCase()}` });

  const encounter = await prisma.encounter.findUnique({ where: { id: d.encounterId } });
  if (!encounter) return res.status(404).json({ error: "Encounter not found" });

  // If this patient was referred here from a doctor's consultation review,
  // there's a WARD queue entry waiting — it must be claimed by whoever is
  // admitting (or an admin) before the admission can proceed. Direct,
  // unreferred admissions (no queue entry at all) are still allowed.
  const referral = await prisma.queueEntry.findFirst({
    where: { encounterId: d.encounterId, department: "WARD", status: { in: ["WAITING", "CLAIMED"] } },
  });
  if (referral) {
    if (referral.status === "WAITING") {
      return res.status(403).json({ error: "Claim this referral from the Wards queue before admitting" });
    }
    if (referral.claimedById !== req.user!.id && req.user!.role !== "ADMIN") {
      return res.status(403).json({ error: "Only the staff member who claimed this referral can admit the patient" });
    }
  }

  const admission = await prisma.$transaction(async (tx) => {
    const a = await tx.admission.create({
      data: {
        encounterId: d.encounterId,
        bedId: d.bedId,
        admittedById: req.user!.id,
        admittingDiagnosis: d.admittingDiagnosis,
        expectedDischarge: d.expectedDischarge ? new Date(d.expectedDischarge) : undefined,
      },
    });
    await tx.bed.update({ where: { id: d.bedId }, data: { status: "OCCUPIED" } });
    await tx.encounter.update({ where: { id: d.encounterId }, data: { status: "ADMITTED", type: "INPATIENT" } });
    if (referral) {
      await tx.queueEntry.update({ where: { id: referral.id }, data: { status: "COMPLETED", completedAt: new Date() } });
    }
    return a;
  });

  await logAction({ userId: req.user!.id, action: "ward.admitted", entityType: "Admission", entityId: admission.id });
  res.status(201).json(admission);
});

const noteSchema = z.object({ note: z.string().min(1) });

/** POST /admissions/:id/notes — nursing/doctor round notes during the stay */
router.post("/admissions/:id/notes", requireAuth, requireRole("DOCTOR", "WARD_NURSE"), async (req: AuthedRequest, res) => {
  const parsed = noteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Note text is required" });

  const admission = await prisma.admission.findUnique({ where: { id: req.params.id } });
  if (!admission) return res.status(404).json({ error: "Admission not found" });

  const note = await prisma.nursingNote.create({
    data: { admissionId: admission.id, note: parsed.data.note, recordedById: req.user!.id },
  });
  res.status(201).json(note);
});

const callDoctorSchema = z.object({ emergency: z.boolean().default(false) });

/**
 * POST /admissions/:id/call-doctor
 * Sends an admitted patient to the Consultation queue without discharging
 * them or freeing their bed — the doctor sees them via the ward-round
 * screen (POST /encounters/:id/ward-round) and the patient comes right
 * back to the same bed afterward unless referred elsewhere.
 *
 * "emergency: true" marks this as a genuine after-hours/emergency
 * call-out rather than a routine round — it's billed as a one-off
 * Emergency ward visit fee instead of being absorbed into the ward's
 * standard daily doctor-round rate (see dischargeAdmission).
 */
router.post("/admissions/:id/call-doctor", requireAuth, requireRole("DOCTOR", "WARD_NURSE"), async (req: AuthedRequest, res) => {
  const parsed = callDoctorSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request" });

  const admission = await prisma.admission.findUnique({ where: { id: req.params.id } });
  if (!admission) return res.status(404).json({ error: "Admission not found" });
  if (admission.dischargedAt) return res.status(400).json({ error: "This admission has already been discharged" });

  const alreadyWaiting = await prisma.queueEntry.findFirst({
    where: { encounterId: admission.encounterId, department: "CONSULTATION", status: { in: ["WAITING", "CLAIMED"] } },
  });
  if (alreadyWaiting) return res.status(409).json({ error: "A doctor has already been called for this patient" });

  await prisma.$transaction(async (tx) => {
    await tx.encounter.update({ where: { id: admission.encounterId }, data: { status: "CONSULTATION" } });
    await enqueue(tx, admission.encounterId, "CONSULTATION", parsed.data.emergency ? "EMERGENCY" : "NORMAL");
  });

  await logAction({
    userId: req.user!.id,
    action: "ward.called_doctor",
    entityType: "Admission",
    entityId: admission.id,
    details: { emergency: parsed.data.emergency },
  });
  res.status(201).json({ ok: true });
});

const orderMedicineSchema = z.object({
  prescriptions: z.array(z.object({ itemId: z.string(), quantity: z.number().int().min(1) })).min(1),
});

/**
 * POST /admissions/:id/order-medicine
 * Sends an admitted patient's medicine order straight to Pharmacy without
 * a full doctor consultation — for routine in-stay medication. The bed
 * stays reserved, and once dispensed the patient is routed straight back
 * to the ward (see the dispense logic in encounters.routes.ts), not to
 * the cashier.
 */
router.post("/admissions/:id/order-medicine", requireAuth, requireRole("DOCTOR", "WARD_NURSE"), async (req: AuthedRequest, res) => {
  const parsed = orderMedicineSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Add at least one medicine" });

  const admission = await prisma.admission.findUnique({ where: { id: req.params.id } });
  if (!admission) return res.status(404).json({ error: "Admission not found" });
  if (admission.dischargedAt) return res.status(400).json({ error: "This admission has already been discharged" });

  const items = await prisma.inventoryItem.findMany({ where: { id: { in: parsed.data.prescriptions.map((p) => p.itemId) } } });
  if (items.length !== parsed.data.prescriptions.length) {
    return res.status(400).json({ error: "One or more selected items don't exist in inventory" });
  }

  await prisma.$transaction(async (tx) => {
    for (const rx of parsed.data.prescriptions) {
      await tx.prescription.create({ data: { encounterId: admission.encounterId, itemId: rx.itemId, quantity: rx.quantity } });
    }
    await tx.encounter.update({ where: { id: admission.encounterId }, data: { status: "PHARMACY" } });
    await enqueue(tx, admission.encounterId, "PHARMACY");
  });

  await logAction({ userId: req.user!.id, action: "ward.ordered_medicine", entityType: "Admission", entityId: admission.id });
  res.status(201).json({ ok: true });
});

/**
 * POST /admissions/:id/discharge
 * Charges for the length of stay (ward's daily rate × nights stayed,
 * minimum 1 day), frees the bed, and sends the patient to the Cashier
 * queue for final billing — actual encounter discharge happens once
 * payment is recorded, same as the outpatient flow.
 */
router.post("/admissions/:id/discharge", requireAuth, requireRole("DOCTOR", "WARD_NURSE"), async (req: AuthedRequest, res) => {
  const admission = await prisma.admission.findUnique({
    where: { id: req.params.id },
    include: { bed: { include: { ward: true } } },
  });
  if (!admission) return res.status(404).json({ error: "Admission not found" });
  if (admission.dischargedAt) return res.status(400).json({ error: "This admission is already discharged" });

  const result = await prisma.$transaction(async (tx) => dischargeAdmission(tx, admission));

  await logAction({
    userId: req.user!.id,
    action: "ward.discharged_to_billing",
    entityType: "Admission",
    entityId: admission.id,
    details: result,
  });
  res.json({ ok: true, ...result });
});

export default router;
