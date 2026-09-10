import React, { useMemo, useState } from "react";
import { FileCheck, RefreshCw } from "lucide-react";
import { useAuditEvents } from "../hooks/data";
import { ErrorState, LoadingRows, EmptyState } from "../components/States";
import type { AuditEvent } from "../api/types";

const RESULT_CLS: Record<string, string> = {
  success: "bg-emerald-100 text-emerald-800",
  blocked: "bg-rose-100 text-rose-800",
  pending_approval: "bg-amber-100 text-amber-800",
  failed: "bg-rose-100 text-rose-800",
  automated: "bg-slate-100 text-slate-700",
};

export default function AuditHistory() {
  const { data, loading, loaded, error, refetch } = useAuditEvents(200);
  const [typeFilter, setTypeFilter] = useState("ALL");
  const events: AuditEvent[] = data ?? [];

  const types = useMemo(
    () => ["ALL", ...Array.from(new Set(events.map((e) => e.event_type)))],
    [events],
  );
  const filtered = typeFilter === "ALL" ? events : events.filter((e) => e.event_type === typeFilter);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex justify-between items-start border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <FileCheck className="w-7 h-7 text-sky-700" />
            Operational History & Audit Trail
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Immutable record of medicine issues, allocation changes and policy decisions (BigQuery <code>audit_events</code>).
          </p>
        </div>
        <button onClick={refetch} className="p-2 border border-slate-300 rounded-lg hover:bg-slate-100" aria-label="Refresh">
          <RefreshCw className={`w-4 h-4 text-slate-600 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {loaded && !error && events.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap text-xs">
          {types.map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`px-3 py-1 rounded-md font-medium transition-colors ${
                typeFilter === t ? "bg-sky-700 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      )}

      {!loaded && loading && <LoadingRows rows={8} label="Loading history…" />}
      {error && <ErrorState error={error} onRetry={refetch} title="Unable to load history." />}
      {loaded && !error && filtered.length === 0 && (
        <EmptyState title="No events recorded yet." hint="Actions such as issuing a medicine will appear here." />
      )}

      {loaded && !error && filtered.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600 font-semibold">
              <tr>
                <th className="p-3">Timestamp</th>
                <th className="p-3">Event</th>
                <th className="p-3">Entity</th>
                <th className="p-3">Actor</th>
                <th className="p-3">Result</th>
                <th className="p-3">Reason / Link</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filtered.map((e) => (
                <tr key={e.event_id} className="hover:bg-slate-50/60">
                  <td className="p-3 text-slate-500 whitespace-nowrap font-mono">
                    {new Date(e.event_timestamp).toLocaleString()}
                  </td>
                  <td className="p-3 font-semibold text-slate-900">{e.event_type}</td>
                  <td className="p-3 text-slate-600">
                    {e.entity_type}
                    {e.entity_id ? `: ${e.entity_id}` : ""}
                  </td>
                  <td className="p-3">
                    {e.actor_id}
                    {e.actor_role && <span className="text-slate-400"> ({e.actor_role})</span>}
                  </td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded ${RESULT_CLS[e.result ?? ""] ?? "bg-slate-100 text-slate-700"}`}>
                      {e.result ?? "—"}
                    </span>
                  </td>
                  <td className="p-3 text-slate-500">
                    {e.reason || (e.transaction_id ? <span className="font-mono">{e.transaction_id}</span> : "—")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
