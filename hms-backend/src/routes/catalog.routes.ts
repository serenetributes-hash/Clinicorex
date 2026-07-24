import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { CONSULTATION_FEE, LAB_TEST_CATALOG } from "../utils/catalog";

const router = Router();

/** GET /catalog — consultation fee + lab test list, for building forms client-side */
router.get("/", requireAuth, (_req, res) => {
  const labTests = Object.entries(LAB_TEST_CATALOG).map(([id, t]) => ({ id, name: t.name, price: t.price }));
  res.json({ consultationFee: CONSULTATION_FEE, labTests });
});

export default router;
