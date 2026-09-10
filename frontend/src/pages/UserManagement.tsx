import React, { useMemo, useState } from "react";
import { Users, UserPlus, RefreshCw, KeyRound, X, Check, Ban } from "lucide-react";
import { useAuthRoles, useStaffUsers } from "../hooks/data";
import { AuthApi } from "../api/endpoints";
import type { StaffUser } from "../api/endpoints";
import { ApiError } from "../api/client";
import { getUser } from "../api/auth";
import { ErrorState, LoadingRows, EmptyState } from "../components/States";

const DEPARTMENTS = ["PHARM", "ICU", "ED", "OPD", "SURG", "INFX"];

export default function UserManagement() {
  const [nonce, setNonce] = useState(0);
  const users = useStaffUsers(nonce);
  const roles = useAuthRoles();
  const refresh = () => setNonce((n) => n + 1);
  const me = getUser();

  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<StaffUser | null>(null);

  const roleOptions = roles.data ?? [];
  const active = useMemo(() => (users.data ?? []).filter((u) => u.isActive), [users.data]);
  const inactive = useMemo(() => (users.data ?? []).filter((u) => !u.isActive), [users.data]);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="border-b border-slate-200 pb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Users className="w-7 h-7 text-sky-700" /> Staff Accounts
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Create logins for hospital staff and set their role. Roles determine what each person can see and do —
            authorization is enforced on the server for every request.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button onClick={refresh} aria-label="Refresh"
            className="p-2 rounded-md border border-slate-300 text-slate-500 hover:bg-slate-50">
            <RefreshCw className={`w-4 h-4 ${users.loading ? "animate-spin" : ""}`} />
          </button>
          <button onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 bg-sky-700 hover:bg-sky-800 text-white text-sm font-semibold rounded-md">
            <UserPlus className="w-4 h-4" /> Add user
          </button>
        </div>
      </div>

      {!users.loaded && users.loading && <LoadingRows rows={6} label="Loading accounts…" />}
      {users.error && <ErrorState error={users.error} onRetry={refresh} title="Unable to load accounts." />}

      {users.loaded && !users.error && (
        <>
          <UserTable title="Active" rows={active} meId={me?.userId} onEdit={setEditing} />
          {inactive.length > 0 && (
            <UserTable title="Deactivated" rows={inactive} meId={me?.userId} onEdit={setEditing} muted />
          )}
          {active.length === 0 && inactive.length === 0 && <EmptyState title="No staff accounts yet." />}
        </>
      )}

      {showCreate && (
        <UserDialog
          title="Add staff user"
          roleOptions={roleOptions}
          onClose={() => setShowCreate(false)}
          onSaved={() => { setShowCreate(false); refresh(); }}
          mode="create"
        />
      )}
      {editing && (
        <UserDialog
          title={`Edit ${editing.username}`}
          roleOptions={roleOptions}
          existing={editing}
          isSelf={editing.userId === me?.userId}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh(); }}
          mode="edit"
        />
      )}
    </div>
  );
}

