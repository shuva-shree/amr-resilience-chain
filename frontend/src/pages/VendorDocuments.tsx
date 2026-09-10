import React, { useRef, useState } from "react";
import { FileText, Upload, CheckCircle2, XCircle, ClipboardCheck, RefreshCw, X, Info } from "lucide-react";
import { useVendorDoc, useVendorDocs } from "../hooks/data";
import { VendorApi } from "../api/endpoints";
import { ApiError } from "../api/client";
import { ErrorState, LoadingRows, EmptyState } from "../components/States";

const STATUS_CLS: Record<string, string> = {
  pending: "bg-slate-100 text-slate-700",
  validated: "bg-sky-100 text-sky-800",
  approved: "bg-emerald-100 text-emerald-800",
  rejected: "bg-rose-100 text-rose-800",
};
const ACTION_LABEL: Record<string, string> = { validate: "Validate", approve: "Approve", reject: "Reject" };

function money(n: number | null, cur: string | null) {
  if (n == null) return "—";
  return `${cur ? cur + " " : ""}${n.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
}

export default function VendorDocuments() {
  const [statusFilter, setStatusFilter] = useState("ALL");
  const docs = useVendorDocs(statusFilter === "ALL" ? undefined : statusFilter);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const [docType, setDocType] = useState("invoice");
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [uploadErr, setUploadErr] = useState<string | null>(null);

  const doUpload = async (file: File) => {
    setUploading(true); setUploadMsg(null); setUploadErr(null);
    try {
      const r = await VendorApi.upload(file, docType);
      setUploadMsg(`Uploaded ${file.name}. Extracted: ${r.extracted_metadata?.vendor_name ?? "vendor n/a"}, ${money(r.extracted_metadata?.invoice_amount ?? null, r.extracted_metadata?.currency ?? null)}.`);
      docs.refetch();
    } catch (e) {
      setUploadErr(e instanceof ApiError ? e.message : "Upload failed.");
    } finally { setUploading(false); }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="border-b border-slate-200 pb-4">
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <FileText className="w-7 h-7 text-sky-700" />
          Vendor Documents
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Contracts, agreements and invoices — stored in Cloud Storage, metadata auto-extracted, admin approval with an immutable audit trail.
        </p>
      </div>

      {/* Upload */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-medium text-slate-600">
            Document type
            <select value={docType} onChange={(e) => setDocType(e.target.value)}
              className="mt-1 block px-3 py-1.5 text-sm border border-slate-300 rounded-md">
              {["invoice", "contract", "agreement", "purchase_order", "other"].map((t) => <option key={t}>{t}</option>)}
            </select>
          </label>
          <button onClick={() => fileRef.current?.click()} disabled={uploading}
            className="flex items-center gap-2 px-4 py-2 bg-sky-700 hover:bg-sky-800 text-white text-sm font-semibold rounded-md disabled:opacity-60">
            {uploading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} Upload document
          </button>
          <input ref={fileRef} type="file" className="hidden"
            accept=".pdf,.png,.jpg,.jpeg,.txt,.csv,application/pdf,image/png,image/jpeg,text/plain,text/csv"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) doUpload(f); e.currentTarget.value = ""; }} />
        </div>
        <div className="mt-3 flex gap-2 text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-md p-2.5">
          <Info className="w-4 h-4 shrink-0 text-slate-400" />
          <p>
            Accepted file types: <strong>PDF</strong>, <strong>PNG / JPG</strong> scans, or <strong>plain-text / CSV</strong>.
            A <strong>text-based PDF</strong> (not a photo) gives the best automatic extraction of vendor name, amount and
            dates. Maximum size <strong>25&nbsp;MB</strong>. Word / Excel files are not supported — export to PDF first.
          </p>
        </div>
        {uploadMsg && <p className="text-xs text-emerald-700 mt-2">{uploadMsg}</p>}
        {uploadErr && <p className="text-xs text-rose-700 mt-2">{uploadErr}</p>}
      </div>

      <div className="flex items-center gap-2 text-xs">
        {["ALL", "pending", "validated", "approved", "rejected"].map((s) => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={`px-3 py-1 rounded-md font-medium ${statusFilter === s ? "bg-sky-700 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>
            {s}
          </button>
        ))}
      </div>

      {!docs.loaded && docs.loading && <LoadingRows rows={5} label="Loading documents…" />}
      {docs.error && <ErrorState error={docs.error} onRetry={docs.refetch} title="Unable to load documents." />}
      {docs.loaded && !docs.error && (docs.data ?? []).length === 0 && <EmptyState title="No documents in this state." />}

      {docs.loaded && !docs.error && (docs.data ?? []).length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-600 font-semibold">
              <tr>
                <th className="p-3 text-left">Uploaded</th><th className="p-3 text-left">Vendor</th><th className="p-3 text-left">Type</th>
                <th className="p-3 text-right">Amount</th><th className="p-3 text-left">Expires</th><th className="p-3 text-left">Extraction</th>
                <th className="p-3 text-left">Status</th><th className="p-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {(docs.data ?? []).map((d) => (
                <tr key={d.document_id} className="hover:bg-slate-50/60">
                  <td className="p-3 font-mono text-slate-500">{new Date(d.uploaded_at).toLocaleDateString()}</td>
                  <td className="p-3 font-medium text-slate-800">{d.vendor_name || "—"}</td>
                  <td className="p-3">{d.doc_type}</td>
                  <td className="p-3 text-right">{money(d.invoice_amount, d.currency)}</td>
                  <td className="p-3">{d.contract_expiration || "—"}</td>
                  <td className="p-3 text-slate-500">{d.extraction_method}</td>
                  <td className="p-3"><span className={`px-2 py-0.5 rounded ${STATUS_CLS[d.status]}`}>{d.status}</span></td>
                  <td className="p-3 text-right">
                    <button onClick={() => setSelectedId(d.document_id)} className="text-sky-700 font-medium hover:underline">Review</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedId && (
        <DocumentDrawer id={selectedId} onClose={() => setSelectedId(null)} onChanged={() => docs.refetch()} />
      )}
    </div>
  );
}

function DocumentDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const detail = useVendorDoc(id);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [actionErr, setActionErr] = useState<string | null>(null);

  const doc = detail.data?.document;

  const act = async (action: string) => {
    setBusy(action); setActionErr(null);
    try {
      await VendorApi.transition(id, action, notes || undefined);
      detail.refetch();
      onChanged();
    } catch (e) {
      setActionErr(e instanceof ApiError ? e.message : "Action failed.");
    } finally { setBusy(null); }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/30" onClick={onClose}>
      <div className="w-full max-w-lg bg-white h-full overflow-y-auto shadow-xl p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-start">
          <h2 className="text-lg font-bold text-slate-900">Document review</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-slate-400" /></button>
        </div>

        {!detail.loaded && detail.loading && <LoadingRows rows={5} label="Loading…" />}
        {detail.error && <ErrorState error={detail.error} onRetry={detail.refetch} title="Unable to load the document." />}

        {doc && (
          <>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <Field label="Vendor" value={doc.vendor_name} />
              <Field label="Type" value={doc.doc_type} />
              <Field label="Invoice amount" value={money(doc.invoice_amount, doc.currency)} />
              <Field label="Contract expiration" value={doc.contract_expiration} />
              <Field label="Extraction method" value={doc.extraction_method} />
              <Field label="Status" value={doc.status} />
              <Field label="File" value={doc.original_filename} />
              <Field label="Size" value={doc.size_bytes ? `${Math.round(doc.size_bytes / 1024)} KB` : "—"} />
            </div>

            {detail.data?.download_url && (
              <a href={detail.data.download_url} target="_blank" rel="noreferrer"
                className="text-xs text-sky-700 hover:underline break-all">Open stored file ↗</a>
            )}

            {Array.isArray(doc.line_items) && doc.line_items.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-slate-600 mb-1">Line items</p>
                <table className="w-full text-xs border border-slate-200 rounded">
                  <thead className="bg-slate-50 text-slate-500"><tr><th className="p-2 text-left">Item</th><th className="p-2 text-right">Qty</th><th className="p-2 text-right">Unit</th><th className="p-2 text-right">Total</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {doc.line_items.map((li: any, i: number) => (
                      <tr key={i}><td className="p-2">{li.description}</td><td className="p-2 text-right">{li.quantity}</td><td className="p-2 text-right">{li.unit_price}</td><td className="p-2 text-right font-medium">{li.line_total}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Actions */}
            {doc.allowed_actions?.length > 0 && (
              <div className="border-t border-slate-200 pt-3 space-y-2">
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
                  placeholder="Review note (optional)"
                  className="w-full text-xs border border-slate-300 rounded-md p-2" />
                <div className="flex gap-2">
                  {doc.allowed_actions.includes("validate") && (
                    <button onClick={() => act("validate")} disabled={!!busy}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-700 text-white text-xs font-medium rounded-md disabled:opacity-60">
                      <ClipboardCheck className="w-3.5 h-3.5" /> Validate
                    </button>
                  )}
                  {doc.allowed_actions.includes("approve") && (
                    <button onClick={() => act("approve")} disabled={!!busy}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white text-xs font-medium rounded-md disabled:opacity-60">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Approve
                    </button>
                  )}
                  {doc.allowed_actions.includes("reject") && (
                    <button onClick={() => act("reject")} disabled={!!busy}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-600 text-white text-xs font-medium rounded-md disabled:opacity-60">
                      <XCircle className="w-3.5 h-3.5" /> Reject
                    </button>
                  )}
                </div>
                {actionErr && <p className="text-xs text-rose-700">{actionErr}</p>}
              </div>
            )}

            {/* Audit trail */}
            <div className="border-t border-slate-200 pt-3">
              <p className="text-xs font-semibold text-slate-600 mb-2">Audit trail</p>
              <ol className="space-y-2">
                {(detail.data?.events ?? []).map((ev) => (
                  <li key={ev.event_id} className="text-xs flex gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-400 mt-1.5 shrink-0" />
                    <div>
                      <span className="font-semibold text-slate-800">{ev.event_type}</span>
                      {ev.from_status && <span className="text-slate-500"> · {ev.from_status} → {ev.to_status}</span>}
                      <span className="text-slate-400"> · {ev.actor_id} ({ev.actor_role})</span>
                      <span className="text-slate-400"> · {new Date(ev.event_timestamp).toLocaleString()}</span>
                      {ev.notes && <p className="text-slate-600">{ev.notes}</p>}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="bg-slate-50 rounded border border-slate-200 p-2">
      <p className="text-[10px] uppercase tracking-wider text-slate-400">{label}</p>
      <p className="font-medium text-slate-800 break-words">{value || "—"}</p>
    </div>
  );
}
