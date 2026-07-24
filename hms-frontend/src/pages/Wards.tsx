import { useState, useEffect, FormEvent } from "react";
import { BedDouble, Plus, Inbox } from "lucide-react";
import { api, ApiError } from "../api/client";
import { Card, SectionHeader, Badge, ErrorBanner } from "../components/ui";
import { Patient } from "../types";
import { PatientPicker } from "../components/PatientPicker";

export default function Wards() {
  const [wards, setWards] = useState<any[]>([]);
  const [referrals, setReferrals] = useState<{ waiting: any[]; mine: any[] }>({ waiting: [], mine: [] });
  const [error, setError] = useState<string | null>(null);

  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [encounterId, setEncounterId] = useState("");
  const [bedId, setBedId] = useState("");
  const [diagnosis, setDiagnosis] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});

  const load = async () => {
    try {
      const [w, q] = await Promise.all([api.get("/wards"), api.get("/queue/WARD")]);
      setWards(w);
      setReferrals(q);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load wards");
    }
  };
  useEffect(() => { load(); }, []);

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
  };

  const pickPatient = async (p: Patient) => {
    setSelectedPatient(p);
    const full = await api.get(`/patients/${p.id}`);
    const active = (full.encounters || []).find((e: any) => e.status !== "DISCHARGED" && e.status !== "ADMITTED");
    setEncounterId(active ? active.id : "");
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
  };

  const discharge = async (admissionId: string) => {
    await api.post(`/wards/admissions/${admissionId}/discharge`);
    await load();
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
                <button type="button" onClick={() => { setSelectedPatient(null); setEncounterId(""); }} className="text-xs text-slate-400 hover:text-rose-600">Clear</button>
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
            <label className="text-sm block">Admitting diagnosis<input value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" /></label>
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
                <p className="text-xs font-medium text-slate-500 mb-1.5">{w.name} <span className="text-slate-400">({w.type}) · KSh {Number(w.dailyRate).toLocaleString()}/night</span></p>
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
                            <div className="flex gap-1.5 mt-1.5">
                              <input
                                value={noteDrafts[admission.id] || ""}
                                onChange={(e) => setNoteDrafts((d) => ({ ...d, [admission.id]: e.target.value }))}
                                placeholder="Add nursing note..."
                                className="flex-1 border border-slate-300 rounded px-2 py-1 text-xs"
                              />
                              <button onClick={() => addNote(admission.id)} className="text-xs text-teal-700 hover:underline">Add</button>
                              <button onClick={() => discharge(admission.id)} className="text-xs bg-teal-800 text-white rounded px-2 py-1 hover:bg-teal-900">Discharge → Cashier</button>
                            </div>
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
