import React, { useState } from "react";
import { CloudDownload, Hospital, RefreshCw, Play, ShieldCheck, CalendarClock, Info } from "lucide-react";
import { useGlassRuns, useHospitalBatches } from "../hooks/data";
import { IngestionApi } from "../api/endpoints";
import { ApiError } from "../api/client";
import { ErrorState, LoadingRows, EmptyState } from "../components/States";

const STATUS_CLS: Record<string, string> = {
  success: "bg-emerald-100 text-emerald-800",
  loaded: "bg-emerald-100 text-emerald-800",
  running: "bg-sky-100 text-sky-800",
  partial: "bg-amber-100 text-amber-800",
  failed: "bg-rose-100 text-rose-800",
  received: "bg-slate-100 text-slate-700",
};

// WHO GLASS taxonomy — used to constrain the manual-run filters to valid values.
const GLASS_OPTIONS = {
  region: [
    "African Region",
    "Region of the Americas",
    "South-East Asia Region",
    "European Region",
    "Eastern Mediterranean Region",
    "Western Pacific Region",
  ],
  infection_type: ["BLOOD", "URINE", "STOOL", "UROGENITAL"],
  pathogen: [
    "Escherichia coli",
    "Klebsiella pneumoniae",
    "Staphylococcus aureus",
    "Streptococcus pneumoniae",
    "Acinetobacter baumannii",
    "Salmonella spp.",
    "Shigella spp.",
    "Neisseria gonorrhoeae",
  ],
  antibiotic: [
    "Ciprofloxacin",
    "Ceftriaxone",
    "Cefotaxime",
    "Ceftazidime",
    "Meropenem",
    "Imipenem",
    "Colistin",
    "Amikacin",
    "Gentamicin",
    "Piperacillin-tazobactam",
    "Vancomycin",
    "Oxacillin",
    "Azithromycin",
  ],
} as const;

const SAMPLE_RECORDS = [
  { collection_date: "2026-09-01", specimen: "blood", infection_type: "BSI", pathogen: "Escherichia coli", antibiotic: "Ciprofloxacin", mic_value: 4, interpretation: "R", patient_age: 63, patient_sex: "F", patient_name: "REDACT ME", mrn: "MRN-55521" },
  { collection_date: "2026-09-02", specimen: "urine", infection_type: "UTI", pathogen: "Klebsiella pneumoniae", antibiotic: "Meropenem", mic_value: 0.25, interpretation: "S", patient_age: 41, patient_sex: "M" },
  { collection_date: "2026-09-02", specimen: "sputum", infection_type: "LRTI", pathogen: "Pseudomonas aeruginosa", antibiotic: "Amikacin", mic_value: 32, interpretation: "R", patient_age: 77, patient_sex: "M" },
];

