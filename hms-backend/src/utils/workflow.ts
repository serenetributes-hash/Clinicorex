import { Department, Priority, PrismaClient } from "@prisma/client";

type TxClient = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

/**
 * Puts an encounter into a department's shared queue as WAITING, unless it's
 * already actively sitting there (WAITING or CLAIMED) — this stops duplicate
 * queue cards showing up if an action is retried.
 */
export async function enqueue(
  tx: TxClient,
  encounterId: string,
  department: Department,
  priority: Priority = "NORMAL"
) {
  const existingActive = await tx.queueEntry.findFirst({
    where: { encounterId, department, status: { in: ["WAITING", "CLAIMED"] } },
  });
  if (existingActive) return existingActive;

  return tx.queueEntry.create({
    data: { encounterId, department, priority, status: "WAITING" },
  });
}

/** After lab results are entered, the patient always goes back to the
 * doctor to review results — the doctor then decides pharmacy, ward, or
 * discharge via the consultation-review step. */
export function nextAfterLab(): Department {
  return "CONSULTATION";
}

/**
 * Discharges an active admission: bills for nights stayed (ward's daily
 * rate, minimum 1 night), frees the bed, and sends the patient to the
 * Cashier queue for final billing. Shared by the Wards page's own
 * discharge button and a doctor's "discharge" decision during a ward
 * round, so both go through exactly the same billing math.
 */
export async function dischargeAdmission(
  tx: TxClient,
  admission: { id: string; encounterId: string; bedId: string; admittedAt: Date; bed: { ward: { dailyRate: any; doctorRoundFee: any; name: string } } }
) {
  const dischargedAt = new Date();
  const msPerDay = 1000 * 60 * 60 * 24;
  const nights = Math.max(1, Math.ceil((dischargedAt.getTime() - admission.admittedAt.getTime()) / msPerDay));
  const wardCharge = Number(admission.bed.ward.dailyRate) * nights;
  const doctorRoundCharge = Number(admission.bed.ward.doctorRoundFee) * nights;

  await tx.admission.update({ where: { id: admission.id }, data: { dischargedAt } });
  await tx.bed.update({ where: { id: admission.bedId }, data: { status: "AVAILABLE" } });
  if (wardCharge > 0) {
    await tx.billingItem.create({
      data: {
        encounterId: admission.encounterId,
        description: `Ward: ${admission.bed.ward.name} — ${nights} night(s) @ ${admission.bed.ward.dailyRate}`,
        amount: wardCharge,
        category: "Ward/Admission",
      },
    });
  }
  if (doctorRoundCharge > 0) {
    // Standard daily rate covering routine doctor rounds during the stay —
    // separate line item from the bed/board charge above, and from any
    // one-off emergency call-out fees billed individually when incurred.
    await tx.billingItem.create({
      data: {
        encounterId: admission.encounterId,
        description: `Doctor's ward round — ${nights} day(s) @ ${admission.bed.ward.doctorRoundFee}`,
        amount: doctorRoundCharge,
        category: "Consultation",
      },
    });
  }
  await tx.encounter.update({ where: { id: admission.encounterId }, data: { status: "CASHIER" } });
  await enqueue(tx, admission.encounterId, "CASHIER");

  return { nights, wardCharge, doctorRoundCharge };
}
