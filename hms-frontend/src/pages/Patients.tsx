import { useState, useEffect } from "react";
import { Search, Users, Clock, Activity, Stethoscope, FlaskConical, BedDouble } from "lucide-react";
import { api, ApiError } from "../api/client";
import { Card, SectionHeader, Badge, ErrorBanner, money } from "../components/ui";
import { Patient } from "../types";
import { useAuth } from "../auth/AuthContext";

// Roles that see full clinical detail (vitals/notes, diagnosis, lab
// results, nursing notes) on a patient's profile. The backend also
// enforces this — this just matches it so the UI doesn't show empty
// sections to reception/cashier.
const CLINICAL_ROLES = ["ADMIN", "DOCTOR", "NURSE", "LAB_TECH", "PHARMACIST", "WARD_NURSE"];

const STATUS_COLORS: Record<string, string> = {
  REGISTERED: "bg-slate-100 text-slate-700 border-slate-300",
  TRIAGE: "bg-amber-100 text-amber-800 border-amber-300",
  CONSULTATION: "bg-teal-100 text-teal-800 border-teal-300",
  LABORATORY: "bg-purple-100 text-purple-800 border-purple-300",
  PHARMACY: "bg-sky-100 text-sky-800 border-sky-300",
  CASHIER: "bg-orange-100 text-orange-800 border-orange-300",
  AWAITING_ADMISSION: "bg-indigo-100 text-indigo-800 border-indigo-300",
  AWAITING_THEATRE: "bg-fuchsia-100 text-fuchsia-800 border-fuchsia-300",
  ADMITTED: "bg-indigo-100 text-indigo-800 border-indigo-300",
  DISCHARGED: "bg-emerald-100 text-emerald-800 border-emerald-300",
};

