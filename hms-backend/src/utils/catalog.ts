import { prisma } from "../db";

// Prices are enforced server-side — never trust an amount sent by the
// client for anything that ends up on a patient's bill. Amounts are KES.
//
// This file covers the small number of flat, system-wide fees an admin
// can edit from the Pricing page (backed by the Setting key/value table)
// without a code change + redeploy. Everything else priced — lab tests
// (LabTest table), pharmacy items (InventoryItem.unitPrice), ward rates
// (Ward.dailyRate / doctorRoundFee), and theatre/equipment fees
// (EquipmentFeeItem) — already has its own table and is queried directly
// where it's used, so it doesn't need a getter here.

export const SETTING_DEFAULTS = {
  consultationFee: 500,
  emergencyWardVisitFee: 1000,
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;

export async function getSetting(key: SettingKey): Promise<number> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return row ? Number(row.value) : SETTING_DEFAULTS[key];
}

export async function getConsultationFee(): Promise<number> {
  return getSetting("consultationFee");
}

// Charged only when a doctor is called to the ward for a genuine
// after-hours/emergency visit — routine daytime ward rounds are covered by
// each ward's own doctorRoundFee (billed once per day at discharge), and
// neither of these is the same as the outpatient consultation fee above.
export async function getEmergencyWardVisitFee(): Promise<number> {
  return getSetting("emergencyWardVisitFee");
}
