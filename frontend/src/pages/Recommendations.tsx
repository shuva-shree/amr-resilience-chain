import React, { useMemo, useState } from "react";
import { FileText, RefreshCw, AlertTriangle, ShoppingCart, Building2 } from "lucide-react";
import { useRecommendations } from "../hooks/data";
import { ErrorState, LoadingRows, EmptyState } from "../components/States";
import type { RecommendationItem } from "../api/endpoints";

const SEV: Record<string, { cls: string; dot: string }> = {
  CRITICAL: { cls: "bg-rose-50 border-rose-200", dot: "bg-rose-600" },
  HIGH: { cls: "bg-amber-50 border-amber-200", dot: "bg-amber-500" },
  MODERATE: { cls: "bg-sky-50 border-sky-200", dot: "bg-sky-500" },
  LOW: { cls: "bg-slate-50 border-slate-200", dot: "bg-slate-400" },
};

const CAT_ICON: Record<string, typeof FileText> = {
  "Stockout risk": AlertTriangle,
  Replenishment: ShoppingCart,
  "Department coverage": Building2,
};

export default function Recommendations() {
  const { data, loading, loaded, error, refetch } = useRecommendations("H001");
  const [catFilter, setCatFilter] = useState("ALL");
  const items: RecommendationItem[] = data ?? [];

  const categories = useMemo(
    () => ["ALL", ...Array.from(new Set(items.map((i) => i.category)))],
    [items],
  );
  const filtered = catFilter === "ALL" ? items : items.filter((i) => i.category === catFilter);
  const criticalCount = items.filter((i) => i.severity === "CRITICAL").length;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex justify-between items-start border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <FileText className="w-7 h-7 text-sky-700" />
            Risk & Recommendations
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Prioritised actions derived from live stockout risk, resilience alerts and department coverage.
          </p>
        </div>
        <button
          onClick={refetch}
          className="p-2 border border-slate-300 rounded-lg hover:bg-slate-100"
          aria-label="Refresh"
        >
          <RefreshCw className={`w-4 h-4 text-slate-600 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {loaded && !error && items.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap text-xs">
          {criticalCount > 0 && (
            <span className="px-2.5 py-1 rounded-full bg-rose-100 text-rose-800 font-semibold">
              {criticalCount} critical
            </span>
          )}
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setCatFilter(c)}
              className={`px-3 py-1 rounded-md font-medium transition-colors ${
                catFilter === c ? "bg-sky-700 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {!loaded && loading && <LoadingRows rows={5} label="Compiling recommendations…" />}
      {error && <ErrorState error={error} onRetry={refetch} title="Unable to load recommendations." />}
      {loaded && !error && filtered.length === 0 && (
        <EmptyState title="No open recommendations." hint="Stock coverage and resilience signals are within tolerance." />
      )}

      <div className="space-y-3">
        {filtered.map((item) => {
          const sev = SEV[item.severity] ?? SEV.LOW;
          const Icon = CAT_ICON[item.category] ?? FileText;
          return (
            <div key={item.id} className={`rounded-lg border p-4 ${sev.cls}`}>
              <div className="flex items-start gap-3">
                <span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${sev.dot}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Icon className="w-3.5 h-3.5 text-slate-500" />
                    <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                      {item.category} · {item.severity}
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-slate-900 mt-1">{item.title}</p>
                  <p className="text-xs text-slate-600 mt-0.5">{item.detail}</p>
                  <p className="text-xs text-slate-800 mt-2">
                    <span className="font-semibold">Recommended:</span> {item.recommended_action}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
