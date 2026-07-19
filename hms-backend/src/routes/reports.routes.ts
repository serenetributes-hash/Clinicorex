import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { requireRole } from "../middleware/roles";

const router = Router();

function periodRange(period: string | undefined): { gte: Date; lt: Date } | null {
  const now = new Date();
  if (period === "today") {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { gte: start, lt: end };
  }
  if (period === "month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return { gte: start, lt: end };
  }
  return null; // "all"
}

/**
 * GET /reports/collections?period=today|month|all
 * Cash counts the moment it's received; insurance only counts once a claim
 * is actually marked PAID — matching how the money really moves.
 */
router.get("/collections", requireAuth, requireRole("CASHIER"), async (req: AuthedRequest, res) => {
  const range = periodRange(req.query.period as string);

  const payments = await prisma.payment.findMany({
    where: {
      OR: [
        { method: "CASH", paidAt: range ? { gte: range.gte, lt: range.lt } : { not: null } },
        { method: "INSURANCE", claimStatus: "PAID", paidAt: range ? { gte: range.gte, lt: range.lt } : { not: null } },
      ],
    },
    include: { encounter: { include: { patient: true, billingItems: true } } },
  });

  let cash = 0;
  let insurance = 0;
  const byCategory: Record<string, number> = {};

  for (const p of payments) {
    const total = p.encounter.billingItems.reduce((s, i) => s + Number(i.amount), 0);
    if (p.method === "CASH") cash += total;
    else insurance += total;
    for (const item of p.encounter.billingItems) {
      const cat = item.category || "Other";
      byCategory[cat] = (byCategory[cat] || 0) + Number(item.amount);
    }
  }

  res.json({
    period: req.query.period || "all",
    totalCollected: cash + insurance,
    cash,
    insurancePaid: insurance,
    byCategory,
    transactionCount: payments.length,
  });
});

/** GET /reports/claims — all insurance claims with current status (not period-limited, since claims linger) */
router.get("/claims", requireAuth, requireRole("CASHIER"), async (_req, res) => {
  const claims = await prisma.payment.findMany({
    where: { method: "INSURANCE" },
    include: { encounter: { include: { patient: true, billingItems: true } } },
    orderBy: { claimSubmittedAt: "desc" },
  });

  const withTotals = claims.map((c) => ({
    ...c,
    amount: c.encounter.billingItems.reduce((s, i) => s + Number(i.amount), 0),
    patientName: `${c.encounter.patient.firstName} ${c.encounter.patient.lastName}`,
    mrn: c.encounter.patient.mrn,
  }));

  const outstandingValue = withTotals
    .filter((c) => c.claimStatus === "SUBMITTED" || c.claimStatus === "APPROVED")
    .reduce((s, c) => s + c.amount, 0);

  res.json({ claims: withTotals, outstandingValue });
});

/** GET /reports/expenses?period=today|month|all */
router.get("/expenses", requireAuth, requireRole("CASHIER"), async (req, res) => {
  const range = periodRange(req.query.period as string);
  const expenses = await prisma.expense.findMany({
    where: range ? { date: { gte: range.gte, lt: range.lt } } : undefined,
    orderBy: { date: "desc" },
  });
  res.json({ expenses, total: expenses.reduce((s, e) => s + Number(e.amount), 0) });
});

const expenseSchema = z.object({
  date: z.string().datetime(),
  category: z.enum(["Drug & supply procurement", "Salaries & wages", "Utilities", "Equipment maintenance", "Transport", "Other"]),
  amount: z.number().min(0.01),
  vendor: z.string().optional(),
  notes: z.string().optional(),
});

router.post("/expenses", requireAuth, requireRole("CASHIER"), async (req: AuthedRequest, res) => {
  const parsed = expenseSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const expense = await prisma.expense.create({
    data: { ...parsed.data, date: new Date(parsed.data.date), recordedById: req.user!.id },
  });
  res.status(201).json(expense);
});

router.delete("/expenses/:id", requireAuth, requireRole("CASHIER"), async (req, res) => {
  await prisma.expense.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

/** GET /reports/summary?period=today|month|all — the headline numbers for the Reports dashboard */
router.get("/summary", requireAuth, requireRole("CASHIER"), async (req: AuthedRequest, res) => {
  const period = (req.query.period as string) || "today";
  const range = periodRange(period);

  const [payments, expenses, claims] = await Promise.all([
    prisma.payment.findMany({
      where: {
        OR: [
          { method: "CASH", paidAt: range ? { gte: range.gte, lt: range.lt } : { not: null } },
          { method: "INSURANCE", claimStatus: "PAID", paidAt: range ? { gte: range.gte, lt: range.lt } : { not: null } },
        ],
      },
      include: { encounter: { include: { billingItems: true } } },
    }),
    prisma.expense.findMany({ where: range ? { date: { gte: range.gte, lt: range.lt } } : undefined }),
    prisma.payment.findMany({ where: { method: "INSURANCE", claimStatus: { in: ["SUBMITTED", "APPROVED"] } }, include: { encounter: { include: { billingItems: true } } } }),
  ]);

  const cash = payments.filter((p) => p.method === "CASH").reduce((s, p) => s + p.encounter.billingItems.reduce((s2, i) => s2 + Number(i.amount), 0), 0);
  const insurance = payments.filter((p) => p.method === "INSURANCE").reduce((s, p) => s + p.encounter.billingItems.reduce((s2, i) => s2 + Number(i.amount), 0), 0);
  const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount), 0);
  const pendingClaims = claims.reduce((s, c) => s + c.encounter.billingItems.reduce((s2, i) => s2 + Number(i.amount), 0), 0);

  res.json({
    period,
    totalCollected: cash + insurance,
    cash,
    insurancePaid: insurance,
    pendingClaims,
    totalExpenses,
    net: cash + insurance - totalExpenses,
  });
});

export default router;
