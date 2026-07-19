import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { requireRole } from "../middleware/roles";
import { enqueue } from "../utils/workflow";
import { logAction } from "../utils/audit";

const router = Router();

/** GET /theatre/equipment — list theatres/machines with their default fee items */
router.get("/equipment", requireAuth, async (_req, res) => {
  const equipment = await prisma.equipment.findMany({ include: { feeItems: true } });
  res.json(equipment);
});

const createEquipmentSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  feeItems: z.array(z.object({ label: z.string().min(1), defaultAmount: z.number().min(0) })).default([]),
});

/** POST /theatre/equipment — admin only: add a new theatre/machine with its default fee items */
router.post("/equipment", requireAuth, requireRole("ADMIN"), async (req: AuthedRequest, res) => {
  const parsed = createEquipmentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const equipment = await prisma.equipment.create({
    data: { name: parsed.data.name, type: parsed.data.type, feeItems: { create: parsed.data.feeItems } },
    include: { feeItems: true },
  });
  await logAction({ userId: req.user!.id, action: "equipment.created", entityType: "Equipment", entityId: equipment.id });
  res.status(201).json(equipment);
});

const feeItemSchema = z.object({ label: z.string().min(1), defaultAmount: z.number().min(0) });

/** POST /theatre/equipment/:id/fee-items — admin only: add a new billable line to existing equipment */
router.post("/equipment/:id/fee-items", requireAuth, requireRole("ADMIN"), async (req: AuthedRequest, res) => {
  const parsed = feeItemSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const equipment = await prisma.equipment.findUnique({ where: { id: req.params.id } });
  if (!equipment) return res.status(404).json({ error: "Equipment/theatre not found" });

  const feeItem = await prisma.equipmentFeeItem.create({ data: { equipmentId: equipment.id, ...parsed.data } });
  await logAction({ userId: req.user!.id, action: "equipment.fee_item_added", entityType: "Equipment", entityId: equipment.id });
  res.status(201).json(feeItem);
});

/** PATCH /theatre/fee-items/:id — admin only: change a fee item's default amount or label */
router.patch("/fee-items/:id", requireAuth, requireRole("ADMIN"), async (req: AuthedRequest, res) => {
  const parsed = feeItemSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const feeItem = await prisma.equipmentFeeItem.update({ where: { id: req.params.id }, data: parsed.data }).catch(() => null);
  if (!feeItem) return res.status(404).json({ error: "Fee item not found" });

  await logAction({ userId: req.user!.id, action: "equipment.fee_item_updated", entityType: "EquipmentFeeItem", entityId: feeItem.id });
  res.json(feeItem);
});

const bookingSchema = z.object({
  equipmentId: z.string(),
  encounterId: z.string().optional(), // omit for a walk-in/unassigned block with no billing
  date: z.string().datetime(),
  time: z.string(),
  durationMin: z.number().int().min(1),
  purpose: z.string().optional(),
  items: z.array(z.object({ label: z.string().min(1), amount: z.number().min(0) })).optional(),
});

/**
 * POST /theatre/bookings
 * Schedules a theatre/machine slot. If items aren't supplied, the
 * equipment's default fee items are copied in — editable per case (e.g. a
 * longer surgery might need an extra "additional theatre time" line).
 * If an encounterId is given, this booking also enters the shared THEATRE
 * queue so surgeons/anaesthetists can claim it when ready to start.
 */
router.post("/bookings", requireAuth, requireRole("DOCTOR", "NURSE", "WARD_NURSE", "THEATRE_NURSE"), async (req: AuthedRequest, res) => {
  const parsed = bookingSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const d = parsed.data;

  const equipment = await prisma.equipment.findUnique({ where: { id: d.equipmentId }, include: { feeItems: true } });
  if (!equipment) return res.status(404).json({ error: "Equipment/theatre not found" });

  if (d.encounterId) {
    const encounter = await prisma.encounter.findUnique({ where: { id: d.encounterId } });
    if (!encounter) return res.status(404).json({ error: "Encounter not found" });
  }

  const items = d.items ?? equipment.feeItems.map((fi) => ({ label: fi.label, amount: Number(fi.defaultAmount) }));

  const booking = await prisma.$transaction(async (tx) => {
    const b = await tx.booking.create({
      data: {
        equipmentId: d.equipmentId,
        encounterId: d.encounterId,
        date: new Date(d.date),
        time: d.time,
        durationMin: d.durationMin,
        purpose: d.purpose,
        status: "Scheduled",
        createdById: req.user!.id,
        charges: { create: items },
      },
      include: { charges: true },
    });
    if (d.encounterId) {
      await enqueue(tx, d.encounterId, "THEATRE");
    }
    return b;
  });

  await logAction({ userId: req.user!.id, action: "theatre.booking_created", entityType: "Booking", entityId: booking.id });
  res.status(201).json(booking);
});

/** GET /theatre/bookings?date=YYYY-MM-DD — the day's schedule across all theatres/machines */
router.get("/bookings", requireAuth, async (req, res) => {
  const dateParam = req.query.date as string | undefined;
  const bookings = await prisma.booking.findMany({
    where: dateParam
      ? { date: { gte: new Date(`${dateParam}T00:00:00Z`), lt: new Date(`${dateParam}T23:59:59Z`) } }
      : undefined,
    include: { equipment: true, charges: true, encounter: { include: { patient: true } } },
    orderBy: [{ date: "asc" }, { time: "asc" }],
  });
  res.json(bookings);
});

