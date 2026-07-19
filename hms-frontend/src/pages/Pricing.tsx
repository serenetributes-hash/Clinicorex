import { useState, useEffect, FormEvent } from "react";
import { Plus, Pencil, Boxes } from "lucide-react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../api/client";
import { Card, SectionHeader, ErrorBanner } from "../components/ui";

// ---------------- Flat fees ----------------

function FeesCard() {
  const [fees, setFees] = useState<Record<string, number> | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const load = async () => {
    try {
      const data = await api.get("/settings");
      setFees(data);
      setDrafts(Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load fees");
    }
  };
  useEffect(() => { load(); }, []);

  const save = async (key: string) => {
    const value = Number(drafts[key]);
    if (!Number.isFinite(value) || value < 0) return;
    setSavingKey(key);
    setError(null);
    try {
      await api.put(`/settings/${key}`, { value });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save this fee");
    } finally {
      setSavingKey(null);
    }
  };

  const LABELS: Record<string, string> = {
    consultationFee: "Outpatient consultation fee",
    emergencyWardVisitFee: "Emergency ward visit fee (after-hours call-out)",
  };

  return (
    <Card>
      <p className="font-medium text-sm mb-1">Flat fees</p>
      <p className="text-xs text-slate-500 mb-3">Charged as a fixed amount regardless of what's ordered.</p>
      <ErrorBanner message={error} />
      {!fees ? (
        <p className="text-sm text-slate-400">Loading...</p>
      ) : (
        <ul className="space-y-2">
          {Object.keys(fees).map((key) => (
            <li key={key} className="flex items-center gap-2">
              <span className="flex-1 text-sm">{LABELS[key] || key}</span>
              <span className="text-xs text-slate-400">KSh</span>
              <input
                type="number"
                min={0}
                value={drafts[key] ?? ""}
                onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
                className="w-24 border border-slate-300 rounded px-2 py-1 text-sm"
              />
              <button
                onClick={() => save(key)}
                disabled={savingKey === key || Number(drafts[key]) === fees[key]}
                className="text-xs bg-teal-800 text-white rounded px-2.5 py-1 hover:bg-teal-900 disabled:opacity-40"
              >
                {savingKey === key ? "Saving..." : "Save"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ---------------- Lab tests ----------------

function LabTestsCard() {
  const [tests, setTests] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [editing, setEditing] = useState<Record<string, string>>({});

  const load = async () => {
    try {
      setTests(await api.get("/catalog/lab-tests"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load lab tests");
    }
  };
  useEffect(() => { load(); }, []);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!name || !price) return;
    setError(null);
    try {
      await api.post("/catalog/lab-tests", { name, price: Number(price) });
      setName("");
      setPrice("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add this lab test");
    }
  };

  const savePrice = async (id: string) => {
    const value = Number(editing[id]);
    if (!Number.isFinite(value) || value < 0) return;
    setError(null);
    try {
      await api.patch(`/catalog/lab-tests/${id}`, { price: value });
      setEditing((d) => { const n = { ...d }; delete n[id]; return n; });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update this test's price");
    }
  };

  const toggleActive = async (id: string, active: boolean) => {
    setError(null);
    try {
      await api.patch(`/catalog/lab-tests/${id}`, { active });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update this test");
    }
  };

  return (
    <Card>
      <p className="font-medium text-sm mb-1">Lab tests</p>
      <p className="text-xs text-slate-500 mb-3">What doctors can order at consultation. Retiring a test hides it going forward without touching past bills.</p>
      <ErrorBanner message={error} />
      <ul className="space-y-1.5 mb-3 max-h-64 overflow-auto">
        {tests.map((t) => (
          <li key={t.id} className={`flex items-center gap-2 border rounded-lg px-2.5 py-1.5 text-sm ${t.active ? "border-slate-200" : "border-slate-100 opacity-50"}`}>
            <span className="flex-1">{t.name}</span>
            <input
              type="number"
              min={0}
              value={editing[t.id] ?? Number(t.price)}
              onChange={(e) => setEditing((d) => ({ ...d, [t.id]: e.target.value }))}
              className="w-20 border border-slate-300 rounded px-1.5 py-0.5 text-xs"
            />
            {editing[t.id] !== undefined && Number(editing[t.id]) !== Number(t.price) && (
              <button onClick={() => savePrice(t.id)} className="text-xs text-teal-700 hover:underline">Save</button>
            )}
            <button onClick={() => toggleActive(t.id, !t.active)} className="text-xs text-slate-400 hover:text-slate-700">
              {t.active ? "Retire" : "Restore"}
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="flex gap-1.5">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New test name" className="flex-1 border border-slate-300 rounded px-2 py-1.5 text-sm" />
        <input type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} placeholder="KSh" className="w-20 border border-slate-300 rounded px-2 py-1.5 text-sm" />
        <button className="text-xs bg-teal-800 text-white rounded px-3 py-1.5 hover:bg-teal-900 inline-flex items-center gap-1"><Plus size={12} /> Add</button>
      </form>
    </Card>
  );
}

// ---------------- Wards ----------------

function WardsCard() {
  const [wards, setWards] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Record<string, { dailyRate: string; doctorRoundFee: string }>>({});
  const [name, setName] = useState("");
  const [type, setType] = useState("");
  const [dailyRate, setDailyRate] = useState("");
  const [doctorRoundFee, setDoctorRoundFee] = useState("");
  const [bedCount, setBedCount] = useState("6");
  const [showAdd, setShowAdd] = useState(false);

  const load = async () => {
    try {
      setWards(await api.get("/wards"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load wards");
    }
  };
  useEffect(() => { load(); }, []);

  const startEdit = (w: any) => setEditing((d) => ({ ...d, [w.id]: { dailyRate: String(Number(w.dailyRate)), doctorRoundFee: String(Number(w.doctorRoundFee)) } }));

  const saveWard = async (id: string) => {
    const draft = editing[id];
    if (!draft) return;
    setError(null);
    try {
      await api.patch(`/wards/${id}`, { dailyRate: Number(draft.dailyRate), doctorRoundFee: Number(draft.doctorRoundFee) });
      setEditing((d) => { const n = { ...d }; delete n[id]; return n; });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update this ward");
    }
  };

  const addWard = async (e: FormEvent) => {
    e.preventDefault();
    if (!name || !dailyRate || !doctorRoundFee || !bedCount) return;
    setError(null);
    try {
      await api.post("/wards", {
        name, type: type || undefined,
        dailyRate: Number(dailyRate), doctorRoundFee: Number(doctorRoundFee), bedCount: Number(bedCount),
      });
      setName(""); setType(""); setDailyRate(""); setDoctorRoundFee(""); setBedCount("6"); setShowAdd(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create this ward");
    }
  };

  return (
    <Card>
      <p className="font-medium text-sm mb-1">Wards</p>
      <p className="text-xs text-slate-500 mb-3">Nightly bed rate and the standard daily doctor-round rate, both billed automatically at discharge based on nights stayed.</p>
      <ErrorBanner message={error} />
      <ul className="space-y-1.5 mb-3">
        {wards.map((w) => (
          <li key={w.id} className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm">
            <div className="flex items-center gap-2">
              <span className="flex-1">{w.name} <span className="text-slate-400 text-xs">({w.beds?.length ?? 0} beds)</span></span>
              {editing[w.id] === undefined ? (
                <button onClick={() => startEdit(w)} className="text-xs text-slate-400 hover:text-teal-700 inline-flex items-center gap-1"><Pencil size={11} /> Edit</button>
              ) : (
                <button onClick={() => saveWard(w.id)} className="text-xs text-teal-700 hover:underline">Save</button>
              )}
            </div>
            {editing[w.id] !== undefined ? (
              <div className="flex gap-3 mt-1.5">
                <label className="text-xs text-slate-500">Nightly rate
                  <input type="number" min={0} value={editing[w.id].dailyRate} onChange={(e) => setEditing((d) => ({ ...d, [w.id]: { ...d[w.id], dailyRate: e.target.value } }))} className="block w-24 border border-slate-300 rounded px-1.5 py-0.5 text-xs mt-0.5" />
                </label>
                <label className="text-xs text-slate-500">Doctor round/day
                  <input type="number" min={0} value={editing[w.id].doctorRoundFee} onChange={(e) => setEditing((d) => ({ ...d, [w.id]: { ...d[w.id], doctorRoundFee: e.target.value } }))} className="block w-24 border border-slate-300 rounded px-1.5 py-0.5 text-xs mt-0.5" />
                </label>
              </div>
            ) : (
              <p className="text-xs text-slate-400 mt-0.5">KSh {Number(w.dailyRate).toLocaleString()}/night · KSh {Number(w.doctorRoundFee).toLocaleString()}/day doctor round</p>
            )}
          </li>
        ))}
      </ul>
      {showAdd ? (
        <form onSubmit={addWard} className="space-y-1.5 border-t border-slate-100 pt-3">
          <div className="flex gap-1.5">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ward name" className="flex-1 border border-slate-300 rounded px-2 py-1.5 text-sm" />
            <input value={type} onChange={(e) => setType(e.target.value)} placeholder="Type (optional)" className="w-28 border border-slate-300 rounded px-2 py-1.5 text-sm" />
          </div>
          <div className="flex gap-1.5">
            <input type="number" min={0} value={dailyRate} onChange={(e) => setDailyRate(e.target.value)} placeholder="Nightly rate" className="flex-1 border border-slate-300 rounded px-2 py-1.5 text-sm" />
            <input type="number" min={0} value={doctorRoundFee} onChange={(e) => setDoctorRoundFee(e.target.value)} placeholder="Doctor round/day" className="flex-1 border border-slate-300 rounded px-2 py-1.5 text-sm" />
            <input type="number" min={1} max={200} value={bedCount} onChange={(e) => setBedCount(e.target.value)} placeholder="Beds" className="w-20 border border-slate-300 rounded px-2 py-1.5 text-sm" />
          </div>
          <div className="flex gap-2">
            <button className="text-xs bg-teal-800 text-white rounded px-3 py-1.5 hover:bg-teal-900">Create ward</button>
            <button type="button" onClick={() => setShowAdd(false)} className="text-xs text-slate-400 hover:text-rose-600">Cancel</button>
          </div>
        </form>
      ) : (
        <button onClick={() => setShowAdd(true)} className="text-xs bg-teal-800 text-white rounded px-3 py-1.5 hover:bg-teal-900 inline-flex items-center gap-1"><Plus size={12} /> Add ward</button>
      )}
    </Card>
  );
}

// ---------------- Theatre / equipment ----------------

function EquipmentCard() {
  const [equipment, setEquipment] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [newFeeLabel, setNewFeeLabel] = useState<Record<string, string>>({});
  const [newFeeAmount, setNewFeeAmount] = useState<Record<string, string>>({});
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState("Theatre");

  const load = async () => {
    try {
      setEquipment(await api.get("/theatre/equipment"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load theatre/equipment");
    }
  };
  useEffect(() => { load(); }, []);

  const saveFee = async (feeItemId: string) => {
    const value = Number(editing[feeItemId]);
    if (!Number.isFinite(value) || value < 0) return;
    setError(null);
    try {
      await api.patch(`/theatre/fee-items/${feeItemId}`, { defaultAmount: value });
      setEditing((d) => { const n = { ...d }; delete n[feeItemId]; return n; });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update this fee");
    }
  };

  const addFeeItem = async (equipmentId: string) => {
    const label = newFeeLabel[equipmentId];
    const amount = Number(newFeeAmount[equipmentId]);
    if (!label || !Number.isFinite(amount)) return;
    setError(null);
    try {
      await api.post(`/theatre/equipment/${equipmentId}/fee-items`, { label, defaultAmount: amount });
      setNewFeeLabel((d) => ({ ...d, [equipmentId]: "" }));
      setNewFeeAmount((d) => ({ ...d, [equipmentId]: "" }));
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add this fee line");
    }
  };

  const addEquipment = async (e: FormEvent) => {
    e.preventDefault();
    if (!name || !type) return;
    setError(null);
    try {
      await api.post("/theatre/equipment", { name, type, feeItems: [] });
      setName(""); setType("Theatre"); setShowAdd(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add this equipment/theatre");
    }
  };

  return (
    <Card>
      <p className="font-medium text-sm mb-1">Theatre & equipment fees</p>
      <p className="text-xs text-slate-500 mb-3">Default line items copied onto a booking's bill — editable per booking too, this just sets the starting amounts.</p>
      <ErrorBanner message={error} />
      <div className="space-y-3 mb-3">
        {equipment.map((eq) => (
          <div key={eq.id} className="border border-slate-200 rounded-lg px-2.5 py-2">
            <p className="text-sm font-medium mb-1.5">{eq.name} <span className="text-slate-400 text-xs font-normal">({eq.type})</span></p>
            <ul className="space-y-1 mb-1.5">
              {eq.feeItems.map((fi: any) => (
                <li key={fi.id} className="flex items-center gap-2 text-xs">
                  <span className="flex-1 text-slate-600">{fi.label}</span>
                  <input
                    type="number"
                    min={0}
                    value={editing[fi.id] ?? Number(fi.defaultAmount)}
                    onChange={(e) => setEditing((d) => ({ ...d, [fi.id]: e.target.value }))}
                    className="w-20 border border-slate-300 rounded px-1.5 py-0.5 text-xs"
                  />
                  {editing[fi.id] !== undefined && Number(editing[fi.id]) !== Number(fi.defaultAmount) && (
                    <button onClick={() => saveFee(fi.id)} className="text-teal-700 hover:underline">Save</button>
                  )}
                </li>
              ))}
            </ul>
            <div className="flex gap-1.5">
              <input value={newFeeLabel[eq.id] || ""} onChange={(e) => setNewFeeLabel((d) => ({ ...d, [eq.id]: e.target.value }))} placeholder="New fee line label" className="flex-1 border border-slate-300 rounded px-2 py-1 text-xs" />
              <input type="number" min={0} value={newFeeAmount[eq.id] || ""} onChange={(e) => setNewFeeAmount((d) => ({ ...d, [eq.id]: e.target.value }))} placeholder="KSh" className="w-16 border border-slate-300 rounded px-2 py-1 text-xs" />
              <button onClick={() => addFeeItem(eq.id)} className="text-xs bg-slate-100 text-slate-700 rounded px-2 py-1 hover:bg-slate-200">Add</button>
            </div>
          </div>
        ))}
      </div>
      {showAdd ? (
        <form onSubmit={addEquipment} className="flex gap-1.5">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (e.g. Theatre 3)" className="flex-1 border border-slate-300 rounded px-2 py-1.5 text-sm" />
          <select value={type} onChange={(e) => setType(e.target.value)} className="border border-slate-300 rounded px-2 py-1.5 text-sm">
            <option>Theatre</option>
            <option>Radiology</option>
            <option>Diagnostic</option>
          </select>
          <button className="text-xs bg-teal-800 text-white rounded px-3 py-1.5 hover:bg-teal-900">Create</button>
          <button type="button" onClick={() => setShowAdd(false)} className="text-xs text-slate-400 hover:text-rose-600">Cancel</button>
        </form>
      ) : (
        <button onClick={() => setShowAdd(true)} className="text-xs bg-teal-800 text-white rounded px-3 py-1.5 hover:bg-teal-900 inline-flex items-center gap-1"><Plus size={12} /> Add theatre/equipment</button>
      )}
    </Card>
  );
}

// ---------------- Other fees (catch-all catalog) ----------------

function OtherFeesCard() {
  const [fees, setFees] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [editing, setEditing] = useState<Record<string, string>>({});

  const load = async () => {
    try {
      setFees(await api.get("/catalog/other-fees"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load other fees");
    }
  };
  useEffect(() => { load(); }, []);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!name || !price) return;
    setError(null);
    try {
      await api.post("/catalog/other-fees", { name, price: Number(price) });
      setName("");
      setPrice("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add this fee");
    }
  };

  const savePrice = async (id: string) => {
    const value = Number(editing[id]);
    if (!Number.isFinite(value) || value < 0) return;
    setError(null);
    try {
      await api.patch(`/catalog/other-fees/${id}`, { price: value });
      setEditing((d) => { const n = { ...d }; delete n[id]; return n; });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update this fee's price");
    }
  };

  const toggleActive = async (id: string, active: boolean) => {
    setError(null);
    try {
      await api.patch(`/catalog/other-fees/${id}`, { active });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update this fee");
    }
  };

  return (
    <Card>
      <p className="font-medium text-sm mb-1">Other fees</p>
      <p className="text-xs text-slate-500 mb-3">A catch-all catalog for anything that doesn't fit consultation, lab, pharmacy, theatre, or ward billing — e.g. medical report fee, ambulance fee, dressing fee. Cashier picks from this list (or types a one-off custom charge) when checking a patient out.</p>
      <ErrorBanner message={error} />
      <ul className="space-y-1.5 mb-3 max-h-64 overflow-auto">
        {fees.map((f) => (
          <li key={f.id} className={`flex items-center gap-2 border rounded-lg px-2.5 py-1.5 text-sm ${f.active ? "border-slate-200" : "border-slate-100 opacity-50"}`}>
            <span className="flex-1">{f.name}</span>
            <input
              type="number"
              min={0}
              value={editing[f.id] ?? Number(f.price)}
              onChange={(e) => setEditing((d) => ({ ...d, [f.id]: e.target.value }))}
              className="w-20 border border-slate-300 rounded px-1.5 py-0.5 text-xs"
            />
            {editing[f.id] !== undefined && Number(editing[f.id]) !== Number(f.price) && (
              <button onClick={() => savePrice(f.id)} className="text-xs text-teal-700 hover:underline">Save</button>
            )}
            <button onClick={() => toggleActive(f.id, !f.active)} className="text-xs text-slate-400 hover:text-slate-700">
              {f.active ? "Retire" : "Restore"}
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="flex gap-1.5">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New fee name" className="flex-1 border border-slate-300 rounded px-2 py-1.5 text-sm" />
        <input type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} placeholder="KSh" className="w-20 border border-slate-300 rounded px-2 py-1.5 text-sm" />
        <button className="text-xs bg-teal-800 text-white rounded px-3 py-1.5 hover:bg-teal-900 inline-flex items-center gap-1"><Plus size={12} /> Add</button>
      </form>
    </Card>
  );
}

export default function Pricing() {
  return (
    <div>
      <SectionHeader title="Pricing" subtitle="Every editable charge in the system, in one place" />
      <div className="mb-5 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 text-sm text-slate-600 flex items-start gap-2">
        <Boxes size={16} className="mt-0.5 shrink-0" />
        <span>
          Pharmacy drug pricing (unit cost per item) is set on the <Link to="/inventory" className="text-teal-700 hover:underline font-medium">Inventory</Link> page when adding or restocking an item — not here.
        </span>
      </div>
      <div className="grid grid-cols-2 gap-5">
        <FeesCard />
        <LabTestsCard />
        <OtherFeesCard />
        <WardsCard />
        <EquipmentCard />
      </div>
    </div>
  );
}
