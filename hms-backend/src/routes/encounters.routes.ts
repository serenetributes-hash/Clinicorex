import { Router } from "express";
import { z } from "zod";
import { Department } from "@prisma/client";
import { prisma } from "../db";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { requireRole } from "../middleware/roles";
import { enqueue, nextAfterLab, dischargeAdmission } from "../utils/workflow";
import { getConsultationFee, getEmergencyWardVisitFee } from "../utils/catalog";
import { logAction } from "../utils/audit";

const router = Router();

/**
 * Confirms the caller currently holds the CLAIMED queue entry for this
 * encounter/department before letting them act on it. This is what stops
 * a doctor from submitting a consultation for a patient someone else has
 * claimed (or nobody has claimed yet).
 */
async function requireClaimedEntry(encounterId: string, department: Department, userId: string) {
  const entry = await prisma.queueEntry.findFirst({
    where: { encounterId, department, status: "CLAIMED", claimedById: userId },
  });
  return entry;
}

// ---------------- Triage ----------------

const triageSchema = z.object({
  bp: z.string().optional(),
  temp: z.number().optional(),
  pulse: z.number().int().optional(),
  spo2: z.number().int().optional(),
  weight: z.number().optional(),
  priority: z.enum(["NORMAL", "URGENT", "EMERGENCY"]).default("NORMAL"),
  notes: z.string().optional(),
});

router.post("/:id/triage", requireAuth, requireRole("NURSE"), async (req: AuthedRequest, res) => {
  const encounterId = req.params.id;
  const parsed = triageSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const entry = await requireClaimedEntry(encounterId, "TRIAGE", req.user!.id);
  if (!entry) {
    return res.status(403).json({ error: "You must claim this patient from the triage queue before recording vitals" });
  }

  const result = await prisma.$transaction(async (tx) => {
    const triage = await tx.triageRecord.create({
      data: { encounterId, ...parsed.data, recordedById: req.user!.id },
    });
    await tx.encounter.update({ where: { id: encounterId }, data: { status: "CONSULTATION" } });
    await tx.queueEntry.update({ where: { id: entry.id }, data: { status: "COMPLETED", completedAt: new Date() } });
    // Urgent/emergency triage priority carries forward so doctors see the sickest patients first.
    await enqueue(tx, encounterId, "CONSULTATION", parsed.data.priority);
    return triage;
  });

  await logAction({ userId: req.user!.id, action: "triage.recorded", entityType: "Encounter", entityId: encounterId });
  res.status(201).json(result);
});

// ---------------- Consultation ----------------

/**
 * A doctor seeing a patient fresh from triage picks exactly one of four
 * outcomes:
 *   LABORATORY — order one or more tests, patient goes to the lab queue
 *                and comes back here (as a review) once results are in.
 *   PHARMACY   — prescribe medicine, patient goes straight to pharmacy,
 *                then straight to the cashier once dispensed.
 *   THEATRE    — refer straight to theatre (e.g. obvious trauma/surgical
 *                case that doesn't need labs first).
 *   DISCHARGE  — nothing further needed; patient goes to the cashier for
 *                whatever's already billed (the consultation fee).
 * Admission to the ward isn't offered here on purpose — it happens either
 * after reviewing lab results (see consultation-review below) or after a
 * theatre procedure, never straight off triage.
 */
const consultationSchema = z.object({
  decision: z.enum(["LABORATORY", "PHARMACY", "THEATRE", "DISCHARGE"]),
  diagnosis: z.string().optional(),
  notes: z.string().optional(),
  labTestIds: z.array(z.string()).default([]), // LabTest ids from GET /catalog — required when decision = LABORATORY
  prescriptions: z.array(z.object({ itemId: z.string(), quantity: z.number().int().min(1) })).default([]), // required when decision = PHARMACY
});