/**
 * POST /theatre/bookings/:id/claim
 * A surgeon/anaesthetist is ready to start — claims the corresponding
 * THEATRE queue entry (atomically, same guard as every other department)
 * and flips the booking to "In progress".
 */
router.post("/bookings/:id/claim", requireAuth, requireRole("DOCTOR", "NURSE", "THEATRE_NURSE"), async (req: AuthedRequest, res) => {
  const booking = await prisma.booking.findUnique({ where: { id: req.params.id } });
  if (!booking) return res.status(404).json({ error: "Booking not found" });
  if (!booking.encounterId) return res.status(400).json({ error: "This booking has no linked patient, so it isn't in the queue" });

  const queueEntry = await prisma.queueEntry.findFirst({
    where: { encounterId: booking.encounterId, department: "THEATRE", status: "WAITING" },
  });
  if (!queueEntry) return res.status(409).json({ error: "No waiting theatre queue entry for this booking — it may already be claimed" });

  const claimResult = await prisma.queueEntry.updateMany({
    where: { id: queueEntry.id, status: "WAITING" },
    data: { status: "CLAIMED", claimedById: req.user!.id, claimedAt: new Date() },
  });
  if (claimResult.count === 0) {
    return res.status(409).json({ error: "This case was just claimed by someone else. Refresh the theatre queue." });
  }

  const updated = await prisma.booking.update({ where: { id: booking.id }, data: { status: "In progress" } });
  await logAction({ userId: req.user!.id, action: "theatre.claimed", entityType: "Booking", entityId: booking.id });
  res.json(updated);
});

const completeBookingSchema = z.object({
  // Only meaningful (and required) when the booking is linked to a patient
  // encounter: WARD sends the patient to recover under monitoring, DISCHARGE
  // sends them straight to the cashier for final billing.
  decision: z.enum(["WARD", "DISCHARGE"]).optional(),
});

/**
 * POST /theatre/bookings/:id/complete
 * Posts the itemized charges to the patient's bill, closes out the queue
 * entry, and — for a case linked to a patient — moves the patient on to
 * either the Ward (for post-op recovery/monitoring) or the Cashier (if
 * they're being discharged straight after the procedure). Only the staff
 * member who claimed it (or an admin) can complete it.
 */
router.post("/bookings/:id/complete", requireAuth, requireRole("DOCTOR", "NURSE", "THEATRE_NURSE"), async (req: AuthedRequest, res) => {
  const parsed = completeBookingSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const booking = await prisma.booking.findUnique({
    where: { id: req.params.id },
    include: { charges: true, equipment: true },
  });
  if (!booking) return res.status(404).json({ error: "Booking not found" });

  if (booking.encounterId) {
    if (!parsed.data.decision) {
      return res.status(400).json({ error: "Choose whether this patient recovers in the ward or is discharged" });
    }

    const queueEntry = await prisma.queueEntry.findFirst({
      where: { encounterId: booking.encounterId, department: "THEATRE", status: "CLAIMED" },
    });
    if (!queueEntry) return res.status(403).json({ error: "This case isn't currently claimed by you" });
    if (queueEntry.claimedById !== req.user!.id && req.user!.role !== "ADMIN") {
      return res.status(403).json({ error: "Only the staff member who claimed this case can complete it" });
    }

    const nextDept = parsed.data.decision === "WARD" ? "WARD" : "CASHIER";
    const nextStatus = parsed.data.decision === "WARD" ? "AWAITING_ADMISSION" : "CASHIER";

    await prisma.$transaction(async (tx) => {
      for (const charge of booking.charges) {
        await tx.billingItem.create({
          data: {
            encounterId: booking.encounterId as string,
            description: `Theatre/Imaging: ${booking.equipment.name} — ${charge.label}`,
            amount: charge.amount,
            category: "Theatre/Imaging",
          },
        });
      }
      await tx.queueEntry.update({ where: { id: queueEntry.id }, data: { status: "COMPLETED", completedAt: new Date() } });
      await tx.booking.update({ where: { id: booking.id }, data: { status: "Completed" } });
      await tx.encounter.update({ where: { id: booking.encounterId as string }, data: { status: nextStatus } });
      await enqueue(tx, booking.encounterId as string, nextDept);
    });

    await logAction({
      userId: req.user!.id,
      action: "theatre.completed",
      entityType: "Booking",
      entityId: booking.id,
      details: { decision: parsed.data.decision },
    });
    return res.json({ ok: true, decision: parsed.data.decision });
  }

  // Unassigned block (no patient attached) — just closes out the booking.
  await prisma.booking.update({ where: { id: booking.id }, data: { status: "Completed" } });
  await logAction({ userId: req.user!.id, action: "theatre.completed", entityType: "Booking", entityId: booking.id });
  res.json({ ok: true });
});

router.post("/bookings/:id/cancel", requireAuth, requireRole("DOCTOR", "NURSE", "WARD_NURSE", "THEATRE_NURSE"), async (req: AuthedRequest, res) => {
  const booking = await prisma.booking.findUnique({ where: { id: req.params.id } });
  if (!booking) return res.status(404).json({ error: "Booking not found" });

  await prisma.$transaction(async (tx) => {
    await tx.booking.update({ where: { id: booking.id }, data: { status: "Cancelled" } });
    if (booking.encounterId) {
      const queueEntry = await tx.queueEntry.findFirst({
        where: { encounterId: booking.encounterId, department: "THEATRE", status: { in: ["WAITING", "CLAIMED"] } },
      });
      if (queueEntry) {
        await tx.queueEntry.update({ where: { id: queueEntry.id }, data: { status: "CANCELLED" } });
      }
    }
  });

  res.json({ ok: true });
});

export default router;
