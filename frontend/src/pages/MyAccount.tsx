import React, { useState } from "react";
import { UserCircle, KeyRound, Check, RefreshCw } from "lucide-react";
import { AuthApi } from "../api/endpoints";
import { ApiError } from "../api/client";
import { getUser } from "../api/auth";

export default function MyAccount() {
  const user = getUser();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null); setMsg(null);
    if (next.length < 8) { setErr("New password must be at least 8 characters."); return; }
    if (next !== confirm) { setErr("New password and confirmation do not match."); return; }
    setBusy(true);
    try {
      await AuthApi.changePassword(current, next);
      setMsg("Password changed. Use it next time you sign in.");
      setCurrent(""); setNext(""); setConfirm("");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not change your password.");
    } finally { setBusy(false); }
  };

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <div className="border-b border-slate-200 pb-4">
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <UserCircle className="w-7 h-7 text-sky-700" /> My Account
        </h1>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-5 grid grid-cols-2 gap-3 text-sm">
        <Field label="Name" value={user?.name} />
        <Field label="Username" value={user?.username} />
        <Field label="Role" value={user?.roleLabel || user?.role} />
        <Field label="Department" value={user?.departmentCode} />
      </div>

      <form onSubmit={submit} className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-slate-500" /> Change password
        </h2>
        <Input label="Current password" value={current} onChange={setCurrent} />
        <Input label="New password (min 8 characters)" value={next} onChange={setNext} />
        <Input label="Confirm new password" value={confirm} onChange={setConfirm} />

        {err && <p className="text-xs text-rose-700">{err}</p>}
        {msg && <p className="text-xs text-emerald-700">{msg}</p>}

        <button type="submit" disabled={busy}
          className="flex items-center gap-2 px-4 py-2 bg-sky-700 hover:bg-sky-800 text-white text-sm font-semibold rounded-md disabled:opacity-60">
          {busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Update password
        </button>
      </form>
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="bg-slate-50 rounded border border-slate-200 p-2">
      <p className="text-[10px] uppercase tracking-wider text-slate-400">{label}</p>
      <p className="font-medium text-slate-800">{value || "—"}</p>
    </div>
  );
}

function Input({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block text-xs font-medium text-slate-600">
      {label}
      <input type="password" value={value} onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md" />
    </label>
  );
}
