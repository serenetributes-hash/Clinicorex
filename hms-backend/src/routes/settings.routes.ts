import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { requireRole } from "../middleware/roles";
import { SETTING_DEFAULTS, SettingKey } from "../utils/catalog";
import { logAction } from "../utils/audit";

const router = Router();

/** GET /settings — admin only: every editable flat fee, DB override or default */
router.get("/", requireAuth, requireRole("ADMIN"), async (_req, res) => {
  const rows = await prisma.setting.findMany();
  const byKey = Object.fromEntries(rows.map((r) => [r.key, Number(r.value)]));
  const result = Object.fromEntries(
    (Object.keys(SETTING_DEFAULTS) as SettingKey[]).map((key) => [key, byKey[key] ?? SETTING_DEFAULTS[key]])
  );
  res.json(result);
});

const updateSchema = z.object({ value: z.number().min(0) });

/** PUT /settings/:key — admin only: set (or reset, via the default) one fee */
router.put("/:key", requireAuth, requireRole("ADMIN"), async (req: AuthedRequest, res) => {
  const key = req.params.key as SettingKey;
  if (!(key in SETTING_DEFAULTS)) return res.status(404).json({ error: `Unknown setting "${key}"` });

  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  await prisma.setting.upsert({
    where: { key },
    create: { key, value: String(parsed.data.value) },
    update: { value: String(parsed.data.value) },
  });

  await logAction({ userId: req.user!.id, action: "setting.updated", entityType: "Setting", entityId: key, details: { value: parsed.data.value } });
  res.json({ key, value: parsed.data.value });
});

export default router;