function UserTable({
  title, rows, meId, onEdit, muted,
}: { title: string; rows: StaffUser[]; meId?: string; onEdit: (u: StaffUser) => void; muted?: boolean }) {
  if (rows.length === 0) return null;
  return (
    <div className={`bg-white border border-slate-200 rounded-xl overflow-x-auto ${muted ? "opacity-70" : ""}`}>
      <div className="px-4 py-2 border-b border-slate-200 text-sm font-semibold text-slate-800">{title}</div>
      <table className="w-full text-xs">
        <thead className="bg-slate-50 text-slate-600 font-semibold">
          <tr>
            <th className="p-3 text-left">Name</th><th className="p-3 text-left">Username</th>
            <th className="p-3 text-left">Role</th><th className="p-3 text-left">Department</th>
            <th className="p-3 text-left">Status</th><th className="p-3"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {rows.map((u) => (
            <tr key={u.userId} className="hover:bg-slate-50/60">
              <td className="p-3 font-medium text-slate-800">
                {u.fullName}{u.userId === meId && <span className="ml-1 text-[10px] text-sky-700">(you)</span>}
              </td>
              <td className="p-3 font-mono text-slate-500">{u.username}</td>
              <td className="p-3">{u.roleLabel}</td>
              <td className="p-3">{u.departmentCode || "—"}</td>
              <td className="p-3">
                <span className={`px-2 py-0.5 rounded ${u.isActive ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-600"}`}>
                  {u.isActive ? "active" : "deactivated"}
                </span>
              </td>
              <td className="p-3 text-right">
                <button onClick={() => onEdit(u)} className="text-sky-700 font-medium hover:underline">Edit</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UserDialog({
  title, roleOptions, existing, isSelf, mode, onClose, onSaved,
}: {
  title: string;
  roleOptions: { value: string; label: string }[];
  existing?: StaffUser;
  isSelf?: boolean;
  mode: "create" | "edit";
  onClose: () => void;
  onSaved: () => void;
}) {
  const [fullName, setFullName] = useState(existing?.fullName ?? "");
  const [username, setUsername] = useState(existing?.username ?? "");
  const [role, setRole] = useState(existing?.role ?? "department_staff");
  const [dept, setDept] = useState(existing?.departmentCode ?? "PHARM");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const roleList = roleOptions.length ? roleOptions : [{ value: role, label: role }];

  const save = async () => {
    setBusy(true); setErr(null);
    try {
      if (mode === "create") {
        await AuthApi.createUser({
          username: username.trim(), full_name: fullName.trim(), role,
          password, department_code: dept || null,
        });
      } else if (existing) {
        await AuthApi.updateUser(existing.userId, {
          full_name: fullName.trim(),
          role,
          department_code: dept || null,
          ...(password ? { new_password: password } : {}),
        });
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Save failed.");
    } finally { setBusy(false); }
  };

  const toggleActive = async () => {
    if (!existing) return;
    setBusy(true); setErr(null);
    try {
      await AuthApi.updateUser(existing.userId, { is_active: !existing.isActive });
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Failed.");
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md bg-white rounded-xl shadow-xl p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-start">
          <h2 className="text-lg font-bold text-slate-900">{title}</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-slate-400" /></button>
        </div>

        <Labeled label="Full name">
          <input value={fullName} onChange={(e) => setFullName(e.target.value)}
            className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md" />
        </Labeled>

        <Labeled label="Username">
          <input value={username} disabled={mode === "edit"}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="e.g. j.smith"
            className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md disabled:bg-slate-100 disabled:text-slate-500" />
        </Labeled>

        <div className="grid grid-cols-2 gap-3">
          <Labeled label="Role">
            <select value={role} onChange={(e) => setRole(e.target.value)} disabled={isSelf}
              className="w-full px-2 py-1.5 text-sm border border-slate-300 rounded-md disabled:bg-slate-100">
              {roleList.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
            {isSelf && <p className="text-[10px] text-slate-400 mt-0.5">You can't change your own role.</p>}
          </Labeled>
          <Labeled label="Department">
            <select value={dept ?? ""} onChange={(e) => setDept(e.target.value)}
              className="w-full px-2 py-1.5 text-sm border border-slate-300 rounded-md">
              {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </Labeled>
        </div>

        <Labeled label={mode === "create" ? "Temporary password" : "Reset password (optional)"}>
          <div className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-slate-400 shrink-0" />
            <input value={password} onChange={(e) => setPassword(e.target.value)} type="text"
              placeholder={mode === "create" ? "min 8 characters" : "leave blank to keep current"}
              className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md font-mono" />
          </div>
          {mode === "create" && (
            <p className="text-[10px] text-slate-400 mt-0.5">Share this with the user; they can change it under “My account”.</p>
          )}
        </Labeled>

        {err && <p className="text-xs text-rose-700">{err}</p>}

        <div className="flex items-center justify-between pt-1">
          {mode === "edit" && existing && !isSelf ? (
            <button onClick={toggleActive} disabled={busy}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border disabled:opacity-60 ${
                existing.isActive ? "border-rose-300 text-rose-700 hover:bg-rose-50" : "border-emerald-300 text-emerald-700 hover:bg-emerald-50"
              }`}>
              {existing.isActive ? <><Ban className="w-3.5 h-3.5" /> Deactivate</> : <><Check className="w-3.5 h-3.5" /> Reactivate</>}
            </button>
          ) : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-xs font-medium text-slate-600 rounded-md hover:bg-slate-100">Cancel</button>
            <button onClick={save} disabled={busy}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-sky-700 hover:bg-sky-800 text-white text-xs font-semibold rounded-md disabled:opacity-60">
              {busy ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs font-medium text-slate-600">
      {label}
      <div className="mt-1">{children}</div>
    </label>
  );
}