router.post("/:id/consultation", requireAuth, requireRole("DOCTOR"), async (req: AuthedRequest, res) => {
  const encounterId = req.params.id;
  const parsed = consultationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const { decision, diagnosis, notes, labTestIds, prescriptions } = parsed.data;

  const entry = await requireClaimedEntry(encounterId, "CONSULTATION", req.user!.id);
  if (!entry) {
    return res.status(403).json({ error: "You must claim this patient from the consultation queue first" });
  }

  let selectedTests: { id: string; name: string; price: any }[] = [];
  if (decision === "LABORATORY") {
    if (labTestIds.length === 0) return res.status(400).json({ error: "Select at least one lab test to send this patient to the laboratory" });
    selectedTests = await prisma.labTest.findMany({ where: { id: { in: labTestIds }, active: true } });
    if (selectedTests.length !== labTestIds.length) {
      return res.status(400).json({ error: "One or more selected lab tests are no longer available" });
    }
  }
  if (decision === "PHARMACY") {
    if (prescriptions.length === 0) return res.status(400).json({ error: "Add at least one medicine to send this patient to pharmacy" });
    const items = await prisma.inventoryItem.findMany({ where: { id: { in: prescriptions.map((p) => p.itemId) } } });
    if (items.length !== prescriptions.length) {
      return res.status(400).json({ error: "One or more prescribed items don't exist in inventory" });
    }
  }

  const consultationFee = await getConsultationFee();

  const nextDept: Department =
    decision === "LABORATORY" ? "LABORATORY" :
    decision === "PHARMACY" ? "PHARMACY" :
    decision === "THEATRE" ? "THEATRE" : "CASHIER";
  const nextStatus = decision === "THEATRE" ? "AWAITING_THEATRE" : (nextDept as any);

  const result = await prisma.$transaction(async (tx) => {
    await tx.consultation.create({ data: { encounterId, doctorId: req.user!.id, diagnosis, notes } });
    await tx.billingItem.create({
      data: { encounterId, description: "Consultation fee", amount: consultationFee, category: "Consultation" },
    });
    if (decision === "LABORATORY") {
      for (const t of selectedTests) {
        await tx.labOrder.create({
          data: { encounterId, testName: t.name, price: t.price, orderedById: req.user!.id },
        });
      }
    }
    if (decision === "PHARMACY") {
      for (const rx of prescriptions) {
        await tx.prescription.create({ data: { encounterId, itemId: rx.itemId, quantity: rx.quantity } });
      }
    }

    await tx.encounter.update({ where: { id: encounterId }, data: { status: nextStatus } });
    await tx.queueEntry.update({ where: { id: entry.id }, data: { status: "COMPLETED", completedAt: new Date() } });
    await enqueue(tx, encounterId, nextDept);
    return { nextDepartment: nextDept };
  });

  await logAction({
    userId: req.user!.id,
    action: "consultation.recorded",
    entityType: "Encounter",
    entityId: encounterId,
    details: { decision },
  });
  res.status(201).json(result);
});

// ---------------- Laboratory ----------------

const labResultsSchema = z.object({
  results: z.array(z.object({ labOrderId: z.string(), result: z.string().min(1) })).min(1),
});

router.post("/:id/lab-results", requireAuth, requireRole("LAB_TECH"), async (req: AuthedRequest, res) => {
  const encounterId = req.params.id;
  const parsed = labResultsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const entry = await requireClaimedEntry(encounterId, "LABORATORY", req.user!.id);
  if (!entry) return res.status(403).json({ error: "You must claim this patient from the laboratory queue first" });

  const orders = await prisma.labOrder.findMany({ where: { encounterId, status: "PENDING" } });
  const triage = await prisma.triageRecord.findUnique({ where: { encounterId } });

  await prisma.$transaction(async (tx) => {
    for (const r of parsed.data.results) {
      const order = orders.find((o) => o.id === r.labOrderId);
      if (!order) continue;
      await tx.labOrder.update({
        where: { id: order.id },
        data: { status: "COMPLETED", result: r.result, resultedById: req.user!.id, resultedAt: new Date() },
      });
      await tx.billingItem.create({
        data: { encounterId, description: `Lab: ${order.testName}`, amount: order.price, category: "Laboratory" },
      });
    }

    // Always back to the doctor — results need a clinician's eyes before
    // anything else happens (pharmacy, ward, or discharge).
    const nextDept = nextAfterLab();
    await tx.encounter.update({ where: { id: encounterId }, data: { status: nextDept as any } });
    await tx.queueEntry.update({ where: { id: entry.id }, data: { status: "COMPLETED", completedAt: new Date() } });
    await enqueue(tx, encounterId, nextDept, triage?.priority);
  });

  await logAction({ userId: req.user!.id, action: "lab.results_entered", entityType: "Encounter", entityId: encounterId });
  res.json({ ok: true });
});

