import { useState, FormEvent } from "react";
import { UserPlus, UserCheck, CheckCircle2 } from "lucide-react";
import { api, ApiError } from "../api/client";
import { Card, SectionHeader, ErrorBanner } from "../components/ui";
import { Patient } from "../types";
import { PatientPicker } from "../components/PatientPicker";

const emptyForm = {
  firstName: "",
  lastName: "",
  gender: "FEMALE",
  phone: "",
  nationalId: "",
  isInsured: false,
  insuranceProvider: "",
  insuranceNo: "",
  chiefComplaint: "",
  type: "OUTPATIENT",
};

export default function Reception() {
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [regSuccess, setRegSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Returning-patient visit is entirely separate state from the new-patient
  // registration form above — filling one never requires touching the other.
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [visitForm, setVisitForm] = useState({ chiefComplaint: "", type: "OUTPATIENT" });
  const [visitSuccess, setVisitSuccess] = useState<string | null>(null);
  const [startingVisit, setStartingVisit] = useState(false);

  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const submitNew = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setRegSuccess(null);
    setSubmitting(true);
    try {
      const res = await api.post("/patients/register", {
        firstName: form.firstName,
        lastName: form.lastName,
        gender: form.gender,
        phone: form.phone || undefined,
        nationalId: form.nationalId || undefined,
        insuranceProvider: form.isInsured ? form.insuranceProvider : undefined,
        insuranceNo: form.isInsured ? form.insuranceNo : undefined,
        chiefComplaint: form.chiefComplaint || undefined,
        type: form.type,
      });
      setRegSuccess(`${res.patient.firstName} ${res.patient.lastName} registered — ${res.patient.mrn}. Sent to triage.`);
      setForm(emptyForm);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not register patient");
    } finally {
      setSubmitting(false);
    }
  };

  const selectReturningPatient = (p: Patient) => {
    setSelectedPatient(p);
    setVisitForm({ chiefComplaint: "", type: "OUTPATIENT" });
    setVisitSuccess(null);
    setError(null);
  };

  const startVisit = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedPatient) return;
    setError(null);
    setVisitSuccess(null);
    setStartingVisit(true);
    try {
      await api.post(`/patients/${selectedPatient.id}/visit`, {
        chiefComplaint: visitForm.chiefComplaint || undefined,
        type: visitForm.type,
      });
      setVisitSuccess(`${selectedPatient.firstName} ${selectedPatient.lastName} (${selectedPatient.mrn}) sent to triage.`);
      setSelectedPatient(null);
      setVisitForm({ chiefComplaint: "", type: "OUTPATIENT" });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not start visit");
    } finally {
      setStartingVisit(false);
    }
  };

  return (
    <div>
      <SectionHeader title="Reception" subtitle="Register a new patient or start a visit for a returning patient" />
      <ErrorBanner message={error} />

      <div className="grid grid-cols-2 gap-5">
        <Card>
          <p className="font-medium text-sm mb-3 flex items-center gap-1.5"><UserPlus size={15} /> New patient</p>
          {regSuccess && <div className="mb-3 px-3 py-2 rounded-lg bg-emerald-50 text-emerald-700 text-xs border border-emerald-200 flex items-start gap-1.5"><CheckCircle2 size={14} className="mt-0.5 shrink-0" /> {regSuccess}</div>}
          <form onSubmit={submitNew} className="grid grid-cols-2 gap-3">
            <label className="text-sm">First name
              <input required value={form.firstName} onChange={(e) => set("firstName", e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
            </label>
            <label className="text-sm">Last name
              <input required value={form.lastName} onChange={(e) => set("lastName", e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
            </label>
            <label className="text-sm">Gender
              <select value={form.gender} onChange={(e) => set("gender", e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
                <option value="FEMALE">Female</option>
                <option value="MALE">Male</option>
                <option value="OTHER">Other</option>
              </select>
            </label>
            <label className="text-sm">Phone
              <input value={form.phone} onChange={(e) => set("phone", e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
            </label>
            <label className="text-sm col-span-2">National ID (optional, but recommended — used for lookup later)
              <input value={form.nationalId} onChange={(e) => set("nationalId", e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
            </label>
            <label className="text-sm col-span-2">Visit type
              <select value={form.type} onChange={(e) => set("type", e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
                <option value="OUTPATIENT">Outpatient</option>
                <option value="EMERGENCY">Emergency</option>
              </select>
            </label>
            <label className="text-sm col-span-2">Chief complaint
              <input value={form.chiefComplaint} onChange={(e) => set("chiefComplaint", e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" placeholder="Reason for visit" />
            </label>
            <label className="text-sm col-span-2 flex items-center gap-2 mt-1">
              <input type="checkbox" checked={form.isInsured} onChange={(e) => set("isInsured", e.target.checked)} />
              Patient has insurance cover
            </label>
            {form.isInsured && (
              <>
                <label className="text-sm">Insurance provider
                  <input value={form.insuranceProvider} onChange={(e) => set("insuranceProvider", e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
                </label>
                <label className="text-sm">Policy / member no.
                  <input value={form.insuranceNo} onChange={(e) => set("insuranceNo", e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
                </label>
              </>
            )}
            <button disabled={submitting} className="col-span-2 mt-2 bg-teal-800 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-teal-900 disabled:opacity-50">
              {submitting ? "Registering..." : "Register & send to triage"}
            </button>
          </form>
        </Card>

        <Card>
          <p className="font-medium text-sm mb-3 flex items-center gap-1.5"><UserCheck size={15} /> Returning patient</p>
          {visitSuccess && <div className="mb-3 px-3 py-2 rounded-lg bg-emerald-50 text-emerald-700 text-xs border border-emerald-200 flex items-start gap-1.5"><CheckCircle2 size={14} className="mt-0.5 shrink-0" /> {visitSuccess}</div>}

          {!selectedPatient ? (
            <>
              <PatientPicker onSelect={selectReturningPatient} />
              <p className="text-xs text-slate-400 mt-3">Start typing a name, MRN, phone number, or national ID — matching patients appear as you type.</p>
            </>
          ) : (
            <form onSubmit={startVisit}>
              <div className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2 mb-3">
                <div className="text-sm">
                  <p className="font-medium">{selectedPatient.firstName} {selectedPatient.lastName}</p>
                  <p className="text-xs text-slate-500">{selectedPatient.mrn} · {selectedPatient.phone || "no phone"}{selectedPatient.insuranceProvider ? ` · Insured — ${selectedPatient.insuranceProvider}` : ""}</p>
                </div>
                <button type="button" onClick={() => setSelectedPatient(null)} className="text-xs text-slate-400 hover:text-rose-600">Change</button>
              </div>
              <label className="text-sm block mb-3">Visit type
                <select value={visitForm.type} onChange={(e) => setVisitForm((f) => ({ ...f, type: e.target.value }))} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
                  <option value="OUTPATIENT">Outpatient</option>
                  <option value="EMERGENCY">Emergency</option>
                </select>
              </label>
              <label className="text-sm block mb-3">Chief complaint (today's visit)
                <input value={visitForm.chiefComplaint} onChange={(e) => setVisitForm((f) => ({ ...f, chiefComplaint: e.target.value }))} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" placeholder="Reason for this visit" />
              </label>
              <button disabled={startingVisit} className="bg-teal-800 text-white rounded-lg py-2.5 px-5 text-sm font-medium hover:bg-teal-900 disabled:opacity-50">
                {startingVisit ? "Starting..." : "Start visit & send to triage"}
              </button>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}