export default function Patients() {
  const { user } = useAuth();
  const canSeeClinical = !!user && CLINICAL_ROLES.includes(user.role);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Patient[]>([]);
  const [selected, setSelected] = useState<Patient | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!search.trim()) {
      setResults([]);
      return;
    }
    const handle = setTimeout(async () => {
      try {
        setResults(await api.get(`/patients?search=${encodeURIComponent(search.trim())}`));
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Search failed");
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [search]);

  const select = async (p: Patient) => {
    try {
      setSelected(await api.get(`/patients/${p.id}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load patient");
    }
  };

  return (
    <div>
      <SectionHeader title="Patients" subtitle="Search patients and review their full visit history" />
      <ErrorBanner message={error} />
      <div className="grid grid-cols-3 gap-5">
        <Card className="col-span-1">
          <div className="relative mb-3">
            <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, MRN, phone, or ID number"
              className="w-full border border-slate-300 rounded-lg pl-8 pr-3 py-2 text-sm"
            />
          </div>
          {results.length === 0 ? (
            <p className="text-sm text-slate-400">Search to find a patient.</p>
          ) : (
            <ul className="space-y-2 max-h-[520px] overflow-auto">
              {results.map((p) => (
                <li key={p.id}>
                  <button onClick={() => select(p)} className={`w-full text-left px-3 py-2 rounded-lg border text-sm ${selected?.id === p.id ? "border-teal-600 bg-teal-50" : "border-slate-200 hover:bg-slate-50"}`}>
                    <p className="font-medium">{p.firstName} {p.lastName}</p>
                    <p className="text-xs text-slate-500">{p.mrn}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="col-span-2">
          {!selected ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400 border border-dashed border-slate-300 rounded-xl">
              <Users size={28} className="mb-2" />
              <p className="text-sm">Select a patient to view their visit history.</p>
            </div>
          ) : (
            <div>
              <div className="mb-4">
                <p className="font-medium">{selected.firstName} {selected.lastName} <span className="text-slate-400 font-normal text-sm">({selected.mrn})</span></p>
                <p className="text-xs text-slate-500">{selected.gender} · {selected.phone || "no phone"} · {selected.insuranceProvider ? `Insured — ${selected.insuranceProvider}` : "No insurance on file"}</p>
              </div>
              <div className="space-y-4">
                {(selected.encounters || []).map((enc: any) => (
                  <div key={enc.id} className="border border-slate-200 rounded-lg p-3">
                    <div className="flex justify-between items-center mb-2">
                      <p className="text-sm font-medium">{enc.type} visit — {new Date(enc.registeredAt).toLocaleDateString()}</p>
                      <Badge className={STATUS_COLORS[enc.status] || "bg-slate-100 text-slate-700 border-slate-300"}>{enc.status}</Badge>
                    </div>
                    {enc.chiefComplaint && <p className="text-xs text-slate-500 mb-1">Complaint: {enc.chiefComplaint}</p>}

                    {canSeeClinical && (
                      <div className="space-y-2 mt-2">
                        {enc.triage && (enc.triage.bp || enc.triage.notes) && (
                          <div className="bg-slate-50 rounded-lg px-3 py-2">
                            <p className="text-xs font-medium text-slate-600 flex items-center gap-1"><Activity size={11} /> Triage</p>
                            <p className="text-xs text-slate-500 mt-0.5">BP {enc.triage.bp || "—"} · Temp {enc.triage.temp ?? "—"}°C · Pulse {enc.triage.pulse ?? "—"} · SpO2 {enc.triage.spo2 ?? "—"}%</p>
                            {enc.triage.notes && <p className="text-xs text-slate-500 mt-0.5">{enc.triage.notes}</p>}
                          </div>
                        )}

                        {(enc.consultations || []).filter((c: any) => c.diagnosis || c.notes).map((c: any) => (
                          <div key={c.id} className="bg-slate-50 rounded-lg px-3 py-2">
                            <p className="text-xs font-medium text-slate-600 flex items-center gap-1"><Stethoscope size={11} /> Doctor's note — {new Date(c.createdAt).toLocaleString()}</p>
                            {c.diagnosis && <p className="text-xs text-slate-500 mt-0.5">Diagnosis: {c.diagnosis}</p>}
                            {c.notes && <p className="text-xs text-slate-500 mt-0.5">{c.notes}</p>}
                          </div>
                        ))}

                        {(enc.labOrders || []).length > 0 && (
                          <div className="bg-slate-50 rounded-lg px-3 py-2">
                            <p className="text-xs font-medium text-slate-600 flex items-center gap-1"><FlaskConical size={11} /> Laboratory</p>
                            {enc.labOrders.map((o: any) => (
                              <p key={o.id} className="text-xs text-slate-500 mt-0.5">{o.testName}: {o.result || "Pending"}</p>
                            ))}
                          </div>
                        )}

                        {enc.admission && (
                          <div className="bg-slate-50 rounded-lg px-3 py-2">
                            <p className="text-xs font-medium text-slate-600 flex items-center gap-1"><BedDouble size={11} /> Ward stay{enc.admission.bed ? ` — ${enc.admission.bed.ward?.name || ""} bed ${enc.admission.bed.bedNumber}` : ""}</p>
                            {enc.admission.admittingDiagnosis && <p className="text-xs text-slate-500 mt-0.5">Admitting diagnosis: {enc.admission.admittingDiagnosis}</p>}
                            {(enc.admission.nursingNotes || []).map((n: any) => (
                              <p key={n.id} className="text-xs text-slate-500 mt-0.5">{new Date(n.recordedAt).toLocaleString()}: {n.note}</p>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {enc.billingItems?.length > 0 && (
                      <div className="mt-2">
                        <p className="text-xs font-medium text-slate-600 mb-1 flex items-center gap-1"><Clock size={11} /> Billing</p>
                        <table className="w-full text-xs">
                          <tbody>
                            {enc.billingItems.map((it: any) => (
                              <tr key={it.id} className="border-b border-slate-100">
                                <td className="py-1">{it.description}</td>
                                <td className="py-1 text-right">{money(it.amount)}</td>
                              </tr>
                            ))}
                            <tr>
                              <td className="pt-1 font-medium">Total</td>
                              <td className="pt-1 font-semibold text-right">{money(enc.billingItems.reduce((s: number, i: any) => s + Number(i.amount), 0))}</td>
                            </tr>
                          </tbody>
                        </table>
                        {enc.payment && (
                          <p className="text-xs text-slate-500 mt-1">
                            {enc.payment.method === "CASH"
                              ? "Paid in cash"
                              : `Insurance claim: ${enc.payment.claimStatus} (${enc.payment.insuranceProvider || "—"})`}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                ))}
                {(!selected.encounters || selected.encounters.length === 0) && (
                  <p className="text-sm text-slate-400">No visits recorded yet.</p>
                )}
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