// ---------------- Consultation review (after lab results) ----------------

const reviewSchema = z.object({
  decision: z.enum(["PHARMACY", "WARD", "THEATRE", "DISCHARGE"]),
  notes: z.string().optional(),
  prescriptions: z.array(z.object({ itemId: z.string(), quantity: z.number().int().min(1) })).default([]),
});

/**
 * A doctor reviewing lab/equipment results has four outcomes: send to
 * pharmacy for medication, refer to a ward for admission, refer to
 * theatre for a procedure, or dismiss the patient (no further treatment)
 * straight to the cashier — in every case, whatever was already charged
 * (consultation + lab fees) still stands.
 */
router.post("/:id/consultation-review", requireAuth, requireRole("DOCTOR"), async (req: AuthedRequest, res) => {
  const encounterId = req.params.id;
  const parsed = reviewSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const { decision, notes, prescriptions } = parsed.data;

  const entry = await requireClaimedEntry(encounterId, "CONSULTATION", req.user!.id);
  if (!entry) return res.status(403).json({ error: "You must claim this patient from the consultation queue first" });

  if (decision === "PHARMACY") {
    if (prescriptions.length === 0) {
      return res.status(400).json({ error: "Add at least one medicine to send this patient to pharmacy" });
    }
    const items = await prisma.inventoryItem.findMany({ where: { id: { in: prescriptions.map((p) => p.itemId) } } });
    if (items.length !== prescriptions.length) {
      return res.status(400).json({ error: "One or more prescribed items don't exist in inventory" });
    }
  }

  const nextDept: Department =
    decision === "PHARMACY" ? "PHARMACY" : decision === "WARD" ? "WARD" : decision === "THEATRE" ? "THEATRE" : "CASHIER";
  const nextStatus =
    decision === "WARD" ? "AWAITING_ADMISSION" : decision === "THEATRE" ? "AWAITING_THEATRE" : (nextDept as any);

  await prisma.$transaction(async (tx) => {
    await tx.consultation.create({
      data: {
        encounterId,
        doctorId: req.user!.id,
        notes: `Lab review — decision: ${decision}.${notes ? " " + notes : ""}`,
      },
    });
    if (decision === "PHARMACY") {
      for (const rx of prescriptions) {
        await tx.prescription.create({ data: { encounterId, itemId: rx.itemId, quantity: rx.quantity } });
      }
    }
    await tx.encounter.update({ where: { id: encounterId }, data: { status: nextStatus } });
    await tx.queueEntry.update({ where: { id: entry.id }, data: { status: "COMPLETED", completedAt: new Date() } });
    await enqueue(tx, encounterId, nextDept);
  });

  await logAction({
    userId: req.user!.id,
    action: "consultation.review_decided",
    entityType: "Encounter",
    entityId: encounterId,
    details: { decision },
  });
  res.json({ ok: true, decision });
});

// ---------------- Ward round (doctor called to see an admitted patient) ----------------

const wardRoundSchema = z.object({
  // Same four as first consultation, plus WARD — which here means "no
  // change needed, back to the ward bed", since the patient is already
  // admitted (unlike the review screen's WARD, which starts a brand new
  // admission).
  decision: z.enum(["LABORATORY", "PHARMACY", "THEATRE", "DISCHARGE", "WARD"]),
  diagnosis: z.string().optional(),
  notes: z.string().optional(),
  labTestIds: z.array(z.string()).default([]),
  prescriptions: z.array(z.object({ itemId: z.string(), quantity: z.number().int().min(1) })).default([]),
});

