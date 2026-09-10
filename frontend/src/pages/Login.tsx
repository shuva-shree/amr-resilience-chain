import React, { useState } from "react";
import { Building2, LogIn, AlertCircle } from "lucide-react";
import { AuthApi } from "../api/endpoints";
import { ApiError } from "../api/client";
import { setSession } from "../api/auth";

const DEMO_ACCOUNTS = [
  { u: "e.vance", p: "pharm2026", label: "Chief Pharmacist" },
  { u: "s.rao", p: "icu2026", label: "Attending Physician (ICU)" },
  { u: "j.mehta", p: "ward2026", label: "Department Staff (OPD)" },
];

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const { token, user } = await AuthApi.login(username.trim(), password);
      setSession(token, user);
      window.location.assign("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to sign in. Please try again.");
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-sky-600 text-white rounded-md">
            <Building2 className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900 leading-tight">Apollo Health</h1>
            <p className="text-xs text-slate-500 font-medium">AMR Resilience Engine</p>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <h2 className="text-base font-semibold text-slate-900">Staff sign in</h2>
          <p className="text-xs text-slate-500 mt-0.5 mb-4">Use your hospital pharmacy credentials.</p>

          {error && (
            <div className="mb-4 p-3 bg-rose-50 border border-rose-200 rounded-md flex items-start gap-2 text-xs text-rose-800">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={submit} className="space-y-3">
            <div>
              <label className="text-xs font-medium text-slate-600">Username</label>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                required
                className="mt-1 w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                className="mt-1 w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-sky-700 hover:bg-sky-800 text-white text-sm font-semibold rounded-md disabled:opacity-60"
            >
              <LogIn className="w-4 h-4" />
              {submitting ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>

        <div className="mt-4 bg-white/60 border border-slate-200 rounded-lg p-3 text-[11px] text-slate-500">
          <p className="font-semibold text-slate-600 mb-1">Demo accounts</p>
          {DEMO_ACCOUNTS.map((a) => (
            <button
              key={a.u}
              onClick={() => {
                setUsername(a.u);
                setPassword(a.p);
              }}
              className="block w-full text-left hover:text-slate-800"
            >
              <span className="font-mono">{a.u}</span> / <span className="font-mono">{a.p}</span> — {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
