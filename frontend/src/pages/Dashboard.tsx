
import React, { useEffect, useState, useMemo } from "react";
import {
  Building,
  Server,
  AlertCircle,
  X,
  Sliders,
  RefreshCw,
  Zap,
  ArrowUpRight,
  Activity,
  Pill,
  AlertTriangle,
  Network,
  Download,
  Search,
  CheckCircle2,
} from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  Line,
} from "recharts";
import {
  useDashboardSummary,
  useHospitals,
  usePredictions,
  useAntibiotics,
  useTrends,
} from "../hooks/data";

// ============================================================================
// 1. Data Models & API Interfaces
// ============================================================================
export interface DashboardSummary {
  total_hospitals: number;
  critical_risk_hospitals: number;
  moderate_risk_hospitals: number;
  avg_stockout_risk_pct: number;
  tracked_antibiotics: number;
}

export interface Prediction {
  hospital_id: string;
  hospital_name?: string;
  antibiotic_id: string;
  antibiotic_name?: string;
  stockout_probability_30d: number;
  predicted_days_remaining: number;
  risk_category?: string;
  last_updated?: string;
}

export interface Hospital {
  hospital_id: string;
  hospital_name: string;
  city: string;
  state?: string;
}

export interface Trend {
  snapshot_date: string;
  stockout_probability: number;
  inventory_units_on_hand: number;
  consumption_rate_daily: number;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  count?: number;
  error?: string;
}