/**
 * POST /:id/ward-round
 * Used when a ward nurse/doctor "calls a doctor" for a patient who is
 * already admitted (see POST /wards/admissions/:id/call-doctor). The
 * patient stays in their bed throughout — this never creates a new
 * admission or frees the bed. The doctor can still order labs, prescribe
 * medicine, refer to theatre, or discharge, exactly like a normal
 * consultation; "WARD" just means "seen, no change — back to the ward".
 */
router.post("/:id/ward-round", requireAuth, requireRole("DOCTOR"), async (req: AuthedRequest, res) => {
  const encounterId = req.params.id;
  const parsed = wardRoundSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const { decision, diagnosis, notes, labTestIds, prescriptions } = parsed.data;

  const entry = await requireClaimedEntry(encounterId, "CONSULTATION", req.user!.id);
  if (!entry) return res.status(403).json({ error: "You must claim this patient from the consultation queue first" });

  const admission = await prisma.admission.findFirst({ where: { encounterId, dischargedAt: null } });
  if (!admission) return res.status(400).json({ error: "This patient doesn't currently have an active ward admission" });

  let selectedTests: { id: string; name: string; price: any }[] = [];
  if (decision === "LABORATORY") {
    if (labTestIds.length === 0) return res.status(400).json({ error: "Select at least one lab test" });
    selectedTests = await prisma.labTest.findMany({ where: { id: { in: labTestIds }, active: true } });
    if (selectedTests.length !== labTestIds.length) {
      return res.status(400).json({ error: "One or more selected lab tests are no longer available" });
    }
  }
  if (decision === "PHARMACY") {
    if (prescriptions.length === 0) return res.status(400).json({ error: "Add at least one medicine" });
    const items = await prisma.inventoryItem.findMany({ where: { id: { in: prescriptions.map((p) => p.itemId) } } });
    if (items.length !== prescriptions.length) {
      return res.status(400).json({ error: "One or more prescribed items don't exist in inventory" });
    }
  }

  const emergencyFee = entry.priority === "EMERGENCY" ? await getEmergencyWardVisitFee() : 0;

  // WARD (stay put) never hands off to another department queue — the
  // patient's already there. DISCHARGE goes through the same bed-freeing,
  // nights-stayed billing as a normal ward discharge (see below), not a
  // simple status change.
  const nextDept: Department | null =
    decision === "LABORATORY" ? "LABORATORY" :
    decision === "PHARMACY" ? "PHARMACY" :
    decision === "THEATRE" ? "THEATRE" : null;
  const nextStatus =
    decision === "THEATRE" ? "AWAITING_THEATRE" :
    decision === "WARD" ? "ADMITTED" : (nextDept as any);

  const result = await prisma.$transaction(async (tx) => {
    await tx.consultation.create({ data: { encounterId, doctorId: req.user!.id, diagnosis, notes } });

    // Routine ward rounds aren't billed per visit — they're covered by the
    // ward's standard daily doctor-round rate, charged automatically at
    // discharge (see dischargeAdmission), same as the nightly bed rate.
    // Only a genuine after-hours/emergency call-out (flagged when the
    // doctor was called, see POST /wards/admissions/:id/call-doctor) adds
    // a one-off charge here — and it's its own fee, not the outpatient
    // consultation fee.
    if (entry.priority === "EMERGENCY") {
      await tx.billingItem.create({
        data: { encounterId, description: "Emergency ward visit", amount: emergencyFee, category: "Consultation" },
      });
    }
    if (decision === "LABORATORY") {
      for (const t of selectedTests) {
        await tx.labOrder.create({ data: { encounterId, testName: t.name, price: t.price, orderedById: req.user!.id } });
      }
    }
    if (decision === "PHARMACY") {
      for (const rx of prescriptions) {
        await tx.prescription.create({ data: { encounterId, itemId: rx.itemId, quantity: rx.quantity } });
      }
    }

    if (decision === "DISCHARGE") {
      const fullAdmission = await tx.admission.findUniqueOrThrow({
        where: { id: admission.id },
        include: { bed: { include: { ward: true } } },
      });
      await dischargeAdmission(tx, fullAdmission);
    } else {
      await tx.encounter.update({ where: { id: encounterId }, data: { status: nextStatus } });
    }
    await tx.queueEntry.update({ where: { id: entry.id }, data: { status: "COMPLETED", completedAt: new Date() } });
    if (nextDept) await enqueue(tx, encounterId, nextDept);
    return { nextDepartment: decision === "DISCHARGE" ? "CASHIER" : nextDept || "WARD" };
  });

  await logAction({
    userId: req.user!.id,
    action: "ward_round.recorded",
    entityType: "Encounter",
    entityId: encounterId,
    details: { decision },
  });
  res.status(201).json(result);
});

