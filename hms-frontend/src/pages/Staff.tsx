import { useState, useEffect, FormEvent } from "react";
import { UserPlus, KeyRound, ShieldCheck } from "lucide-react";
import { api, ApiError } from "../api/client";
import { Card, SectionHeader, Badge, ErrorBanner } from "../components/ui";
import { Role } from "../types";

interface StaffUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  createdAt: string;
}

// ADMIN is intentionally left out of this list. Staff accounts created or
// edited from this page can never be given admin rights — admin access is
// only ever granted by running the seed/restore script directly against
// the database, so it's always a deliberate action, not a click here.
const ROLES: Role[] = ["RECEPTIONIST", "NURSE", "DOCTOR", "LAB_TECH", "PHARMACIST", "CASHIER", "WARD_NURSE", "THEATRE_NURSE"];

export default function Staff() {
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "RECEPTIONIST" as Role });
  const [submitting, setSubmitting] = useState(false);

  const [resetTarget, setResetTarget] = useState<StaffUser | null>(null);
  const [resetPassword, setResetPassword] = useState("");

  const load = async () => {
    try {
      setUsers(await api.get("/auth/users"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load staff list");
    }
  };
  useEffect(() => { load(); }, []);

  const submitAdd = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      await api.post("/auth/users", form);
      setForm({ name: "", email: "", password: "", role: "RECEPTIONIST" });
      setShowAdd(false);
      setSuccess(`${form.name} added as ${form.role}.`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create user");
    } finally {
      setSubmitting(false);
    }
  };

  const changeRole = async (id: string, role: Role, name: string) => {
    if (!window.confirm(`Change ${name}'s role to ${role}?`)) return;
    setError(null);
    try {
      await api.patch(`/auth/users/${id}`, { role });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update role");
    }
  };

  const toggleActive = async (u: StaffUser) => {
    setError(null);
    try {
      await api.patch(`/auth/users/${u.id}`, { active: !u.active });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update status");
    }
  };

  const submitReset = async (e: FormEvent) => {
    e.preventDefault();
    if (!resetTarget || resetPassword.length < 8) return;
    setError(null);
    try {
      await api.post(`/auth/users/${resetTarget.id}/reset-password`, { newPassword: resetPassword });
      setSuccess(`Password reset for ${resetTarget.name}.`);
      setResetTarget(null);
      setResetPassword("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reset password");
    }
  };

  return (
    <div>
      <SectionHeader
        title="Staff"
        subtitle="Manage staff accounts, roles, and passwords"
        action={<button onClick={() => setShowAdd((s) => !s)} className="bg-teal-800 text-white rounded-lg py-2 px-4 text-sm font-medium hover:bg-teal-900 inline-flex items-center gap-1.5"><UserPlus size={15} /> Add staff</button>}
      />
      <ErrorBanner message={error} />
      {success && <div className="mb-4 px-4 py-2.5 rounded-lg bg-emerald-50 text-emerald-700 text-sm border border-emerald-200">{success}</div>}

      {showAdd && (
        <Card className="mb-4">
          <form onSubmit={submitAdd} className="grid grid-cols-4 gap-2.5 items-end">
            <label className="text-sm">Name<input required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" /></label>
            <label className="text-sm">Email<input required type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" /></label>
            <label className="text-sm">Temporary password<input required minLength={8} value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" placeholder="min. 8 characters" /></label>
            <label className="text-sm">Role
              <select value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as Role }))} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            <button disabled={submitting} className="col-span-4 mt-1 bg-teal-800 text-white rounded-lg py-2 text-sm font-medium hover:bg-teal-900 disabled:opacity-50">
              {submitting ? "Creating..." : "Create account"}
            </button>
          </form>
          <p className="text-xs text-slate-500 mt-2">Share this temporary password with the staff member directly — they should change it via "Change password" after logging in.</p>
        </Card>
      )}

      {resetTarget && (
        <Card className="mb-4">
          <p className="text-sm font-medium mb-2 flex items-center gap-1.5"><KeyRound size={15} /> Reset password for {resetTarget.name}</p>
          <form onSubmit={submitReset} className="flex gap-2 items-end">
            <label className="text-sm flex-1">New password
              <input required minLength={8} value={resetPassword} onChange={(e) => setResetPassword(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" placeholder="min. 8 characters" />
            </label>
            <button className="bg-teal-800 text-white rounded-lg py-2 px-4 text-sm font-medium hover:bg-teal-900">Set password</button>
            <button type="button" onClick={() => { setResetTarget(null); setResetPassword(""); }} className="text-sm text-slate-400 hover:text-slate-700 px-2">Cancel</button>
          </form>
        </Card>
      )}

      <Card>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500 border-b border-slate-200">
              <th className="py-1.5 font-normal">Name</th><th className="font-normal">Email</th><th className="font-normal">Role</th><th className="font-normal">Status</th><th className="font-normal">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-slate-100 last:border-0">
                <td className="py-2 flex items-center gap-1.5">{u.name} {u.role === "ADMIN" && <ShieldCheck size={13} className="text-teal-700" />}</td>
                <td className="text-slate-500">{u.email}</td>
                <td>
                  {u.role === "ADMIN" ? (
                    <Badge className="bg-teal-100 text-teal-800 border-teal-300">Admin</Badge>
                  ) : (
                    <select value={u.role} onChange={(e) => changeRole(u.id, e.target.value as Role, u.name)} className="text-xs border border-slate-300 rounded px-2 py-1">
                      {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  )}
                </td>
                <td>
                  <Badge className={u.active ? "bg-emerald-100 text-emerald-800 border-emerald-300" : "bg-slate-100 text-slate-500 border-slate-300"}>
                    {u.active ? "Active" : "Deactivated"}
                  </Badge>
                </td>
                <td className="space-x-3">
                  <button onClick={() => setResetTarget(u)} className="text-xs text-teal-700 hover:underline">Reset password</button>
                  <button onClick={() => toggleActive(u)} className="text-xs text-slate-500 hover:underline">{u.active ? "Deactivate" : "Reactivate"}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
