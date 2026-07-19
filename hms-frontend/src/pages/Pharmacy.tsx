import { useState } from "react";
import { QueueBoard } from "../components/QueueBoard";
import { api, ApiError } from "../api/client";
import { QueueEntry } from "../types";
import { Badge, ErrorBanner } from "../components/ui";

function PharmacyPanel({ entry, onDone }: { entry: QueueEntry; onDone: () => void }) {
  const p = entry.encounter.patient!;
  const prescriptions = (entry.encounter.prescriptions || []).filter((rx) => !rx.dispensed);
  const isInpatient = !!entry.encounter.admission && !entry.encounter.admission.dischargedAt;
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const dispense = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await api.post(`/encounters/${entry.encounterId}/dispense`);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not dispense");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <p className="font-medium mb-1">{p.firstName} {p.lastName} <span className="text-slate-400 font-normal text-sm">({p.mrn})</span></p>
      {isInpatient && <p className="text-xs text-slate-500 mb-3">Inpatient — will return to their ward bed after dispensing.</p>}
      <ErrorBanner message={error} />
      {prescriptions.length === 0 ? (
        <p className="text-sm text-slate-400 mb-4">No pending prescriptions for this patient.</p>
      ) : (
        <ul className="space-y-2 mb-4">
          {prescriptions.map((rx) => {
            const short = rx.item.quantity < rx.quantity;
            return (
              <li key={rx.id} className="flex justify-between items-center border border-slate-200 rounded-lg px-3 py-2 text-sm">
                <span>{rx.item.name} × {rx.quantity}</span>
                {short ? (
                  <Badge className="bg-rose-100 text-rose-800 border-rose-300">Insufficient stock ({rx.item.quantity} left)</Badge>
                ) : (
                  <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300">In stock</Badge>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <button
        onClick={dispense}
        disabled={submitting || prescriptions.length === 0}
        className="bg-teal-800 text-white rounded-lg py-2.5 px-5 text-sm font-medium hover:bg-teal-900 disabled:opacity-50"
      >
        {submitting ? "Dispensing..." : isInpatient ? "Dispense & return to ward" : "Dispense & send to cashier"}
      </button>
    </div>
  );
}

export default function Pharmacy() {
  return (
    <QueueBoard
      department="PHARMACY"
      title="Pharmacy"
      subtitle="Dispense prescribed medicines and update stock"
      renderAction={(entry, onDone) => <PharmacyPanel entry={entry} onDone={onDone} />}
    />
  );
}