// ---------------- Pharmacy ----------------

router.post("/:id/dispense", requireAuth, requireRole("PHARMACIST"), async (req: AuthedRequest, res) => {
  const encounterId = req.params.id;

  const entry = await requireClaimedEntry(encounterId, "PHARMACY", req.user!.id);
  if (!entry) return res.status(403).json({ error: "You must claim this patient from the pharmacy queue first" });

  const prescriptions = await prisma.prescription.findMany({
    where: { encounterId, dispensed: false },
    include: { item: true },
  });

  for (const rx of prescriptions) {
    if (rx.item.quantity < rx.quantity) {
      return res.status(409).json({ error: `Insufficient stock for ${rx.item.name} (have ${rx.item.quantity}, need ${rx.quantity})` });
    }
  }

  await prisma.$transaction(async (tx) => {
    for (const rx of prescriptions) {
      await tx.inventoryItem.update({ where: { id: rx.itemId }, data: { quantity: { decrement: rx.quantity } } });
      await tx.inventoryTransaction.create({
        data: {
          itemId: rx.itemId,
          changeQty: -rx.quantity,
          reason: "Dispensed",
          referenceType: "Prescription",
          referenceId: rx.id,
          createdById: req.user!.id,
        },
      });
      await tx.prescription.update({
        where: { id: rx.id },
        data: { dispensed: true, dispensedAt: new Date(), dispensedById: req.user!.id },
      });
      await tx.billingItem.create({
        data: {
          encounterId,
          description: `Pharmacy: ${rx.item.name} x${rx.quantity}`,
          amount: Number(rx.item.unitPrice) * rx.quantity,
          category: "Pharmacy",
        },
      });
    }

    // An inpatient (still on an active ward admission) goes straight back
    // to their bed after dispensing — not to the cashier, since their stay
    // isn't over. Everyone else (first-visit or post-lab pharmacy) goes on
    // to the cashier as normal.
    const activeAdmission = await tx.admission.findFirst({ where: { encounterId, dischargedAt: null } });
    await tx.queueEntry.update({ where: { id: entry.id }, data: { status: "COMPLETED", completedAt: new Date() } });
    if (activeAdmission) {
      await tx.encounter.update({ where: { id: encounterId }, data: { status: "ADMITTED" } });
    } else {
      await tx.encounter.update({ where: { id: encounterId }, data: { status: "CASHIER" } });
      await enqueue(tx, encounterId, "CASHIER");
    }
  });

  await logAction({ userId: req.user!.id, action: "pharmacy.dispensed", entityType: "Encounter", entityId: encounterId });
  res.json({ ok: true, itemsDispensed: prescriptions.length });
});

// ---------------- Cashier ----------------

const billingItemSchema = z.union([
  z.object({ otherFeeId: z.string() }),
  z.object({ description: z.string().min(1), amount: z.number().min(0) }),
]);

/**
 * POST /:id/billing-items
 * Adds a one-off charge to a patient's bill before payment — either picked
 * from the admin-maintained OtherFee catalog (Pricing page), or a fully
 * custom description/amount for something truly one-off that isn't worth
 * cataloging. Only usable while the encounter is claimed by this cashier
 * at the Cashier queue, same guard as every other department action.
 */
