import { useState, useEffect, FormEvent, useCallback } from "react";
import { Plus, Receipt, TrendingDown, TrendingUp, Trash2 } from "lucide-react";
import { api, ApiError } from "../api/client";
import { Card, SectionHeader, ErrorBanner, money } from "../components/ui";

const EXPENSE_CATEGORIES = ["Drug & supply procurement", "Salaries & wages", "Utilities", "Equipment maintenance", "Transport", "Other"];

export default function Reports() {
  const [period, setPeriod] = useState<"today" | "month" | "all">("today");
  const [summary, setSummary] = useState<any>(null);
  const [collections, setCollections] = useState<any>(null);
  const [claims, setClaims] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [form, setForm] = useState({ date: new Date().toISOString().slice(0, 10), category: EXPENSE_CATEGORIES[0], amount: "", vendor: "" });

  const load = useCallback(async () => {
    try {
      const [s, c, cl, e] = await Promise.all([
        api.get(`/reports/summary?period=${period}`),
        api.get(`/reports/collections?period=${period}`),
        api.get(`/reports/claims`),
        api.get(`/reports/expenses?period=${period}`),
      ]);
      setSummary(s);
      setCollections(c);
      setClaims(cl.claims);
      setExpenses(e.expenses);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load reports");
    }
  }, [period]);

  useEffect(() => { load(); }, [load]);

  const updateClaim = async (encounterId: string, status: string) => {
    try {
      await api.patch(`/encounters/${encounterId}/claim-status`, { status });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update claim");
    }
  };

  const submitExpense = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.amount) return;
    try {
      await api.post("/reports/expenses", {
        date: new Date(form.date).toISOString(),
        category: form.category,
        amount: Number(form.amount),
        vendor: form.vendor || undefined,
      });
      setForm({ date: new Date().toISOString().slice(0, 10), category: EXPENSE_CATEGORIES[0], amount: "", vendor: "" });
      setShowExpenseForm(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save expense");
    }
  };

  const deleteExpense = async (id: string) => {
    await api.delete(`/reports/expenses/${id}`);
    await load();
  };

  const statusColor: Record<string, string> = {
    SUBMITTED: "bg-amber-100 text-amber-800 border-amber-300",
    APPROVED: "bg-sky-100 text-sky-800 border-sky-300",
    PAID: "bg-emerald-100 text-emerald-800 border-emerald-300",
    REJECTED: "bg-rose-100 text-rose-800 border-rose-300",
  };

  return (
    <div>
      <SectionHeader
        title="Reports"
        subtitle="Collections, revenue breakdown, insurance claims and expenses"
        action={
          <div className="flex gap-1.5">
            {(["today", "month", "all"] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`text-xs px-3 py-1.5 rounded-full border ${period === p ? "bg-teal-800 text-white border-teal-800" : "border-slate-300 text-slate-600 hover:bg-slate-100"}`}
              >
                {p === "today" ? "Today" : p === "month" ? "This month" : "All time"}
              </button>
            ))}
          </div>
        }
      />
      <ErrorBanner message={error} />

      {summary && (
        <div className="grid grid-cols-6 gap-3 mb-6">
          <Card className="!p-4"><p className="text-xs text-slate-500">Total collected</p><p className="text-xl font-semibold mt-1">{money(summary.totalCollected)}</p></Card>
          <Card className="!p-4"><p className="text-xs text-slate-500">Cash</p><p className="text-xl font-semibold mt-1">{money(summary.cash)}</p></Card>
          <Card className="!p-4"><p className="text-xs text-slate-500">Insurance paid</p><p className="text-xl font-semibold mt-1">{money(summary.insurancePaid)}</p></Card>
          <Card className="!p-4"><p className="text-xs text-slate-500">Pending claims</p><p className="text-xl font-semibold mt-1 text-amber-700">{money(summary.pendingClaims)}</p></Card>
          <Card className="!p-4"><p className="text-xs text-slate-500 flex items-center gap-1"><TrendingDown size={12} /> Expenses</p><p className="text-xl font-semibold mt-1">{money(summary.totalExpenses)}</p></Card>
          <Card className="!p-4"><p className="text-xs text-slate-500 flex items-center gap-1"><TrendingUp size={12} /> Net</p><p className={`text-xl font-semibold mt-1 ${summary.net < 0 ? "text-rose-600" : "text-emerald-700"}`}>{money(summary.net)}</p></Card>
        </div>
      )}

      {collections && (
        <Card className="mb-4">
          <p className="font-medium text-sm mb-3">Revenue by department</p>
          {Object.keys(collections.byCategory).length === 0 ? (
            <p className="text-sm text-slate-400">No collections in this period.</p>
          ) : (
            <ul className="space-y-2">
              {Object.entries(collections.byCategory as Record<string, number>).map(([cat, amt]) => (
                <li key={cat} className="flex items-center gap-3 text-sm">
                  <span className="w-40 shrink-0">{cat}</span>
                  <div className="flex-1 bg-slate-100 rounded-full h-2">
                    <div className="bg-teal-700 h-2 rounded-full" style={{ width: `${collections.totalCollected ? (amt / collections.totalCollected) * 100 : 0}%` }} />
                  </div>
                  <span className="w-20 text-right text-slate-600">{money(amt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <Card className="mb-4">
        <p className="font-medium text-sm mb-3 flex items-center gap-1.5"><Receipt size={15} /> Insurance claims <span className="text-slate-400 font-normal">(all claims, not limited to selected period)</span></p>
        {claims.length === 0 ? (
          <p className="text-sm text-slate-400">No insurance claims submitted yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-200">
                <th className="py-1.5 font-normal">Patient</th><th className="font-normal">Provider</th><th className="font-normal">Claim #</th><th className="font-normal">Amount</th><th className="font-normal">Status</th>
              </tr>
            </thead>
            <tbody>
              {claims.map((c) => (
                <tr key={c.id} className="border-b border-slate-100 last:border-0">
                  <td className="py-2">{c.patientName} <span className="text-slate-400 text-xs">({c.mrn})</span></td>
                  <td className="text-slate-500">{c.insuranceProvider || "—"}</td>
                  <td className="text-slate-500">{c.claimNo || "—"}</td>
                  <td className="font-medium">{money(c.amount)}</td>
                  <td>
                    <select value={c.claimStatus} onChange={(e) => updateClaim(c.encounterId, e.target.value)} className={`text-xs border rounded-full px-2 py-1 ${statusColor[c.claimStatus] || ""}`}>
                      <option value="SUBMITTED">Submitted</option>
                      <option value="APPROVED">Approved</option>
                      <option value="PAID">Paid</option>
                      <option value="REJECTED">Rejected</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card>
        <div className="flex items-center justify-between mb-3">
          <p className="font-medium text-sm flex items-center gap-1.5"><Receipt size={15} /> Expenses</p>
          <button onClick={() => setShowExpenseForm((s) => !s)} className="text-xs bg-teal-800 text-white rounded-lg py-1.5 px-3 font-medium hover:bg-teal-900 inline-flex items-center gap-1"><Plus size={13} /> Add expense</button>
        </div>
        {showExpenseForm && (
          <form onSubmit={submitExpense} className="grid grid-cols-5 gap-2.5 items-end mb-4 bg-slate-50 p-3 rounded-lg">
            <label className="text-xs">Date<input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} className="mt-1 w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm" /></label>
            <label className="text-xs">Category
              <select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} className="mt-1 w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm">
                {EXPENSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
            <label className="text-xs">Amount<input required type="number" step="0.01" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} className="mt-1 w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm" /></label>
            <label className="text-xs">Vendor<input value={form.vendor} onChange={(e) => setForm((f) => ({ ...f, vendor: e.target.value }))} className="mt-1 w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm" /></label>
            <button className="bg-teal-800 text-white rounded-lg py-1.5 text-sm font-medium hover:bg-teal-900">Save</button>
          </form>
        )}
        {expenses.length === 0 ? (
          <p className="text-sm text-slate-400">No expenses recorded in this period.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-200">
                <th className="py-1.5 font-normal">Date</th><th className="font-normal">Category</th><th className="font-normal">Vendor</th><th className="font-normal">Amount</th><th></th>
              </tr>
            </thead>
            <tbody>
              {expenses.map((e) => (
                <tr key={e.id} className="border-b border-slate-100 last:border-0">
                  <td className="py-1.5">{new Date(e.date).toLocaleDateString()}</td>
                  <td className="text-slate-500">{e.category}</td>
                  <td className="text-slate-500">{e.vendor || "—"}</td>
                  <td className="font-medium">{money(e.amount)}</td>
                  <td className="text-right"><button onClick={() => deleteExpense(e.id)}><Trash2 size={14} className="text-slate-400 hover:text-rose-600" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
