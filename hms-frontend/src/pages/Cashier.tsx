import { useState, useEffect, FormEvent } from "react";
import { Plus } from "lucide-react";
import { QueueBoard } from "../components/QueueBoard";
import { api, ApiError } from "../api/client";
import { QueueEntry } from "../types";
import { ErrorBanner, money } from "../components/ui";

interface OtherFee { id: string; name: string; price: number; }

function AddFee({ entry, refresh }: { entry: QueueEntry; refresh: () => void }) {
  const [catalog, setCatalog] = useState<OtherFee[]>([]);
  const [otherFeeId, setOtherFeeId] = useState("");
  const [customDescription, setCustomDescription] = useState("");
  const [customAmount, setCustomAmount] = useState("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => setCatalog((await api.get("/catalog")).otherFees))();
  }, []);

  const addFromCatalog = async (id: string) => {
    if (!id) return;
    setError(null);
    setSubmitting(true);
    try {
      await api.post(`/encounters/${entry.encounterId}/billing-items`, { otherFeeId: id });
      setOtherFeeId("");
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add this fee");
    } finally {
      setSubmitting(false);
    }
  };

  const addCustom = async (e: FormEvent) => {
    e.preventDefault();
    const amount = Number(customAmount);
    if (!customDescription || !Number.isFinite(amount) || amount < 0) return;
    setError(null);
    setSubmitting(true);
    try {
      await api.post(`/encounters/${entry.encounterId}/billing-items`, { description: customDescription, amount });
      setCustomDescription("");
      setCustomAmount("");
      setOpen(false);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add this charge");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mb-3">
      <ErrorBanner message={error} />
      <div className="flex gap-1.5">
        <select
          value={otherFeeId}
          onChange={(e) => { setOtherFeeId(e.target.value); addFromCatalog(e.target.value); }}
          disabled={submitting}
          className="flex-1 border border-slate-300 rounded-lg px-2 py-1.5 text-xs"
          defaultValue=""
        >
          <option value="" disabled>Add a fee...</option>
          {catalog.map((f) => <option key={f.id} value={f.id}>{f.name} ({money(f.price)})</option>)}
        </select>
        <button type="button" onClick={() => setOpen((o) => !o)} className="text-xs bg-slate-100 text-slate-700 rounded-lg px-2.5 py-1.5 hover:bg-slate-200 inline-flex items-center gap-1">
          <Plus size={12} /> Custom
        </button>
      </div>
      {open && (
        <form onSubmit={addCustom} className="flex gap-1.5 mt-1.5">
          <input value={customDescription} onChange={(e) => setCustomDescription(e.target.value)} placeholder="Description" className="flex-1 border border-slate-300 rounded-lg px-2 py-1.5 text-xs" />
          <input type="number" min={0} value={customAmount} onChange={(e) => setCustomAmount(e.target.value)} placeholder="KSh" className="w-20 border border-slate-300 rounded-lg px-2 py-1.5 text-xs" />
          <button disabled={submitting} className="text-xs bg-teal-800 text-white rounded-lg px-2.5 py-1.5 hover:bg-teal-900 disabled:opacity-50">Add</button>
        </form>
      )}
    </div>
  );
}

function CashierForm({ entry, onDone, refresh }: { entry: QueueEntry; onDone: () => void; refresh: () => void }) {
  const p = entry.encounter.patient!;
  const items = entry.encounter.billingItems || [];
  const total = items.reduce((s, i) => s + Number(i.amount), 0);
  const [method, setMethod] = useState<"CASH" | "INSURANCE">(p.insuranceProvider ? "INSURANCE" : "CASH");
  const [provider, setProvider] = useState(p.insuranceProvider || "");
  const [claimNo, setClaimNo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.post(`/encounters/${entry.encounterId}/payment`, {
        method,
        insuranceProvider: method === "INSURANCE" ? provider : undefined,
        claimNo: method === "INSURANCE" ? claimNo : undefined,
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not record payment");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <p className="font-medium mb-3">{p.firstName} {p.lastName} <span className="text-slate-400 font-normal text-sm">({p.mrn})</span></p>
      <ErrorBanner message={error} />
      <table className="w-full text-sm mb-3">
        <tbody>
          {items.map((it) => (
            <tr key={it.id} className="border-b border-slate-100">
              <td className="py-1.5">{it.description}</td>
              <td className="py-1.5 text-right">{money(it.amount)}</td>
            </tr>
          ))}
          <tr>
            <td className="pt-2 font-medium">Total due</td>
            <td className="pt-2 font-semibold text-right">{money(total)}</td>
          </tr>
        </tbody>
      </table>
      <AddFee entry={entry} refresh={refresh} />
      <div className="flex gap-4 mb-3">
        <label className="text-sm flex items-center gap-1.5"><input type="radio" checked={method === "CASH"} onChange={() => setMethod("CASH")} /> Cash</label>
        <label className="text-sm flex items-center gap-1.5"><input type="radio" checked={method === "INSURANCE"} onChange={() => setMethod("INSURANCE")} /> Insurance</label>
      </div>
      {method === "INSURANCE" && (
        <div className="grid grid-cols-2 gap-3 mb-3">
          <label className="text-sm">Insurance provider<input required value={provider} onChange={(e) => setProvider(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" /></label>
          <label className="text-sm">Claim / approval no.<input value={claimNo} onChange={(e) => setClaimNo(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" /></label>
          <p className="col-span-2 text-xs text-slate-500 -mt-1">This submits a claim. It won't count as collected until it's marked "Paid" under Reports → Insurance claims.</p>
        </div>
      )}
      <button disabled={submitting} className="bg-teal-800 text-white rounded-lg py-2.5 px-5 text-sm font-medium hover:bg-teal-900 disabled:opacity-50">
        {submitting ? "Saving..." : method === "INSURANCE" ? "Submit claim & discharge patient" : "Confirm payment & discharge"}
      </button>
    </form>
  );
}

export default function Cashier() {
  return (
    <QueueBoard
      department="CASHIER"
      title="Cashier"
      subtitle="Generate invoice and capture payment"
      renderAction={(entry, onDone, refresh) => <CashierForm entry={entry} onDone={onDone} refresh={refresh} />}
    />
  );
}