router.post("/:id/billing-items", requireAuth, requireRole("CASHIER"), async (req: AuthedRequest, res) => {
  const encounterId = req.params.id;
  const parsed = billingItemSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Provide either otherFeeId, or description and amount" });

  const entry = await requireClaimedEntry(encounterId, "CASHIER", req.user!.id);
  if (!entry) return res.status(403).json({ error: "You must claim this patient from the cashier queue first" });

  let description: string;
  let amount: number;
  if ("otherFeeId" in parsed.data) {
    const fee = await prisma.otherFee.findUnique({ where: { id: parsed.data.otherFeeId } });
    if (!fee || !fee.active) return res.status(400).json({ error: "This fee is no longer available" });
    description = fee.name;
    amount = Number(fee.price);
  } else {
    description = parsed.data.description;
    amount = parsed.data.amount;
  }

  const item = await prisma.billingItem.create({
    data: { encounterId, description, amount, category: "Other" },
  });

  await logAction({ userId: req.user!.id, action: "billing_item.added", entityType: "Encounter", entityId: encounterId, details: { description, amount } });
  res.status(201).json(item);
});

const paymentSchema = z.object({
  method: z.enum(["CASH", "INSURANCE"]),
  insuranceProvider: z.string().optional(),
  claimNo: z.string().optional(),
});

router.post("/:id/payment", requireAuth, requireRole("CASHIER"), async (req: AuthedRequest, res) => {
  const encounterId = req.params.id;
  const parsed = paymentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const { method, insuranceProvider, claimNo } = parsed.data;

  const entry = await requireClaimedEntry(encounterId, "CASHIER", req.user!.id);
  if (!entry) return res.status(403).json({ error: "You must claim this patient from the cashier queue first" });

  const billingItems = await prisma.billingItem.findMany({ where: { encounterId } });
  const total = billingItems.reduce((s, i) => s + Number(i.amount), 0);
  const isInsurance = method === "INSURANCE";

  const payment = await prisma.$transaction(async (tx) => {
    const p = await tx.payment.create({
      data: {
        encounterId,
        method,
        amount: total,
        insuranceProvider: isInsurance ? insuranceProvider : undefined,
        claimNo: isInsurance ? claimNo : undefined,
        claimStatus: isInsurance ? "SUBMITTED" : undefined,
        claimSubmittedAt: isInsurance ? new Date() : undefined,
        paidAt: isInsurance ? undefined : new Date(),
        recordedById: req.user!.id,
      },
    });
    await tx.encounter.update({
      where: { id: encounterId },
      data: { status: "DISCHARGED", dischargedAt: new Date() },
    });
    await tx.queueEntry.update({ where: { id: entry.id }, data: { status: "COMPLETED", completedAt: new Date() } });
    return p;
  });

  await logAction({
    userId: req.user!.id,
    action: isInsurance ? "payment.claim_submitted" : "payment.cash_received",
    entityType: "Encounter",
    entityId: encounterId,
    details: { amount: total },
  });

  res.status(201).json(payment);
});

// ---------------- Insurance claim status updates ----------------

const claimStatusSchema = z.object({ status: z.enum(["SUBMITTED", "APPROVED", "PAID", "REJECTED"]) });

router.patch("/:id/claim-status", requireAuth, requireRole("CASHIER"), async (req: AuthedRequest, res) => {
  const parsed = claimStatusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid status" });

  const payment = await prisma.payment.findUnique({ where: { encounterId: req.params.id } });
  if (!payment) return res.status(404).json({ error: "No payment/claim found for this encounter" });

  const updated = await prisma.payment.update({
    where: { encounterId: req.params.id },
    data: {
      claimStatus: parsed.data.status,
      paidAt: parsed.data.status === "PAID" ? new Date() : null,
    },
  });

  await logAction({
    userId: req.user!.id,
    action: "claim.status_updated",
    entityType: "Payment",
    entityId: payment.id,
    details: { status: parsed.data.status },
  });

  res.json(updated);
});

export default router;
