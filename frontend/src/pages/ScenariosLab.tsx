import React, { useState } from "react";
import { FlaskConical, Play, RefreshCw } from "lucide-react";
import { useAntibiotics, useScenarioPresets } from "../hooks/data";
import { ScenarioApi } from "../api/endpoints";
import type { ScenarioResult } from "../api/endpoints";
import { ApiError } from "../api/client";
import { ErrorState } from "../components/States";

const RISK_CLS: Record<string, string> = {
  CRITICAL: "bg-rose-100 text-rose-800 border-rose-300",
  HIGH: "bg-amber-100 text-amber-800 border-amber-300",
  MODERATE: "bg-sky-100 text-sky-800 border-sky-300",
  LOW: "bg-emerald-100 text-emerald-800 border-emerald-300",
};

export default function ScenariosLab() {
  const { data: antibiotics } = useAntibiotics();
  const { data: presets } = useScenarioPresets();

  const [antibioticId, setAntibioticId] = useState("ANT-MERO");
  const [surge, setSurge] = useState(30); // percent
  const [leadDelay, setLeadDelay] = useState(14);
  const [disabledSupplier, setDisabledSupplier] = useState<string>("");

  const [result, setResult] = useState<ScenarioResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      const r = await ScenarioApi.simulate({
        hospital_id: "H001",
        antibiotic_id: antibioticId,
        demand_surge_pct: surge / 100,
        lead_time_delay_days: leadDelay,
        disabled_supplier_id: disabledSupplier || null,
      });
      setResult(r);
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError("UNKNOWN", "Simulation failed.", 0));
      setResult(null);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="border-b border-slate-200 pb-4">
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <FlaskConical className="w-7 h-7 text-sky-700" />
          Scenarios Lab — Supply Disruption What-If
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Project days-to-depletion and coverage gap against the latest BigQuery inventory snapshot and supplier lead times.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Controls */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
          <h2 className="text-sm font-semibold text-slate-800">Parameters</h2>

          {presets && presets.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {presets.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    setSurge(Math.round(p.demand_surge_pct * 100));
                    setLeadDelay(p.lead_time_delay_days);
                  }}
                  className="px-2.5 py-1 text-xs font-medium rounded-md bg-slate-100 text-slate-700 hover:bg-slate-200"
                >
                  {p.name}
                </button>
              ))}
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-slate-600">Antibiotic</label>
            <select
              value={antibioticId}
              onChange={(e) => setAntibioticId(e.target.value)}
              className="mt-1 w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
            >
              {(antibiotics ?? [{ antibiotic_id: "ANT-MERO", antibiotic_name: "Meropenem" }]).map((a) => (
                <option key={a.antibiotic_id} value={a.antibiotic_id}>
                  {a.antibiotic_name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-600">Demand surge: +{surge}%</label>
            <input
              type="range"
              min={0}
              max={200}
              step={5}
              value={surge}
              onChange={(e) => setSurge(Number(e.target.value))}
              className="w-full mt-1"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-slate-600">Supplier lead-time delay: +{leadDelay} days</label>
            <input
              type="range"
              min={0}
              max={60}
              step={1}
              value={leadDelay}
              onChange={(e) => setLeadDelay(Number(e.target.value))}
              className="w-full mt-1"
            />
          </div>

          {result && result.suppliers.length > 1 && (
            <div>
              <label className="text-xs font-medium text-slate-600">Disable a supplier</label>
              <select
                value={disabledSupplier}
                onChange={(e) => setDisabledSupplier(e.target.value)}
                className="mt-1 w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
              >
                <option value="">None</option>
                {result.suppliers.map((s) => (
                  <option key={s.supplier_id} value={s.supplier_id}>
                    {s.supplier_name} ({s.lead_time_days}d)
                  </option>
                ))}
              </select>
            </div>
          )}

          <button
            onClick={run}
            disabled={running}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-sky-700 hover:bg-sky-800 text-white text-sm font-semibold rounded-md disabled:opacity-60"
          >
            {running ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            Run simulation
          </button>
        </div>

        {/* Result */}
        <div className="space-y-4">
          {error && <ErrorState error={error} title="Simulation could not run." />}
          {!result && !error && (
            <div className="h-full flex items-center justify-center text-sm text-slate-400 border-2 border-dashed border-slate-200 rounded-xl p-10 text-center">
              Set parameters and run a simulation to see the projected impact.
            </div>
          )}
          {result && (
            <>
              <div className={`rounded-xl border p-4 ${RISK_CLS[result.scenario.risk_level] ?? RISK_CLS.LOW}`}>
                <p className="text-xs font-semibold uppercase tracking-wider">Projected risk</p>
                <p className="text-2xl font-bold mt-0.5">{result.scenario.risk_level}</p>
                <p className="text-xs mt-1">
                  Coverage gap {result.scenario.coverage_gap_days} days
                  {result.scenario.coverage_gap_days < 0 ? " — stock depletes before resupply arrives." : "."}
                </p>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-600 text-xs font-semibold">
                    <tr>
                      <th className="text-left p-3">Metric</th>
                      <th className="text-right p-3">Baseline</th>
                      <th className="text-right p-3">Scenario</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    <Row label="Daily consumption" a={`${result.baseline.daily_consumption}`} b={`${result.scenario.daily_consumption}`} />
                    <Row label="Days to depletion" a={`${result.baseline.days_to_depletion}`} b={`${result.scenario.days_to_depletion}`} highlight />
                    <Row label="Replenishment lead time (d)" a={`${result.baseline.replenishment_lead_time_days}`} b={`${result.scenario.replenishment_lead_time_days}`} />
                  </tbody>
                </table>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-4 text-sm">
                <p className="text-xs text-slate-500">
                  Current stock: <strong className="text-slate-800">{result.current_stock} {result.unit?.toLowerCase()}</strong>{" "}
                  (as of {new Date(result.as_of).toLocaleDateString()})
                </p>
                {result.scenario.recommended_buffer_order > 0 && (
                  <p className="mt-2 text-sm font-semibold text-slate-900">
                    Recommended buffer order: {result.scenario.recommended_buffer_order} {result.unit?.toLowerCase()}
                  </p>
                )}
                <p className="mt-2 text-[11px] text-slate-400">{result.note}</p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, a, b, highlight }: { label: string; a: string; b: string; highlight?: boolean }) {
  return (
    <tr className={highlight ? "bg-slate-50/60" : ""}>
      <td className="p-3 text-slate-700">{label}</td>
      <td className="p-3 text-right font-mono text-slate-500">{a}</td>
      <td className="p-3 text-right font-mono font-semibold text-slate-900">{b}</td>
    </tr>
  );
}