export default function AdminIngestion() {
  const runs = useGlassRuns();
  const batches = useHospitalBatches();
  const [tab, setTab] = useState<"glass" | "hospital">("glass");

  // GLASS trigger form
  const [q, setQ] = useState({ region: "", infection_type: "", pathogen: "", antibiotic: "" });
  const [scrape, setScrape] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);

  const triggerGlass = async () => {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await IngestionApi.glassRun({ ...q, scrape });
      setMsg(r.message);
      setTimeout(() => runs.refetch(), 1500);
    } catch (e) {
      setErr(e instanceof ApiError ? e : new ApiError("X", "Trigger failed.", 0));
    } finally { setBusy(false); }
  };

  const [pushMsg, setPushMsg] = useState<string | null>(null);
  const pushSample = async () => {
    setPushMsg("Pushing…");
    try {
      const r = await IngestionApi.pushRecords(SAMPLE_RECORDS, "H001");
      setPushMsg(`Batch ${r.batch_id}: ${r.accepted} accepted, ${r.rejected} rejected. PII removed: ${(r.pii_fields_removed || []).join(", ") || "none"}`);
      batches.refetch();
    } catch (e) {
      setPushMsg(e instanceof ApiError ? e.message : "Push failed.");
    }
  };
  const [dropMsg, setDropMsg] = useState<string | null>(null);
  const processDrops = async () => {
    setDropMsg("Scanning staging bucket…");
    try {
      const r = await IngestionApi.processDrops();
      setDropMsg(`${r.drops_processed} new drop(s) processed.`);
      batches.refetch();
    } catch (e) {
      setDropMsg(e instanceof ApiError ? e.message : "Failed.");
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="border-b border-slate-200 pb-4">
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <CloudDownload className="w-7 h-7 text-sky-700" />
          Data Ingestion
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          WHO GLASS monthly agent and hospital / pathology-lab feeds. All inbound records are PII-stripped before storage.
        </p>
      </div>

      <div className="flex gap-4 border-b border-slate-200">
        <TabBtn active={tab === "glass"} onClick={() => setTab("glass")} Icon={CloudDownload}>GLASS Agent</TabBtn>
        <TabBtn active={tab === "hospital"} onClick={() => setTab("hospital")} Icon={Hospital}>Hospital Feeds</TabBtn>
      </div>

      {tab === "glass" && (
        <>
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex gap-3 text-xs text-amber-900">
            <CalendarClock className="w-5 h-5 shrink-0 text-amber-600" />
            <div className="space-y-1">
              <p className="font-semibold">Ingestion is already automated.</p>
              <p>
                The WHO&nbsp;GLASS dataset is pulled <strong>automatically once a month</strong> and the hospital
                staging bucket is swept <strong>every 15&nbsp;minutes</strong>. You normally don't need to do anything here.
              </p>
              <p>
                Only start a manual run if a scheduled run <strong>failed</strong> or is missing — check the run
                history below first.
              </p>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-3">
            <h2 className="text-sm font-semibold text-slate-800">Manual GLASS run (recovery)</h2>
            <p className="text-xs text-slate-500">
              Leave a filter on “Any” to pull the full dataset. Narrow it only to re-fetch a specific slice.
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {(["region", "infection_type", "pathogen", "antibiotic"] as const).map((f) => (
                <label key={f} className="text-xs font-medium text-slate-600">
                  {f.replace("_", " ")}
                  <select
                    value={(q as any)[f]}
                    onChange={(e) => setQ({ ...q, [f]: e.target.value })}
                    className="mt-1 w-full px-2 py-1.5 text-sm border border-slate-300 rounded-md bg-white"
                  >
                    <option value="">Any</option>
                    {GLASS_OPTIONS[f].map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input type="checkbox" checked={scrape} onChange={(e) => setScrape(e.target.checked)} />
              Run browser agent against the GLASS portal (uncheck to only load files already in the raw bucket)
            </label>
            <button onClick={triggerGlass} disabled={busy}
              className="flex items-center gap-2 px-4 py-2 bg-sky-700 hover:bg-sky-800 text-white text-sm font-semibold rounded-md disabled:opacity-60">
              {busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />} Start manual run
            </button>
            {msg && <p className="text-xs text-emerald-700">{msg}</p>}
            {err && <ErrorState error={err} title="Could not start the job." />}
          </div>

          <RunsTable runs={runs} />
        </>
      )}

      {tab === "hospital" && (
        <>
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex gap-3 text-xs text-slate-600">
            <Info className="w-5 h-5 shrink-0 text-slate-400" />
            <p>
              Hospital and pathology-lab feeds arrive continuously over the API, and the staging bucket is swept
              automatically every 15&nbsp;minutes. The buttons below are manual tools for testing or for forcing a
              re-scan if a drop was missed. All inbound records are PII-stripped before storage.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-2">
              <h2 className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-600" /> REST push (test)
              </h2>
              <p className="text-xs text-slate-500">
                Sends 3 sample lab records (with fake PII) to <code>POST /api/v1/ingestion/hospital/records</code>.
              </p>
              <button onClick={pushSample} className="px-3 py-1.5 bg-slate-800 text-white text-xs font-medium rounded-md">
                Push sample records
              </button>
              {pushMsg && <p className="text-xs text-slate-600">{pushMsg}</p>}
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-2">
              <h2 className="text-sm font-semibold text-slate-800">Bucket drop listener</h2>
              <p className="text-xs text-slate-500">
                Process new CSV/JSON files dropped into the hospital staging bucket.
              </p>
              <button onClick={processDrops} className="px-3 py-1.5 bg-slate-800 text-white text-xs font-medium rounded-md">
                Scan &amp; ingest drops
              </button>
              {dropMsg && <p className="text-xs text-slate-600">{dropMsg}</p>}
            </div>
          </div>
          <BatchesTable batches={batches} />
        </>
      )}
    </div>
  );
}

function RunsTable({ runs }: { runs: ReturnType<typeof useGlassRuns> }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
      <div className="px-4 py-2 flex items-center justify-between border-b border-slate-200">
        <h2 className="text-sm font-semibold text-slate-800">Run history</h2>
        <button onClick={runs.refetch} aria-label="Refresh"><RefreshCw className={`w-4 h-4 text-slate-500 ${runs.loading ? "animate-spin" : ""}`} /></button>
      </div>
      {!runs.loaded && runs.loading && <div className="p-4"><LoadingRows rows={4} label="Loading runs…" /></div>}
      {runs.error && <div className="p-4"><ErrorState error={runs.error} onRetry={runs.refetch} title="Unable to load runs." /></div>}
      {runs.loaded && !runs.error && (runs.data ?? []).length === 0 && <div className="p-4"><EmptyState title="No GLASS runs yet." /></div>}
      {runs.loaded && !runs.error && (runs.data ?? []).length > 0 && (
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-600 font-semibold">
            <tr><th className="p-3 text-left">Started</th><th className="p-3 text-left">Type</th><th className="p-3 text-left">Status</th>
              <th className="p-3 text-right">Files</th><th className="p-3 text-right">Ingested</th><th className="p-3 text-right">Deduped</th>
              <th className="p-3 text-left">By</th><th className="p-3 text-left">Note</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {(runs.data ?? []).map((r) => (
              <tr key={r.run_id} className="hover:bg-slate-50/60">
                <td className="p-3 font-mono text-slate-500">{new Date(r.started_at).toLocaleString()}</td>
                <td className="p-3">{r.run_type}</td>
                <td className="p-3"><span className={`px-2 py-0.5 rounded ${STATUS_CLS[r.status] ?? "bg-slate-100"}`}>{r.status}</span></td>
                <td className="p-3 text-right">{r.files_downloaded}</td>
                <td className="p-3 text-right font-semibold">{r.rows_ingested}</td>
                <td className="p-3 text-right text-slate-500">{r.rows_deduplicated}</td>
                <td className="p-3 text-slate-500">{r.triggered_by}</td>
                <td className="p-3 text-slate-500 max-w-[240px] truncate" title={r.error ?? ""}>{r.error ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function BatchesTable({ batches }: { batches: ReturnType<typeof useHospitalBatches> }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
      <div className="px-4 py-2 flex items-center justify-between border-b border-slate-200">
        <h2 className="text-sm font-semibold text-slate-800">Ingestion batches</h2>
        <button onClick={batches.refetch} aria-label="Refresh"><RefreshCw className={`w-4 h-4 text-slate-500 ${batches.loading ? "animate-spin" : ""}`} /></button>
      </div>
      {!batches.loaded && batches.loading && <div className="p-4"><LoadingRows rows={4} label="Loading batches…" /></div>}
      {batches.error && <div className="p-4"><ErrorState error={batches.error} onRetry={batches.refetch} title="Unable to load batches." /></div>}
      {batches.loaded && !batches.error && (batches.data ?? []).length === 0 && <div className="p-4"><EmptyState title="No hospital batches yet." /></div>}
      {batches.loaded && !batches.error && (batches.data ?? []).length > 0 && (
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-600 font-semibold">
            <tr><th className="p-3 text-left">Received</th><th className="p-3 text-left">Source</th><th className="p-3 text-left">Hospital</th>
              <th className="p-3 text-right">Records</th><th className="p-3 text-right">Accepted</th><th className="p-3 text-right">Rejected</th>
              <th className="p-3 text-left">Status</th><th className="p-3 text-left">PII removed</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {(batches.data ?? []).map((b) => (
              <tr key={b.batch_id} className="hover:bg-slate-50/60">
                <td className="p-3 font-mono text-slate-500">{new Date(b.received_at).toLocaleString()}</td>
                <td className="p-3">{b.source}</td>
                <td className="p-3">{b.hospital_id ?? "—"}</td>
                <td className="p-3 text-right">{b.record_count}</td>
                <td className="p-3 text-right font-semibold text-emerald-700">{b.accepted_count}</td>
                <td className="p-3 text-right text-rose-700">{b.rejected_count}</td>
                <td className="p-3"><span className={`px-2 py-0.5 rounded ${STATUS_CLS[b.status] ?? "bg-slate-100"}`}>{b.status}</span></td>
                <td className="p-3 text-slate-500">{Array.isArray(b.pii_fields_removed) ? b.pii_fields_removed.join(", ") || "—" : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function TabBtn({ active, onClick, Icon, children }: { active: boolean; onClick: () => void; Icon: typeof Hospital; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`pb-3 font-medium text-sm flex items-center gap-2 border-b-2 ${active ? "border-sky-700 text-sky-700" : "border-transparent text-slate-500 hover:text-slate-800"}`}>
      <Icon className="w-4 h-4" /> {children}
    </button>
  );
}
