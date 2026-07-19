import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { requireRole } from "../middleware/roles";
import { getConsultationFee } from "../utils/catalog";
import { logAction } from "../utils/audit";

const router = Router();

/** GET /catalog — consultation fee + active lab test/other-fee menus, for building forms client-side */
router.get("/", requireAuth, async (_req, res) => {
  const [consultationFee, tests, otherFees] = await Promise.all([
    getConsultationFee(),
    prisma.labTest.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.otherFee.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  ]);
  const labTests = tests.map((t) => ({ id: t.id, name: t.name, price: Number(t.price) }));
  res.json({
    consultationFee,
    labTests,
    otherFees: otherFees.map((f) => ({ id: f.id, name: f.name, price: Number(f.price) })),
  });
});

// ---------------- Lab tests ----------------

/** GET /catalog/lab-tests — admin view including inactive/retired tests, for the Pricing page */
router.get("/lab-tests", requireAuth, requireRole("ADMIN"), async (_req, res) => {
  const tests = await prisma.labTest.findMany({ orderBy: { name: "asc" } });
  res.json(tests);
});

const labTestSchema = z.object({ name: z.string().min(1), price: z.number().min(0) });

/** POST /catalog/lab-tests — admin only: add a new lab test to the menu */
router.post("/lab-tests", requireAuth, requireRole("ADMIN"), async (req: AuthedRequest, res) => {
  const parsed = labTestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const test = await prisma.labTest.create({ data: parsed.data }).catch(() => null);
  if (!test) return res.status(409).json({ error: "A lab test with that name already exists" });

  await logAction({ userId: req.user!.id, action: "lab_test.created", entityType: "LabTest", entityId: test.id });
  res.status(201).json(test);
});

const labTestUpdateSchema = z.object({ name: z.string().min(1).optional(), price: z.number().min(0).optional(), active: z.boolean().optional() });

/**
 * PATCH /catalog/lab-tests/:id — admin only: change price/name, or retire a
 * test (active: false) without touching any LabOrder already billed under
 * its old name/price.
 */
router.patch("/lab-tests/:id", requireAuth, requireRole("ADMIN"), async (req: AuthedRequest, res) => {
  const parsed = labTestUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const test = await prisma.labTest.update({ where: { id: req.params.id }, data: parsed.data }).catch(() => null);
  if (!test) return res.status(404).json({ error: "Lab test not found" });

  await logAction({ userId: req.user!.id, action: "lab_test.updated", entityType: "LabTest", entityId: test.id, details: parsed.data });
  res.json(test);
});

// ---------------- Other fees (catch-all catalog for ad-hoc charges) ----------------

/** GET /catalog/other-fees — admin view including inactive/retired fees, for the Pricing page */
router.get("/other-fees", requireAuth, requireRole("ADMIN"), async (_req, res) => {
  const fees = await prisma.otherFee.findMany({ orderBy: { name: "asc" } });
  res.json(fees);
});

const otherFeeSchema = z.object({ name: z.string().min(1), price: z.number().min(0) });

/** POST /catalog/other-fees — admin only: add a new miscellaneous fee to the catalog */
router.post("/other-fees", requireAuth, requireRole("ADMIN"), async (req: AuthedRequest, res) => {
  const parsed = otherFeeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const fee = await prisma.otherFee.create({ data: parsed.data }).catch(() => null);
  if (!fee) return res.status(409).json({ error: "A fee with that name already exists" });

  await logAction({ userId: req.user!.id, action: "other_fee.created", entityType: "OtherFee", entityId: fee.id });
  res.status(201).json(fee);
});

const otherFeeUpdateSchema = z.object({ name: z.string().min(1).optional(), price: z.number().min(0).optional(), active: z.boolean().optional() });

/** PATCH /catalog/other-fees/:id — admin only: change price/name, or retire a fee (active: false) */
router.patch("/other-fees/:id", requireAuth, requireRole("ADMIN"), async (req: AuthedRequest, res) => {
  const parsed = otherFeeUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const fee = await prisma.otherFee.update({ where: { id: req.params.id }, data: parsed.data }).catch(() => null);
  if (!fee) return res.status(404).json({ error: "Fee not found" });

  await logAction({ userId: req.user!.id, action: "other_fee.updated", entityType: "OtherFee", entityId: fee.id, details: parsed.data });
  res.json(fee);
});

export default router;
