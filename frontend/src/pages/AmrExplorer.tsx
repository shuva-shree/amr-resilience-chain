import React, { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";
import { Microscope, RefreshCw } from "lucide-react";
import { useAmrFilters, useAmrMatrix, useAmrSummary, useAmrTrend } from "../hooks/data";
import { ErrorState, LoadingRows, EmptyState } from "../components/States";
import type { AmrMatrixCell } from "../api/endpoints";

function heatColor(pct: number | null): string {
  if (pct === null) return "bg-slate-100 text-slate-400";
  if (pct >= 60) return "bg-rose-600 text-white";
  if (pct >= 40) return "bg-rose-400 text-white";
  if (pct >= 25) return "bg-amber-400 text-amber-950";
  if (pct >= 10) return "bg-amber-200 text-amber-900";
  return "bg-emerald-200 text-emerald-900";
}

export default function AmrExplorer() {
  const filters = useAmrFilters();
  const [region, setRegion] = useState<string>("South-East Asia");
  const [specimen, setSpecimen] = useState<string>("ALL");
  const [pathogen, setPathogen] = useState<string>("Klebsiella pneumoniae");
  const [antibiotic, setAntibiotic] = useState<string>("Meropenem");

  const summary = useAmrSummary({
    region: region === "ALL" ? undefined : region,
    specimen: specimen === "ALL" ? undefined : specimen,
  });
  const matrix = useAmrMatrix(region === "ALL" ? undefined : region, specimen === "ALL" ? undefined : specimen);
  const trend = useAmrTrend(pathogen, antibiotic, region === "ALL" ? undefined : region);

  const cells: AmrMatrixCell[] = matrix.data ?? [];
  const pathogens = useMemo(() => Array.from(new Set(cells.map((c) => c.pathogen))), [cells]);
  const antibiotics = useMemo(() => Array.from(new Set(cells.map((c) => c.antibiotic))), [cells]);
  const cellFor = (p: string, a: string) => cells.find((c) => c.pathogen === p && c.antibiotic === a);

  const trendData = (trend.data ?? []).map((t) => ({
    month: new Date(t.month).toLocaleDateString(undefined, { month: "short", year: "2-digit" }),
    resistance: t.resistance_pct,
    mic90: t.mic90,
  }));

  useEffect(() => {
    if (!filters.data) return;
    if (!filters.data.regions.includes(region) && filters.data.regions[0]) setRegion(filters.data.regions[0]);
  }, [filters.data]); // eslint-disable-line

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex justify-between items-start border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Microscope className="w-7 h-7 text-sky-700" />
            AMR Surveillance Explorer
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Isolate-level resistance across the critical antibiotic panel and priority pathogens.
          </p>
        </div>
        <button onClick={() => { summary.refetch(); matrix.refetch(); trend.refetch(); }}
          className="p-2 border border-slate-300 rounded-lg hover:bg-slate-100" aria-label="Refresh">
          <RefreshCw className={`w-4 h-4 text-slate-600 ${matrix.loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="flex flex-wrap gap-3 items-end">
        <Select label="Region" value={region} onChange={setRegion} options={["ALL", ...(filters.data?.regions ?? [])]} />
        <Select label="Specimen" value={specimen} onChange={setSpecimen} options={["ALL", ...(filters.data?.specimens ?? [])]} />
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Tile label="Isolates" value={summary.data?.isolates?.toLocaleString() ?? "—"} />
        <Tile label="Resistant" value={summary.data ? `${summary.data.resistance_pct}%` : "—"} tone="rose" />
        <Tile label="Pathogens" value={summary.data?.pathogens ?? "—"} />
        <Tile label="Antibiotics" value={summary.data?.antibiotics ?? "—"} />
      </div>

      {/* Resistance matrix */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-800 mb-3">Resistance rate (%) — pathogen × antibiotic</h2>
        {!matrix.loaded && matrix.loading && <LoadingRows rows={4} label="Loading matrix…" />}
        {matrix.error && <ErrorState error={matrix.error} onRetry={matrix.refetch} title="Unable to load the matrix." />}
        {matrix.loaded && !matrix.error && cells.length === 0 && <EmptyState title="No isolates for this filter." />}
        {matrix.loaded && !matrix.error && cells.length > 0 && (
          <div className="overflow-x-auto">
            <table className="text-xs border-separate border-spacing-1">
              <thead>
                <tr>
                  <th className="text-left p-2 text-slate-500 font-semibold">Pathogen \ Antibiotic</th>
                  {antibiotics.map((a) => (
                    <th key={a} className="p-2 text-slate-600 font-semibold whitespace-nowrap">{a}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pathogens.map((p) => (
                  <tr key={p}>
                    <td className="p-2 font-medium text-slate-800 whitespace-nowrap italic">{p}</td>
                    {antibiotics.map((a) => {
                      const c = cellFor(p, a);
                      return (
                        <td key={a} className="p-0">
                          <button
                            onClick={() => { setPathogen(p); setAntibiotic(a); }}
                            title={c ? `${c.resistance_pct}% of ${c.n} isolates` : "no data"}
                            className={`w-full h-10 min-w-[64px] rounded font-bold ${heatColor(c?.resistance_pct ?? null)} ${
                              pathogen === p && antibiotic === a ? "ring-2 ring-sky-700" : ""
                            }`}
                          >
                            {c?.resistance_pct != null ? `${c.resistance_pct}` : "–"}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[11px] text-slate-400 mt-2">Click a cell to chart its trend below.</p>
          </div>
        )}
      </div>

      {/* Trend */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-800">
          {pathogen} vs {antibiotic} — monthly resistance & MIC₉₀ {region !== "ALL" ? `· ${region}` : ""}
        </h2>
        {!trend.loaded && trend.loading && <LoadingRows rows={3} label="Loading trend…" />}
        {trend.error && <ErrorState error={trend.error} onRetry={trend.refetch} title="Unable to load the trend." />}
        {trend.loaded && !trend.error && trendData.length === 0 && <EmptyState title="No trend data for this combination." />}
        {trend.loaded && !trend.error && trendData.length > 0 && (
          <div className="h-64 mt-3">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData} margin={{ top: 8, right: 16, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef2f6" />
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: "#64748b" }} />
                <YAxis yAxisId="l" tick={{ fontSize: 10, fill: "#64748b" }} domain={[0, 100]} unit="%" />
                <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 10, fill: "#64748b" }} />
                <Tooltip contentStyle={{ fontSize: 11, borderColor: "#cbd5e1" }} />
                <Line yAxisId="l" type="monotone" dataKey="resistance" name="Resistance %" stroke="#dc2626" strokeWidth={2} dot={false} connectNulls />
                <Line yAxisId="r" type="monotone" dataKey="mic90" name="MIC₉₀ (mg/L)" stroke="#0284c7" strokeWidth={2} dot={false} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <label className="text-xs font-medium text-slate-600">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="mt-1 block px-3 py-1.5 text-sm border border-slate-300 rounded-md bg-white">
        {options.map((o) => <option key={o} value={o}>{o === "ALL" ? "All" : o}</option>)}
      </select>
    </label>
  );
}

function Tile({ label, value, tone = "slate" }: { label: string; value: React.ReactNode; tone?: "slate" | "rose" }) {
  return (
    <div className={`p-4 bg-white rounded-lg border shadow-sm ${tone === "rose" ? "border-rose-200" : "border-slate-200"}`}>
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${tone === "rose" ? "text-rose-700" : "text-slate-900"}`}>{value}</p>
    </div>
  );
}
