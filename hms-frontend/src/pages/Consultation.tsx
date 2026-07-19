import { useState, useEffect, FormEvent } from "react";
import { Trash2, Pill, BedDouble, Scissors, LogOut as DischargeIcon, FlaskConical } from "lucide-react";
import { QueueBoard } from "../components/QueueBoard";
import { api, ApiError } from "../api/client";
import { QueueEntry, InventoryItem } from "../types";
import { ErrorBanner, money } from "../components/ui";

interface LabTest { id: string; name: string; price: number; }
type Decision = "LABORATORY" | "PHARMACY" | "THEATRE" | "DISCHARGE";

// ---------------- Initial consultation (first time seeing the patient) ----------------

function ConsultationForm({ entry, onDone }: { entry: QueueEntry; onDone: () => void }) {
  const p = entry.encounter.patient!;
  const triage = entry.encounter.triage;
  const [labTests, setLabTests] = useState<LabTest[]>([]);
  const [medicines, setMedicines] = useState<InventoryItem[]>([]);
  const [diagnosis, setDiagnosis] = useState("");
  const [notes, setNotes] = useState("");
  const [decision, setDecision] = useState<Decision | null>(null);
  const [selectedLabIds, setSelectedLabIds] = useState<string[]>([]);
  const [prescriptions, setPrescriptions] = useState<{ itemId: string; name: string; qty: number }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      const [catalog, inventory] = await Promise.all([api.get("/catalog"), api.get("/inventory?category=Medicine")]);
      setLabTests(catalog.labTests);
      setMedicines(inventory);
    })();
  }, []);

  const toggleLab = (id: string) => {
    setSelectedLabIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  };

  const addRx = (itemId: string) => {
    if (!itemId || prescriptions.find((r) => r.itemId === itemId)) return;
    const item = medicines.find((m) => m.id === itemId);
    if (!item) return;
    setPrescriptions((rx) => [...rx, { itemId, name: item.name, qty: 1 }]);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!decision) return;
    setError(null);
    setSubmitting(true);
    try {
      await api.post(`/encounters/${entry.encounterId}/consultation`, {
        decision,
        diagnosis: diagnosis || undefined,
        notes: notes || undefined,
        labTestIds: decision === "LABORATORY" ? selectedLabIds : [],
        prescriptions: decision === "PHARMACY" ? prescriptions.map((r) => ({ itemId: r.itemId, quantity: r.qty })) : [],
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save consultation");
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit =
    !!decision &&
    (decision !== "LABORATORY" || selectedLabIds.length > 0) &&
    (decision !== "PHARMACY" || prescriptions.length > 0);

  return (
    <form onSubmit={submit}>
      <p className="font-medium mb-1">{p.firstName} {p.lastName} <span className="text-slate-400 font-normal text-sm">({p.mrn})</span></p>
      {triage && (
        <div className="text-xs text-slate-500 mb-3 bg-slate-50 rounded-lg px-3 py-2">
          <p>Vitals: BP {triage.bp || "—"} · Temp {triage.temp ?? "—"}°C · Pulse {triage.pulse ?? "—"} · SpO2 {triage.spo2 ?? "—"}%</p>
          {triage.notes && <p className="mt-1"><span className="font-medium text-slate-600">Triage notes:</span> {triage.notes}</p>}
        </div>
      )}
      <ErrorBanner message={error} />
      <label className="text-sm block">Diagnosis
        <input value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
      </label>
      <label className="text-sm block mt-3">Clinical notes
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" rows={2} />
      </label>

      <p className="text-sm font-medium mt-4 mb-2">What next for this patient?</p>
      <div className="grid grid-cols-4 gap-2 mb-4">
        <button type="button" onClick={() => setDecision("LABORATORY")} className={`border rounded-lg px-2 py-2.5 text-xs flex flex-col items-center gap-1 ${decision === "LABORATORY" ? "border-teal-600 bg-teal-50" : "border-slate-200 hover:bg-slate-50"}`}>
          <FlaskConical size={16} /> Laboratory
        </button>
        <button type="button" onClick={() => setDecision("PHARMACY")} className={`border rounded-lg px-2 py-2.5 text-xs flex flex-col items-center gap-1 ${decision === "PHARMACY" ? "border-teal-600 bg-teal-50" : "border-slate-200 hover:bg-slate-50"}`}>
          <Pill size={16} /> Pharmacy
        </button>
        <button type="button" onClick={() => setDecision("THEATRE")} className={`border rounded-lg px-2 py-2.5 text-xs flex flex-col items-center gap-1 ${decision === "THEATRE" ? "border-teal-600 bg-teal-50" : "border-slate-200 hover:bg-slate-50"}`}>
          <Scissors size={16} /> Theatre
        </button>
        <button type="button" onClick={() => setDecision("DISCHARGE")} className={`border rounded-lg px-2 py-2.5 text-xs flex flex-col items-center gap-1 ${decision === "DISCHARGE" ? "border-teal-600 bg-teal-50" : "border-slate-200 hover:bg-slate-50"}`}>
          <DischargeIcon size={16} /> Discharge
        </button>
      </div>

      {decision === "LABORATORY" && (
        <div className="mb-4">
          <p className="text-sm font-medium mb-2">Order lab tests</p>
          <div className="grid grid-cols-2 gap-1.5">
            {labTests.map((t) => (
              <label key={t.id} className="text-xs flex items-center gap-2 border border-slate-200 rounded-lg px-2.5 py-1.5">
                <input type="checkbox" checked={selectedLabIds.includes(t.id)} onChange={() => toggleLab(t.id)} />
                {t.name} <span className="text-slate-400">({money(t.price)})</span>
              </label>
            ))}
          </div>
          <p className="text-xs text-slate-500 mt-2">This patient will go to the Laboratory queue, then come back to you here to review results.</p>
        </div>
      )}

      {decision === "PHARMACY" && (
        <div className="mb-4">
          <p className="text-sm font-medium mb-2">Prescribe medicines</p>
          <select onChange={(e) => { addRx(e.target.value); e.target.value = ""; }} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-2" defaultValue="">
            <option value="" disabled>Add medicine...</option>
            {medicines.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.quantity} {m.unit} in stock)</option>)}
          </select>
          {prescriptions.length > 0 && (
            <ul className="space-y-1.5">
              {prescriptions.map((r) => (
                <li key={r.itemId} className="flex items-center gap-2 text-sm bg-slate-50 rounded-lg px-3 py-1.5">
                  <span className="flex-1">{r.name}</span>
                  <input
                    type="number"
                    min={1}
                    value={r.qty}
                    onChange={(e) => setPrescriptions((rx) => rx.map((x) => (x.itemId === r.itemId ? { ...x, qty: Math.max(1, Number(e.target.value)) } : x)))}
                    className="w-16 border border-slate-300 rounded px-2 py-1 text-xs"
                  />
                  <button type="button" onClick={() => setPrescriptions((rx) => rx.filter((x) => x.itemId !== r.itemId))}>
                    <Trash2 size={14} className="text-slate-400 hover:text-rose-600" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {decision === "THEATRE" && (
        <p className="text-xs text-slate-500 mb-4">This sends the patient to the Theatre referral queue. Theatre staff will schedule the procedure — those charges get added to the bill once it's completed.</p>
      )}
      {decision === "DISCHARGE" && (
        <p className="text-xs text-slate-500 mb-4">No further treatment. The patient goes straight to Cashier for the consultation fee.</p>
      )}

      <button disabled={submitting || !canSubmit} className="mt-1 bg-teal-800 text-white rounded-lg py-2.5 px-5 text-sm font-medium hover:bg-teal-900 disabled:opacity-50">
        {submitting ? "Saving..." : "Save consultation"}
      </button>
    </form>
  );
}

// ---------------- Review after lab results ----------------

function ReviewForm({ entry, onDone }: { entry: QueueEntry; onDone: () => void }) {
  const p = entry.encounter.patient!;
  const completedLabs = (entry.encounter.labOrders || []).filter((o) => o.status === "COMPLETED");
  const [medicines, setMedicines] = useState<InventoryItem[]>([]);
  const [decision, setDecision] = useState<"PHARMACY" | "WARD" | "THEATRE" | "DISCHARGE" | null>(null);
  const [notes, setNotes] = useState("");
  const [prescriptions, setPrescriptions] = useState<{ itemId: string; name: string; qty: number }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => setMedicines(await api.get("/inventory?category=Medicine")))();
  }, []);

  const addRx = (itemId: string) => {
    if (!itemId || prescriptions.find((r) => r.itemId === itemId)) return;
    const item = medicines.find((m) => m.id === itemId);
    if (!item) return;
    setPrescriptions((rx) => [...rx, { itemId, name: item.name, qty: 1 }]);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!decision) return;
    setError(null);
    setSubmitting(true);
    try {
      await api.post(`/encounters/${entry.encounterId}/consultation-review`, {
        decision,
        notes: notes || undefined,
        prescriptions: decision === "PHARMACY" ? prescriptions.map((r) => ({ itemId: r.itemId, quantity: r.qty })) : [],
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save decision");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <p className="font-medium mb-1">{p.firstName} {p.lastName} <span className="text-slate-400 font-normal text-sm">({p.mrn})</span></p>
      <p className="text-xs text-slate-500 mb-3">Reviewing lab results</p>
      {entry.encounter.triage?.notes && (
        <p className="text-xs text-slate-500 mb-3 bg-slate-50 rounded-lg px-3 py-2"><span className="font-medium text-slate-600">Triage notes:</span> {entry.encounter.triage.notes}</p>
      )}
      <ErrorBanner message={error} />

      <div className="space-y-2 mb-4">
        {completedLabs.map((o) => (
          <div key={o.id} className="border border-slate-200 rounded-lg px-3 py-2 text-sm">
            <p className="font-medium">{o.testName}</p>
            <p className="text-slate-600">{o.result || "—"}</p>
          </div>
        ))}
        {completedLabs.length === 0 && <p className="text-sm text-slate-400">No completed lab results found for this visit.</p>}
      </div>

      <p className="text-sm font-medium mb-2">What next for this patient?</p>
      <div className="grid grid-cols-4 gap-2 mb-4">
        <button type="button" onClick={() => setDecision("PHARMACY")} className={`border rounded-lg px-3 py-2.5 text-sm flex flex-col items-center gap-1 ${decision === "PHARMACY" ? "border-teal-600 bg-teal-50" : "border-slate-200 hover:bg-slate-50"}`}>
          <Pill size={16} /> Send to pharmacy
        </button>
        <button type="button" onClick={() => setDecision("WARD")} className={`border rounded-lg px-3 py-2.5 text-sm flex flex-col items-center gap-1 ${decision === "WARD" ? "border-teal-600 bg-teal-50" : "border-slate-200 hover:bg-slate-50"}`}>
          <BedDouble size={16} /> Admit to ward
        </button>
        <button type="button" onClick={() => setDecision("THEATRE")} className={`border rounded-lg px-3 py-2.5 text-sm flex flex-col items-center gap-1 ${decision === "THEATRE" ? "border-teal-600 bg-teal-50" : "border-slate-200 hover:bg-slate-50"}`}>
          <Scissors size={16} /> Refer to theatre
        </button>
        <button type="button" onClick={() => setDecision("DISCHARGE")} className={`border rounded-lg px-3 py-2.5 text-sm flex flex-col items-center gap-1 ${decision === "DISCHARGE" ? "border-teal-600 bg-teal-50" : "border-slate-200 hover:bg-slate-50"}`}>
          <DischargeIcon size={16} /> Dismiss — no treatment needed
        </button>
      </div>

      {decision === "PHARMACY" && (
        <div className="mb-4">
          <p className="text-sm font-medium mb-2">Prescribe medicines</p>
          <select onChange={(e) => { addRx(e.target.value); e.target.value = ""; }} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-2" defaultValue="">
            <option value="" disabled>Add medicine...</option>
            {medicines.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.quantity} {m.unit} in stock)</option>)}
          </select>
          {prescriptions.length > 0 && (
            <ul className="space-y-1.5">
              {prescriptions.map((r) => (
                <li key={r.itemId} className="flex items-center gap-2 text-sm bg-slate-50 rounded-lg px-3 py-1.5">
                  <span className="flex-1">{r.name}</span>
                  <input type="number" min={1} value={r.qty} onChange={(e) => setPrescriptions((rx) => rx.map((x) => (x.itemId === r.itemId ? { ...x, qty: Math.max(1, Number(e.target.value)) } : x)))} className="w-16 border border-slate-300 rounded px-2 py-1 text-xs" />
                  <button type="button" onClick={() => setPrescriptions((rx) => rx.filter((x) => x.itemId !== r.itemId))}><Trash2 size={14} className="text-slate-400 hover:text-rose-600" /></button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {decision === "WARD" && (
        <p className="text-xs text-slate-500 mb-4">This sends the patient to the Wards referral queue. A ward nurse/doctor will claim them and assign a bed — no new charges are added here; ward stay is billed at discharge based on nights stayed.</p>
      )}
      {decision === "THEATRE" && (
        <p className="text-xs text-slate-500 mb-4">This sends the patient to the Theatre referral queue. Theatre staff will schedule the actual procedure (equipment, date/time, itemized fees) — those charges get added to the bill once the procedure is completed.</p>
      )}
      {decision === "DISCHARGE" && (
        <p className="text-xs text-slate-500 mb-4">No further treatment will be charged. The patient goes straight to Cashier for whatever was already billed (consultation + lab fees).</p>
      )}

      <label className="text-sm block mb-3">Notes (optional)
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" rows={2} />
      </label>

      <button disabled={submitting || !decision || (decision === "PHARMACY" && prescriptions.length === 0)} className="bg-teal-800 text-white rounded-lg py-2.5 px-5 text-sm font-medium hover:bg-teal-900 disabled:opacity-50">
        {submitting ? "Saving..." : "Confirm decision"}
      </button>
    </form>
  );
}

// ---------------- Ward round (doctor called to see an already-admitted patient) ----------------

type WardRoundDecision = "LABORATORY" | "PHARMACY" | "THEATRE" | "DISCHARGE" | "WARD";

function WardRoundForm({ entry, onDone }: { entry: QueueEntry; onDone: () => void }) {
  const p = entry.encounter.patient!;
  const [labTests, setLabTests] = useState<LabTest[]>([]);
  const [medicines, setMedicines] = useState<InventoryItem[]>([]);
  const [diagnosis, setDiagnosis] = useState("");
  const [notes, setNotes] = useState("");
  const [decision, setDecision] = useState<WardRoundDecision | null>(null);
  const [selectedLabIds, setSelectedLabIds] = useState<string[]>([]);
  const [prescriptions, setPrescriptions] = useState<{ itemId: string; name: string; qty: number }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      const [catalog, inventory] = await Promise.all([api.get("/catalog"), api.get("/inventory?category=Medicine")]);
      setLabTests(catalog.labTests);
      setMedicines(inventory);
    })();
  }, []);

  const toggleLab = (id: string) => {
    setSelectedLabIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  };
  const addRx = (itemId: string) => {
    if (!itemId || prescriptions.find((r) => r.itemId === itemId)) return;
    const item = medicines.find((m) => m.id === itemId);
    if (!item) return;
    setPrescriptions((rx) => [...rx, { itemId, name: item.name, qty: 1 }]);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!decision) return;
    setError(null);
    setSubmitting(true);
    try {
      await api.post(`/encounters/${entry.encounterId}/ward-round`, {
        decision,
        diagnosis: diagnosis || undefined,
        notes: notes || undefined,
        labTestIds: decision === "LABORATORY" ? selectedLabIds : [],
        prescriptions: decision === "PHARMACY" ? prescriptions.map((r) => ({ itemId: r.itemId, quantity: r.qty })) : [],
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save this ward round");
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit =
    !!decision &&
    (decision !== "LABORATORY" || selectedLabIds.length > 0) &&
    (decision !== "PHARMACY" || prescriptions.length > 0);

  return (
    <form onSubmit={submit}>
      <p className="font-medium mb-1">{p.firstName} {p.lastName} <span className="text-slate-400 font-normal text-sm">({p.mrn})</span></p>
      <p className="text-xs text-slate-500 mb-3 bg-slate-50 rounded-lg px-3 py-2">
        Ward round — {entry.encounter.admission?.bed ? `${entry.encounter.admission.bed.ward?.name || ""} bed ${entry.encounter.admission.bed.bedNumber}` : "currently admitted"}
        {entry.priority === "EMERGENCY" ? (
          <span className="block mt-1 text-amber-700">Emergency call-out — billed as a one-off Emergency ward visit fee.</span>
        ) : (
          <span className="block mt-1">Routine round — covered by the ward's standard daily rate, no extra charge here.</span>
        )}
      </p>
      <ErrorBanner message={error} />
      <label className="text-sm block">Diagnosis / assessment
        <input value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
      </label>
      <label className="text-sm block mt-3">Clinical notes
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" rows={2} />
      </label>

      <p className="text-sm font-medium mt-4 mb-2">What next for this patient?</p>
      <div className="grid grid-cols-5 gap-2 mb-4">
        <button type="button" onClick={() => setDecision("WARD")} className={`border rounded-lg px-2 py-2.5 text-xs flex flex-col items-center gap-1 ${decision === "WARD" ? "border-teal-600 bg-teal-50" : "border-slate-200 hover:bg-slate-50"}`}>
          <BedDouble size={16} /> Back to ward
        </button>
        <button type="button" onClick={() => setDecision("LABORATORY")} className={`border rounded-lg px-2 py-2.5 text-xs flex flex-col items-center gap-1 ${decision === "LABORATORY" ? "border-teal-600 bg-teal-50" : "border-slate-200 hover:bg-slate-50"}`}>
          <FlaskConical size={16} /> Laboratory
        </button>
        <button type="button" onClick={() => setDecision("PHARMACY")} className={`border rounded-lg px-2 py-2.5 text-xs flex flex-col items-center gap-1 ${decision === "PHARMACY" ? "border-teal-600 bg-teal-50" : "border-slate-200 hover:bg-slate-50"}`}>
          <Pill size={16} /> Pharmacy
        </button>
        <button type="button" onClick={() => setDecision("THEATRE")} className={`border rounded-lg px-2 py-2.5 text-xs flex flex-col items-center gap-1 ${decision === "THEATRE" ? "border-teal-600 bg-teal-50" : "border-slate-200 hover:bg-slate-50"}`}>
          <Scissors size={16} /> Theatre
        </button>
        <button type="button" onClick={() => setDecision("DISCHARGE")} className={`border rounded-lg px-2 py-2.5 text-xs flex flex-col items-center gap-1 ${decision === "DISCHARGE" ? "border-teal-600 bg-teal-50" : "border-slate-200 hover:bg-slate-50"}`}>
          <DischargeIcon size={16} /> Discharge
        </button>
      </div>

      {decision === "WARD" && (
        <p className="text-xs text-slate-500 mb-4">No change needed — the patient stays in the same bed.</p>
      )}

      {decision === "LABORATORY" && (
        <div className="mb-4">
          <p className="text-sm font-medium mb-2">Order lab tests</p>
          <div className="grid grid-cols-2 gap-1.5">
            {labTests.map((t) => (
              <label key={t.id} className="text-xs flex items-center gap-2 border border-slate-200 rounded-lg px-2.5 py-1.5">
                <input type="checkbox" checked={selectedLabIds.includes(t.id)} onChange={() => toggleLab(t.id)} />
                {t.name} <span className="text-slate-400">({money(t.price)})</span>
              </label>
            ))}
          </div>
          <p className="text-xs text-slate-500 mt-2">The bed stays reserved — this just sends a lab request; the patient remains admitted.</p>
        </div>
      )}

      {decision === "PHARMACY" && (
        <div className="mb-4">
          <p className="text-sm font-medium mb-2">Prescribe medicines</p>
          <select onChange={(e) => { addRx(e.target.value); e.target.value = ""; }} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-2" defaultValue="">
            <option value="" disabled>Add medicine...</option>
            {medicines.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.quantity} {m.unit} in stock)</option>)}
          </select>
          {prescriptions.length > 0 && (
            <ul className="space-y-1.5">
              {prescriptions.map((r) => (
                <li key={r.itemId} className="flex items-center gap-2 text-sm bg-slate-50 rounded-lg px-3 py-1.5">
                  <span className="flex-1">{r.name}</span>
                  <input
                    type="number"
                    min={1}
                    value={r.qty}
                    onChange={(e) => setPrescriptions((rx) => rx.map((x) => (x.itemId === r.itemId ? { ...x, qty: Math.max(1, Number(e.target.value)) } : x)))}
                    className="w-16 border border-slate-300 rounded px-2 py-1 text-xs"
                  />
                  <button type="button" onClick={() => setPrescriptions((rx) => rx.filter((x) => x.itemId !== r.itemId))}>
                    <Trash2 size={14} className="text-slate-400 hover:text-rose-600" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-slate-500 mt-2">Sends to pharmacy — once dispensed, the patient goes straight back to their ward bed.</p>
        </div>
      )}

      {decision === "THEATRE" && (
        <p className="text-xs text-slate-500 mb-4">Refers the patient to theatre. The bed is freed only once theatre schedules them — until then it stays held under this admission.</p>
      )}
      {decision === "DISCHARGE" && (
        <p className="text-xs text-slate-500 mb-4">Discharges the patient: bills for nights stayed, frees the bed, and sends them to Cashier for final billing.</p>
      )}

      <button disabled={submitting || !canSubmit} className="mt-1 bg-teal-800 text-white rounded-lg py-2.5 px-5 text-sm font-medium hover:bg-teal-900 disabled:opacity-50">
        {submitting ? "Saving..." : "Save & continue"}
      </button>
    </form>
  );
}

export default function Consultation() {
  return (
    <QueueBoard
      department="CONSULTATION"
      title="Consultation"
      subtitle="Doctor's assessment, lab orders, prescriptions, lab-result reviews and ward rounds"
      renderAction={(entry, onDone) => {
        const hasCompletedLab = (entry.encounter.labOrders || []).some((o) => o.status === "COMPLETED");
        if (hasCompletedLab) return <ReviewForm entry={entry} onDone={onDone} />;
        const isWardRound = !!entry.encounter.admission && !entry.encounter.admission.dischargedAt;
        if (isWardRound) return <WardRoundForm entry={entry} onDone={onDone} />;
        return <ConsultationForm entry={entry} onDone={onDone} />;
      }}
    />
  );
}