export default function AMROperationalDashboard({
  initialTab = "overview",
}: {
  initialTab?: "overview" | "amr" | "inventory";
}) {
  // Navigation State
  const [activeTab, setActiveTab] = useState<"overview" | "amr" | "inventory">(initialTab);
  const [selectedHospital, setSelectedHospital] = useState<string>("H001");
  const [selectedAntibiotic, setSelectedAntibiotic] = useState<string>("ANT-MERO");

  // Controls & UX States
  const [inventorySearch, setInventorySearch] = useState<string>("");
  const [inventoryRiskFilter, setInventoryRiskFilter] = useState<string>("ALL");

  // ============================================================================
  // 2. Server data (BigQuery-backed, via the central API layer)
  // ============================================================================
  const summaryQ = useDashboardSummary();
  const hospitalsQ = useHospitals();
  const predictionsQ = usePredictions(0.0, selectedHospital || undefined);
  const antibioticsQ = useAntibiotics();
  const trendsQ = useTrends(selectedHospital, selectedAntibiotic, 12);

  const summary = summaryQ.data ?? null;
  const hospitals: Hospital[] = hospitalsQ.data ?? [];
  const antibiotics = antibioticsQ.data ?? [];
  const predictions: Prediction[] = predictionsQ.data ?? [];
  const trends: Trend[] = (trendsQ.data ?? []) as Trend[];

  const isLoading =
    summaryQ.loading || hospitalsQ.loading || predictionsQ.loading;
  const apiError =
    summaryQ.error?.message ||
    hospitalsQ.error?.message ||
    predictionsQ.error?.message ||
    null;
  const isExecuting = summaryQ.loading || predictionsQ.loading || trendsQ.loading;

  useEffect(() => {
    if (hospitals.length && !hospitals.some((h) => h.hospital_id === selectedHospital)) {
      setSelectedHospital(hospitals[0].hospital_id);
    }
  }, [hospitals, selectedHospital]);

  const handleRunInvestigation = () => {
    summaryQ.refetch();
    predictionsQ.refetch();
    trendsQ.refetch();
  };

  // Filtered Predictions for Inventory Table
  const filteredInventory = useMemo(() => {
    return predictions.filter((p) => {
      const name = p.antibiotic_name || p.antibiotic_id;
      const matchesSearch = name.toLowerCase().includes(inventorySearch.toLowerCase()) || p.hospital_id.toLowerCase().includes(inventorySearch.toLowerCase());

      if (inventoryRiskFilter === "CRITICAL") return matchesSearch && p.stockout_probability_30d >= 0.80;
      if (inventoryRiskFilter === "HIGH") return matchesSearch && p.stockout_probability_30d >= 0.50 && p.stockout_probability_30d < 0.80;
      if (inventoryRiskFilter === "NORMAL") return matchesSearch && p.stockout_probability_30d < 0.50;
      return matchesSearch;
    });
  }, [predictions, inventorySearch, inventoryRiskFilter]);

  // Map trend data for Recharts. Every series here is a real column from
  // BigQuery (v_amr_usage_trends + v_live_agent_predictions), not a derived
  // decomposition.
  const trendChartData = useMemo(() => {
    if (trends.length === 0) return [];
    return trends.map((t: any) => ({
      period: new Date(t.snapshot_date).toLocaleDateString(undefined, { month: "short", year: "2-digit" }),
      resistancePct: t.resistance_pct != null ? Number(t.resistance_pct.toFixed(1)) : null,
      stockoutRiskPct: Number((t.stockout_probability * 100).toFixed(1)),
      daysOfSupply:
        t.consumption_rate_daily > 0
          ? Number((t.inventory_units_on_hand / t.consumption_rate_daily).toFixed(0))
          : null,
    }));
  }, [trends]);

  const latestTrend: any = trends.length ? trends[trends.length - 1] : null;
  const firstTrend: any = trends.length ? trends[0] : null;

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800 font-sans selection:bg-sky-100 selection:text-sky-900 flex flex-col">
      {/* =========================================================================
          HEADER & TOOLBAR
         ========================================================================= */}
      <header className="bg-slate-900 text-white border-b border-slate-800 px-4 lg:px-6 py-2.5 flex flex-wrap items-center justify-between gap-4 sticky top-0 z-40 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-sky-600 flex items-center justify-center text-white font-bold shrink-0">
            <Building className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-semibold tracking-tight text-white">Apollo Health Institute</h1>
              <span className="text-[11px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded border border-slate-700">
                Pharmacy & Infection Control
              </span>
            </div>
            <p className="text-xs text-slate-400">Patchamomma 2026 • AMR Resilience Operations</p>
          </div>
        </div>

        {/* Center / Right controls */}
        <div className="flex items-center gap-4 text-xs">
          {/* Hospital / Unit Selector */}
          <div className="flex items-center gap-2 bg-slate-800 border border-slate-700 px-2.5 py-1.5 rounded">
            <span className="text-slate-400 font-medium">Facility Unit:</span>
            <select
              value={selectedHospital}
              onChange={(e) => setSelectedHospital(e.target.value)}
              className="bg-transparent text-white font-medium focus:outline-none cursor-pointer"
            >
              {hospitals.map((h) => (
                <option key={h.hospital_id} value={h.hospital_id} className="bg-slate-900 text-white">
                  {h.hospital_name || h.hospital_id}
                </option>
              ))}
            </select>
          </div>

          {/* System Sync Feed Badge */}
          <div className="hidden sm:flex items-center gap-2 bg-slate-800/80 border border-slate-700 px-2.5 py-1.5 rounded text-slate-300">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span>Live Feed • Synced {isLoading ? "now..." : "2m ago"}</span>
          </div>

          {/* Data source badge */}
          <button
            onClick={handleRunInvestigation}
            className="px-2.5 py-1.5 rounded font-mono text-[11px] border transition-colors flex items-center gap-1.5 bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700"
            title="Refresh from BigQuery"
          >
            <Server className="w-3.5 h-3.5" />
            <span>Live BigQuery{isExecuting ? " • syncing…" : ""}</span>
          </button>
        </div>
      </header>

      {/* Navigation Tabs Bar */}
      <div className="bg-white border-b border-slate-200 px-4 lg:px-6 py-2 flex items-center gap-6 text-xs font-medium">
        <button
          onClick={() => setActiveTab("overview")}
          className={`pb-1 border-b-2 transition-colors ${activeTab === "overview" ? "border-sky-600 text-sky-700 font-semibold" : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
        >
          Overview Dashboard
        </button>
        <button
          onClick={() => setActiveTab("amr")}
          className={`pb-1 border-b-2 transition-colors ${activeTab === "amr" ? "border-sky-600 text-sky-700 font-semibold" : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
        >
          AMR Surveillance & MIC
        </button>
        <button
          onClick={() => setActiveTab("inventory")}
          className={`pb-1 border-b-2 transition-colors ${activeTab === "inventory" ? "border-sky-600 text-sky-700 font-semibold" : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
        >
          Pharmacy Inventory ({predictions.length})
        </button>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 bg-slate-100 overflow-y-auto p-4 md:p-6 text-slate-800">
          {/* Live API Error Alert Banner */}
          {apiError && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-xs text-red-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                <span>
                  <strong>Unable to load dashboard data.</strong> {apiError}
                </span>
              </div>
              <button onClick={handleRunInvestigation} className="text-red-700 hover:text-red-900 font-semibold">
                Retry
              </button>
            </div>
          )}

          {/* =========================================================================
              TAB 1: OVERVIEW DASHBOARD
             ========================================================================= */}
          {activeTab === "overview" && (
            <div className="space-y-5">
              {/* Section Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-200">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Hospital Operations & AMR Resilience Summary</h2>
                  <p className="text-xs text-slate-500">
                    Real-time surveillance of antimicrobial resistance strain trends and hospital supply chain coverage.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setActiveTab("amr")}
                    className="px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-medium rounded shadow-sm flex items-center gap-1.5"
                  >
                    <Sliders className="w-3.5 h-3.5 text-slate-500" />
                    Simulate Disruption
                  </button>
                  <button
                    onClick={handleRunInvestigation}
                    disabled={isExecuting}
                    className="px-3 py-1.5 bg-sky-700 hover:bg-sky-800 text-white text-xs font-medium rounded shadow-sm flex items-center gap-1.5 transition-colors disabled:opacity-50"
                  >
                    {isExecuting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                    Run AI Investigation
                  </button>
                </div>
              </div>

              {/* 4 Compact Operational Metric Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Metric 1 */}
                <div className="bg-white p-4 rounded border border-slate-200 shadow-sm flex flex-col justify-between">
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="text-xs font-medium text-slate-500">Avg. 30-Day Stockout Risk</span>
                      <div className="mt-1 flex items-baseline gap-2">
                        <span className="text-xl font-bold text-slate-900">
                          {summary ? `${summary.avg_stockout_risk_pct}%` : isLoading ? "…" : "—"}
                        </span>
                      </div>
                    </div>
                    <div className="p-2 bg-red-50 text-red-600 rounded">
                      <Activity className="w-4 h-4" />
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-2">
                    Across {summary?.tracked_antibiotics ?? "—"} tracked antibiotics, {summary?.total_hospitals ?? "—"} hospital(s)
                  </p>
                </div>

                {/* Metric 2 */}
                <div className="bg-white p-4 rounded border border-slate-200 shadow-sm flex flex-col justify-between">
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="text-xs font-medium text-slate-500">Lowest Stock Coverage</span>
                      <div className="mt-1 flex items-baseline gap-2">
                        <span className="text-xl font-bold text-slate-900">
                          {predictions.length
                            ? `${Math.min(...predictions.map((p) => p.predicted_days_remaining ?? Infinity))} Days`
                            : isLoading ? "…" : "—"}
                        </span>
                        <span className="text-xs font-medium text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">Target: 30d</span>
                      </div>
                    </div>
                    <div className="p-2 bg-amber-50 text-amber-600 rounded">
                      <Pill className="w-4 h-4" />
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-2">
                    {predictions.length
                      ? `${[...predictions].sort((a, b) => (a.predicted_days_remaining ?? 0) - (b.predicted_days_remaining ?? 0))[0]?.antibiotic_name ?? ""} is closest to reorder`
                      : "No prediction data"}
                  </p>
                </div>

                {/* Metric 3 */}
                <div className="bg-white p-4 rounded border border-slate-200 shadow-sm flex flex-col justify-between">
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="text-xs font-medium text-slate-500">Critical-Risk Items</span>
                      <div className="mt-1 flex items-baseline gap-2">
                        <span className="text-xl font-bold text-slate-900">
                          {summary ? summary.critical_risk_hospitals : isLoading ? "…" : "—"}
                        </span>
                        <span className="text-xs font-semibold text-amber-600">
                          + {summary?.moderate_risk_hospitals ?? "—"} moderate
                        </span>
                      </div>
                    </div>
                    <div className="p-2 bg-amber-50 text-amber-600 rounded">
                      <AlertTriangle className="w-4 h-4" />
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-2">Stockout probability ≥ 70% within 30 days</p>
                </div>

                {/* Metric 4 */}
                <div className="bg-white p-4 rounded border border-slate-200 shadow-sm flex flex-col justify-between">
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="text-xs font-medium text-slate-500">Latest Resistance Rate</span>
                      <div className="mt-1 flex items-baseline gap-2">
                        <span className="text-xl font-bold text-slate-900">
                          {latestTrend?.resistance_pct != null ? `${latestTrend.resistance_pct.toFixed(1)}%` : "—"}
                        </span>
                        {latestTrend && firstTrend && latestTrend.resistance_pct != null && firstTrend.resistance_pct != null && (
                          <span className="text-xs font-semibold text-red-600 flex items-center">
                            <ArrowUpRight className="w-3.5 h-3.5" />
                            {(latestTrend.resistance_pct - firstTrend.resistance_pct >= 0 ? "+" : "")}
                            {(latestTrend.resistance_pct - firstTrend.resistance_pct).toFixed(1)} pts
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="p-2 bg-red-50 text-red-600 rounded">
                      <Network className="w-4 h-4" />
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-2">
                    {selectedAntibiotic} · {trendChartData.length} months of surveillance
                  </p>
                </div>
              </div>

              {/* Actionable "Attention Required" Operational Panel */}
              <div className="bg-white border border-slate-200 rounded shadow-sm">
                <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-600" />
                    <h3 className="text-xs font-semibold text-slate-800 uppercase tracking-wider">
                      Attention Required • Action Items
                    </h3>
                  </div>
                  <span className="text-xs text-slate-500 font-medium">
                    {predictions.length > 0 ? `${predictions.length} Pending Alerts` : "0 Pending Alerts"}
                  </span>
                </div>

                <div className="divide-y divide-slate-200">
                  {predictions.length > 0 ? (
                    predictions.slice(0, 3).map((item, idx) => {
                      const isCritical = item.stockout_probability_30d >= 0.70;
                      return (
                        <div
                          key={`${item.hospital_id}-${idx}`}
                          className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/50"
                        >
                          <div className="flex items-start gap-3">
                            <span
                              className={`mt-0.5 px-2 py-0.5 text-[10px] font-bold rounded uppercase shrink-0 ${isCritical ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"
                                }`}
                            >
                              {isCritical ? "Critical Risk" : "AMR Warning"}
                            </span>
                            <div>
                              <p className="text-xs font-semibold text-slate-900">
                                {item.antibiotic_name || item.antibiotic_id} below minimum safe operating margin (
                                {item.predicted_days_remaining} days remaining)
                              </p>
                              <p className="text-xs text-slate-500 mt-0.5">
                                Facility ID: {item.hospital_name || item.hospital_id} • Probability:{" "}
                                {(item.stockout_probability_30d * 100).toFixed(1)}%
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              onClick={() => setActiveTab("inventory")}
                              className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded"
                            >
                              Review Inventory
                            </button>
                            <button
                              onClick={() => setActiveTab("inventory")}
                              className="px-2.5 py-1 text-xs font-medium text-white bg-sky-700 hover:bg-sky-800 rounded"
                            >
                              Execute Protocol
                            </button>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="p-8 text-center text-xs text-slate-500 flex flex-col items-center justify-center">
                      <CheckCircle2 className="w-8 h-8 text-emerald-500 mb-2" />
                      <p className="font-semibold text-slate-700">All Systems Operational</p>
                      <p>No critical stockout vulnerabilities detected for the active threshold.</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Grid: AMR Surveillance Mini Chart & Stock Distribution */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                {/* Mini AMR Chart */}
                <div className="lg:col-span-7 bg-white p-4 rounded border border-slate-200 shadow-sm flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                        AMR Resistance Pressure Trend (2021–2026)
                      </h3>
                      <button onClick={() => setActiveTab("amr")} className="text-xs font-medium text-sky-700 hover:underline">
                        Detailed Chart →
                      </button>
                    </div>
                    <p className="text-xs text-slate-500 mb-4">
                      Non-susceptibility percentage (% resistant isolates) for primary gram-negative pathogens.
                    </p>
                  </div>

                  <div className="h-48 w-full">
                    {trendChartData.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={trendChartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                          <XAxis dataKey="period" tick={{ fontSize: 10, fill: "#64748b" }} />
                          <YAxis tick={{ fontSize: 10, fill: "#64748b" }} domain={[0, 100]} />
                          <Tooltip contentStyle={{ backgroundColor: "#ffffff", borderColor: "#cbd5e1", fontSize: "11px" }} />
                          <Line type="monotone" dataKey="resistancePct" stroke="#dc2626" strokeWidth={2} dot={false} name="Resistance %" connectNulls />
                          <Line type="monotone" dataKey="stockoutRiskPct" stroke="#0284c7" strokeWidth={2} dot={false} name="30-day stockout risk %" />
                        </LineChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="h-full flex items-center justify-center text-xs text-slate-400 bg-slate-50 rounded border border-dashed border-slate-200">
                        No trend records fetched for {selectedHospital}
                      </div>
                    )}
                  </div>
                </div>

                {/* Quick Replenishment & Stock Overview */}
                <div className="lg:col-span-5 bg-white p-4 rounded border border-slate-200 shadow-sm flex flex-col justify-between">
                  <div>
                    <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2">
                      Critical Antibiotic Stock Coverage
                    </h3>
                    <p className="text-xs text-slate-500 mb-4">Current days-of-supply vs hospital 30-day baseline buffer target.</p>
                  </div>

                  <div className="space-y-3">
                    {predictions.slice(0, 4).map((item, idx) => {
                      const days = item.predicted_days_remaining;
                      const pct = Math.min(100, Math.round((days / 30) * 100));
                      const isLow = days < 15;
                      return (
                        <div key={idx} className="text-xs">
                          <div className="flex justify-between font-medium mb-1">
                            <span className="text-slate-800">{item.antibiotic_name || item.antibiotic_id}</span>
                            <span className={isLow ? "text-red-700 font-bold" : "text-slate-600"}>
                              {days} days
                            </span>
                          </div>
                          <div className="w-full bg-slate-100 h-2 rounded overflow-hidden">
                            <div
                              className={`h-full ${isLow ? "bg-red-600" : pct < 80 ? "bg-amber-500" : "bg-emerald-600"}`}
                              style={{ width: `${pct}%` }}
                            ></div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="pt-3 border-t border-slate-100 mt-3 text-right">
                    <button onClick={() => setActiveTab("inventory")} className="text-xs font-medium text-sky-700 hover:underline">
                      View All Pharmacy Inventory →
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* =========================================================================
              TAB 2: AMR TRENDS & SURVEILLANCE
             ========================================================================= */}
          {activeTab === "amr" && (
            <div className="space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-200">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">AMR Resistance Surveillance & MIC Trajectories</h2>
                  <p className="text-xs text-slate-500">
                    Longitudinal non-susceptibility rate monitoring and therapeutic strain resistance forecasting.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">Antibiotic:</span>
                  <select
                    value={selectedAntibiotic}
                    onChange={(e) => setSelectedAntibiotic(e.target.value)}
                    className="bg-white border border-slate-300 text-xs text-slate-800 rounded px-2.5 py-1 font-medium"
                  >
                    {(antibiotics.length ? antibiotics : [{ antibiotic_id: "ANT-MERO", antibiotic_name: "Meropenem" }]).map((a) => (
                      <option key={a.antibiotic_id} value={a.antibiotic_id}>
                        {a.antibiotic_name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Main Clinical Recharts Line Chart */}
              <div className="bg-white p-5 rounded border border-slate-200 shadow-sm">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4 pb-3 border-b border-slate-100">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      Resistance & Stockout Risk — {selectedAntibiotic}
                    </h3>
                    <p className="text-xs text-slate-500">
                      Monthly resistance rate and modelled 30-day stockout probability for {selectedHospital}
                    </p>
                  </div>
                  <div className="flex items-center gap-4 text-xs font-medium">
                    <span className="flex items-center gap-1.5">
                      <span className="w-3 h-3 bg-red-600 rounded-sm"></span> Resistance %
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-3 h-3 bg-sky-600 rounded-sm"></span> Stockout risk %
                    </span>
                  </div>
                </div>

                <div className="h-72 w-full">
                  {trendChartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={trendChartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="period" tick={{ fontSize: 11, fill: "#475569" }} />
                        <YAxis tick={{ fontSize: 11, fill: "#475569" }} domain={[0, 100]} unit="%" />
                        <Tooltip
                          contentStyle={{ backgroundColor: "#ffffff", borderColor: "#cbd5e1", borderRadius: "4px", fontSize: "12px" }}
                        />
                        <Line type="monotone" dataKey="resistancePct" name="Resistance %" stroke="#dc2626" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls />
                        <Line type="monotone" dataKey="stockoutRiskPct" name="30-day stockout risk %" stroke="#0284c7" strokeWidth={2} dot={{ r: 2 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-full flex items-center justify-center text-xs text-slate-400 bg-slate-50 rounded border border-dashed border-slate-200">
                      No longitudinal data records found for current filter.
                    </div>
                  )}
                </div>

                {/* Clinical Interpretation Notes Box */}
                <div className="mt-5 p-4 bg-slate-50 border border-slate-200 rounded text-xs text-slate-700 space-y-2">
                  <div className="flex items-center gap-2 font-bold text-slate-900">
                    <Activity className="w-4 h-4 text-sky-700" />
                    Surveillance Summary
                  </div>
                  {latestTrend && firstTrend ? (
                    <p>
                      <strong>Observed trend:</strong> resistance for {selectedAntibiotic} at {selectedHospital} moved from{" "}
                      <strong>{firstTrend.resistance_pct != null ? `${firstTrend.resistance_pct.toFixed(1)}%` : "—"}</strong>{" "}
                      ({new Date(firstTrend.snapshot_date).toLocaleDateString()}) to{" "}
                      <strong>{latestTrend.resistance_pct != null ? `${latestTrend.resistance_pct.toFixed(1)}%` : "—"}</strong>{" "}
                      ({new Date(latestTrend.snapshot_date).toLocaleDateString()}) over {trendChartData.length} months of data.
                    </p>
                  ) : (
                    <p>No surveillance data available for the current selection.</p>
                  )}
                  <p className="text-slate-500">
                    Figures are sourced directly from BigQuery (v_amr_usage_trends, v_live_agent_predictions). Stewardship
                    actions should be reviewed against the medicine's regulatory status and current department allocations.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* =========================================================================
              TAB 3: PHARMACY INVENTORY TABLE
             ========================================================================= */}
          {activeTab === "inventory" && (
            <div className="space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-200">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Pharmacy Inventory & Stockout Prevention</h2>
                  <p className="text-xs text-slate-500">
                    Live hospital store levels, days-of-supply calculations, and replenishment pipeline status.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button className="px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-xs font-medium rounded flex items-center gap-1.5 shadow-sm">
                    <Download className="w-3.5 h-3.5 text-slate-500" /> Export CSV
                  </button>
                </div>
              </div>

              {/* Filters & Search Toolbar */}
              <div className="bg-white p-3 rounded border border-slate-200 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
                <div className="relative w-full sm:w-72">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    placeholder="Search antibiotic or category..."
                    value={inventorySearch}
                    onChange={(e) => setInventorySearch(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded pl-8 pr-3 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-sky-600"
                  />
                </div>

                <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                  <span className="text-slate-500 font-medium">Risk Filter:</span>
                  <select
                    value={inventoryRiskFilter}
                    onChange={(e) => setInventoryRiskFilter(e.target.value)}
                    className="bg-slate-50 border border-slate-300 rounded px-2.5 py-1.5 text-xs text-slate-800 font-medium focus:outline-none"
                  >
                    <option value="ALL">All Risk Levels</option>
                    <option value="CRITICAL">Critical Only (≥80%)</option>
                    <option value="HIGH">High Risk (50%–79%)</option>
                    <option value="NORMAL">Normal / Stable (&lt;50%)</option>
                  </select>
                </div>
              </div>

              {/* Data Table */}
              <div className="bg-white border border-slate-200 rounded shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
                        <th className="py-3 px-4">Antibiotic Name & Class</th>
                        <th className="py-3 px-4">Facility ID</th>
                        <th className="py-3 px-4">Days of Supply</th>
                        <th className="py-3 px-4">Stockout Risk</th>
                        <th className="py-3 px-4">Last Updated</th>
                        <th className="py-3 px-4 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {filteredInventory.length > 0 ? (
                        filteredInventory.map((item, idx) => {
                          const isCritical = item.stockout_probability_30d >= 0.80;
                          const isHigh = item.stockout_probability_30d >= 0.50 && item.stockout_probability_30d < 0.80;

                          return (
                            <tr key={`${item.hospital_id}-${item.antibiotic_id}-${idx}`} className="hover:bg-slate-50 transition-colors">
                              <td className="py-3.5 px-4">
                                <div className="font-semibold text-slate-900">{item.antibiotic_name || item.antibiotic_id}</div>
                                <div className="text-[11px] text-slate-500">ID: {item.antibiotic_id}</div>
                              </td>
                              <td className="py-3.5 px-4 font-mono font-medium text-slate-800">
                                {item.hospital_name || item.hospital_id}
                              </td>
                              <td className="py-3.5 px-4">
                                <span
                                  className={`font-semibold ${isCritical ? "text-red-600 font-bold" : isHigh ? "text-amber-600" : "text-slate-700"
                                    }`}
                                >
                                  {item.predicted_days_remaining} Days
                                </span>
                                <span className="text-slate-400 text-[10px] block">Target: 30 Days Buffer</span>
                              </td>
                              <td className="py-3.5 px-4">
                                <span
                                  className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold ${isCritical
                                      ? "bg-red-100 text-red-800"
                                      : isHigh
                                        ? "bg-amber-100 text-amber-800"
                                        : "bg-emerald-100 text-emerald-800"
                                    }`}
                                >
                                  {(item.stockout_probability_30d * 100).toFixed(1)}% ({item.risk_category || (isCritical ? "CRITICAL" : isHigh ? "HIGH" : "NORMAL")})
                                </span>
                              </td>
                              <td className="py-3.5 px-4 text-slate-600">{item.last_updated ? new Date(item.last_updated).toLocaleDateString() : "—"}</td>
                              <td className="py-3.5 px-4 text-right">
                                <button
                                  onClick={() => setActiveTab("inventory")}
                                  className="px-2.5 py-1 text-xs font-medium text-sky-700 bg-sky-50 hover:bg-sky-100 rounded border border-sky-200"
                                >
                                  Details
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      ) : (
                        <tr>
                          <td colSpan={6} className="py-8 text-center text-slate-500">
                            No inventory records matching active criteria.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
