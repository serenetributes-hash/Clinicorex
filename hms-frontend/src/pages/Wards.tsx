import { useState, useEffect, FormEvent } from "react";
import { BedDouble, Plus, Inbox, Stethoscope, Pill, Trash2 } from "lucide-react";
import { api, ApiError } from "../api/client";
import { Card, SectionHeader, Badge, ErrorBanner } from "../components/ui";
import { Patient, InventoryItem } from "../types";
import { PatientPicker } from "../components/PatientPicker";

export default function Wards() {
  const [wards, setWards] = useState<any[]>([]);
  const [referrals, setReferrals] = useState<{ waiting: any[]; mine: any[] }>({ waiting: [], mine: [] });
  const [error, setError] = useState<string | null>(null);
  const [medicines, setMedicines] = useState<InventoryItem[]>([]);

  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [encounterId, setEncounterId] = useState("");
  const [bedId, setBedId] = useState("");
  const [diagnosis, setDiagnosis] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [orderingFor, setOrderingFor] = useState<string | null>(null);
  const [orderDrafts, setOrderDrafts] = useState<Record<string, { itemId: string; name: string; qty: number }[]>>({});

  const load = async () => {
    try {
      const [w, q] = await Promise.all([api.get("/wards"), api.get("/queue/WARD")]);
      setWards(w);
      setReferrals(q);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load wards");
    }
  };
  useEffect(() => { load(); (async () => setMedicines(await api.get("/inventory?category=Medicine")))(); }, []);

  const availableBeds = wards.flatMap((w) => w.beds.filter((b: any) => b.status === "AVAILABLE").map((b: any) => ({ ...b, wardName: w.name })));

  const claimReferral = async (id: string) => {
    setError(null);
    try {
      await api.post(`/queue/${id}/claim`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not claim this referral");
    }
  };

  const pickReferral = (entry: any) => {
    setSelectedPatient(entry.encounter.patient);
    setEncounterId(entry.encounterId);
    setDiagnosis(entry.encounter.consultations?.[0]?.diagnosis || "");
  };

  const pickPatient = async (p: Patient) => {
    setSelectedPatient(p);
    const full = await api.get(`/patients/${p.id}`);
    const active = (full.encounters || []).find((e: any) => e.status !== "DISCHARGED" && e.status !== "ADMITTED");
    setEncounterId(active ? active.id : "");
    // Prefills from this visit's most recent doctor's diagnosis when one
    // exists (e.g. referred here from consultation). Left blank — and
    // still freely editable — for a patient admitted straight from an
    // external referral with no diagnosis recorded in this system yet.
    const latestDiagnosis = active?.consultations?.length
      ? [...active.consultations].sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0]?.diagnosis
      : null;
    setDiagnosis(latestDiagnosis || "");
  };

  const admit = async (e: FormEvent) => {
    e.preventDefault();
    if (!encounterId || !bedId) return;
    setError(null);
    setSubmitting(true);
    try {
      await api.post("/wards/admissions", { encounterId, bedId, admittingDiagnosis: diagnosis || undefined });
      setSelectedPatient(null);
      setEncounterId("");
      setBedId("");
      setDiagnosis("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not admit patient");
    } finally {
      setSubmitting(false);
    }
  };

  const addNote = async (admissionId: string) => {
    const note = noteDrafts[admissionId];
    if (!note) return;
    await api.post(`/wards/admissions/${admissionId}/notes`, { note });
    setNoteDrafts((d) => ({ ...d, [admissionId]: "" }));
    await load();
  };

  const discharge = async (admissionId: string) => {
    await api.post(`/wards/admissions/${admissionId}/discharge`);
    await load();
  };

  const callDoctor = async (admissionId: string, emergency: boolean) => {
    setError(null);
    try {
      await api.post(`/wards/admissions/${admissionId}/call-doctor`, { emergency });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not call a doctor for this patient");
    }
  };

  const addOrderItem = (admissionId: string, itemId: string) => {
    if (!itemId) return;
    const item = medicines.find((m) => m.id === itemId);
    if (!item) return;
    setOrderDrafts((d) => {
      const current = d[admissionId] || [];
      if (current.find((r) => r.itemId === itemId)) return d;
      return { ...d, [admissionId]: [...current, { itemId, name: item.name, qty: 1 }] };
    });
  };

  const submitOrder = async (admissionId: string) => {
    const items = orderDrafts[admissionId] || [];
    if (items.length === 0) return;
    setError(null);
    try {
      await api.post(`/wards/admissions/${admissionId}/order-medicine`, {
        prescriptions: items.map((r) => ({ itemId: r.itemId, quantity: r.qty })),
      });
      setOrderDrafts((d) => ({ ...d, [admissionId]: [] }));
      setOrderingFor(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send this order to pharmacy");
    }
  };

  return (
    <div>
      <SectionHeader title="Wards" subtitle="Bed occupancy, admissions and inpatient care" />
      <ErrorBanner message={error} />

      {(referrals.waiting.length > 0 || referrals.mine.length > 0) && (
        <Card className="mb-5">
          <p className="font-medium text-sm mb-3 flex items-center gap-1.5"><Inbox size={15} /> Referrals from consultation</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-slate-500 mb-2">Awaiting claim ({referrals.waiting.length})</p>
              {referrals.waiting.length === 0 ? <p className="text-xs text-slate-400">None right now.</p> : (
                <ul className="space-y-1.5">
                  {referrals.waiting.map((r: any) => (
                    <li key={r.id} className="flex items-center justify-between border border-slate-200 rounded-lg px-3 py-1.5 text-sm">
                      <span>{r.encounter.patient.firstName} {r.encounter.patient.lastName} ({r.encounter.patient.mrn})</span>
                      <button onClick={() => claimReferral(r.id)} className="text-xs bg-teal-800 text-white rounded px-2 py-1 hover:bg-teal-900">Claim</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-2">Claimed by you ({referrals.mine.length})</p>
              {referrals.mine.length === 0 ? <p className="text-xs text-slate-400">None right now.</p> : (
                <ul className="space-y-1.5">
                  {referrals.mine.map((r: any) => (
                    <li key={r.id} className="flex items-center justify-between border border-teal-200 bg-teal-50 rounded-lg px-3 py-1.5 text-sm">
                      <span>{r.encounter.patient.firstName} {r.encounter.patient.lastName} ({r.encounter.patient.mrn})</span>
                      <button onClick={() => pickReferral(r)} className="text-xs text-teal-700 hover:underline">Admit this patient →</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-3 gap-5 mb-5">
        <Card>
          <p className="font-medium text-sm mb-3 flex items-center gap-1.5"><BedDouble size={15} /> Admit a patient</p>
          <form onSubmit={admit} className="space-y-2.5">
            {selectedPatient ? (
              <div className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2 text-sm">
                <span>{selectedPatient.firstName} {selectedPatient.lastName} ({selectedPatient.mrn})</span>
                <button type="button" onClick={() => { setSelectedPatient(null); setEncounterId(""); setDiagnosis(""); }} className="text-xs text-slate-400 hover:text-rose-600">Clear</button>
              </div>
            ) : (
              <div>
                <PatientPicker onSelect={pickPatient} />
              </div>
            )}
            {selectedPatient && !encounterId && (
              <p className="text-xs text-amber-700">No eligible active visit found for this patient (they may already be admitted or discharged).</p>
            )}
            <label className="text-sm block">Bed
              <select value={bedId} onChange={(e) => setBedId(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
                <option value="">Select an available bed...</option>
                {availableBeds.map((b) => <option key={b.id} value={b.id}>{b.wardName} — Bed {b.bedNumber}</option>)}
              </select>
            </label>
            <label className="text-sm block">Admitting diagnosis
              <input value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} placeholder="Auto-filled from the doctor's diagnosis, or type manually for an external referral" className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
            </label>
            <button disabled={submitting || !encounterId || !bedId} className="w-full bg-teal-800 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-teal-900 disabled:opacity-50 inline-flex items-center justify-center gap-1.5">
              <Plus size={15} /> Admit patient
            </button>
          </form>
        </Card>

        <Card className="col-span-2">
          <p className="font-medium text-sm mb-3">Ward occupancy</p>
          <div className="space-y-4 max-h-[520px] overflow-auto">
            {wards.map((w) => (
              <div key={w.id}>
                <p className="text-xs font-medium text-slate-500 mb-1.5">{w.name} <span className="text-slate-400">({w.type}) · KSh {Number(w.dailyRate).toLocaleString()}/night + KSh {Number(w.doctorRoundFee).toLocaleString()}/day doctor round</span></p>
                <div className="space-y-2">
                  {w.beds.map((b: any) => {
                    const admission = b.admissions?.[0];
                    return (
                      <div key={b.id} className="border border-slate-200 rounded-lg px-3 py-2 text-sm">
                        <div className="flex justify-between items-center">
                          <span>Bed {b.bedNumber}</span>
                          <Badge className={b.status === "OCCUPIED" ? "bg-amber-100 text-amber-800 border-amber-300" : "bg-emerald-100 text-emerald-800 border-emerald-300"}>{b.status}</Badge>
                        </div>
                        {admission && (
                          <div className="mt-1.5">
                            <p className="text-xs text-slate-600">{admission.encounter.patient.firstName} {admission.encounter.patient.lastName} ({admission.encounter.patient.mrn})</p>
                            <p className="text-xs text-slate-400">{admission.admittingDiagnosis || "No diagnosis noted"}</p>
                            {(admission.nursingNotes || []).length > 0 && (
                              <ul className="mt-1.5 space-y-0.5">
                                {admission.nursingNotes.map((n: any) => (
                                  <li key={n.id} className="text-xs text-slate-500">
                                    <span className="text-slate-400">{new Date(n.recordedAt).toLocaleString()}:</span> {n.note}
                                  </li>
                                ))}
                              </ul>
                            )}
                            <div className="flex flex-wrap gap-1.5 mt-1.5 items-center">
                              <input
                                value={noteDrafts[admission.id] || ""}
                                onChange={(e) => setNoteDrafts((d) => ({ ...d, [admission.id]: e.target.value }))}
                                placeholder="Add nursing note..."
                                className="flex-1 min-w-[120px] border border-slate-300 rounded px-2 py-1 text-xs"
                              />
                              <button onClick={() => addNote(admission.id)} className="text-xs text-teal-700 hover:underline">Add</button>
                            </div>
                            <div className="flex flex-wrap gap-1.5 mt-1.5">
                              <button onClick={() => callDoctor(admission.id, false)} className="text-xs bg-slate-100 text-slate-700 rounded px-2 py-1 hover:bg-slate-200 inline-flex items-center gap-1">
                                <Stethoscope size={12} /> Call doctor
                              </button>
                              <button onClick={() => callDoctor(admission.id, true)} className="text-xs bg-amber-100 text-amber-800 rounded px-2 py-1 hover:bg-amber-200 inline-flex items-center gap-1" title="After-hours/emergency call-out — billed separately">
                                <Stethoscope size={12} /> Emergency call
                              </button>
                              <button onClick={() => setOrderingFor(orderingFor === admission.id ? null : admission.id)} className="text-xs bg-slate-100 text-slate-700 rounded px-2 py-1 hover:bg-slate-200 inline-flex items-center gap-1">
                                <Pill size={12} /> Order medicine
                              </button>
                              <button onClick={() => discharge(admission.id)} className="text-xs bg-teal-800 text-white rounded px-2 py-1 hover:bg-teal-900">Discharge → Cashier</button>
                            </div>

                            {orderingFor === admission.id && (
                              <div className="mt-2 bg-slate-50 rounded-lg p-2">
                                <select onChange={(e) => { addOrderItem(admission.id, e.target.value); e.target.value = ""; }} className="w-full border border-slate-300 rounded px-2 py-1 text-xs mb-1.5" defaultValue="">
                                  <option value="" disabled>Add medicine...</option>
                                  {medicines.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.quantity} {m.unit} in stock)</option>)}
                                </select>
                                {(orderDrafts[admission.id] || []).length > 0 && (
                                  <ul className="space-y-1 mb-1.5">
                                    {(orderDrafts[admission.id] || []).map((r) => (
                                      <li key={r.itemId} className="flex items-center gap-1.5 text-xs bg-white rounded px-2 py-1">
                                        <span className="flex-1">{r.name}</span>
                                        <input
                                          type="number"
                                          min={1}
                                          value={r.qty}
                                          onChange={(e) => setOrderDrafts((d) => ({
                                            ...d,
                                            [admission.id]: (d[admission.id] || []).map((x) => x.itemId === r.itemId ? { ...x, qty: Math.max(1, Number(e.target.value)) } : x),
                                          }))}
                                          className="w-12 border border-slate-300 rounded px-1 py-0.5 text-xs"
                                        />
                                        <button onClick={() => setOrderDrafts((d) => ({ ...d, [admission.id]: (d[admission.id] || []).filter((x) => x.itemId !== r.itemId) }))}>
                                          <Trash2 size={12} className="text-slate-400 hover:text-rose-600" />
                                        </button>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                                <button onClick={() => submitOrder(admission.id)} disabled={(orderDrafts[admission.id] || []).length === 0} className="text-xs bg-teal-800 text-white rounded px-2 py-1 hover:bg-teal-900 disabled:opacity-50">
                                  Send to pharmacy
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
