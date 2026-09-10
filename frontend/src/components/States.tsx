import React from "react";
import { AlertCircle, Inbox, RefreshCw } from "lucide-react";
import type { ApiError } from "../api/client";

export function LoadingRows({ rows = 5, label = "Loading…" }: { rows?: number; label?: string }) {
  return (
    <div className="space-y-2" role="status" aria-live="polite">
      <p className="text-xs text-slate-500">{label}</p>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-10 rounded-md bg-slate-100 animate-pulse" />
      ))}
    </div>
  );
}

export function ErrorState({
  error,
  onRetry,
  title = "Unable to load this information.",
}: {
  error: ApiError | null;
  onRetry?: () => void;
  title?: string;
}) {
  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50/60 p-5 text-sm">
      <div className="flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-semibold text-rose-900">{title}</p>
          <p className="text-rose-800">{error?.message || "Please try again."}</p>
          {error?.requestId && (
            <p className="text-[11px] font-mono text-rose-500">Reference: {error.requestId}</p>
          )}
          {onRetry && (
            <button
              onClick={onRetry}
              className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-rose-300 bg-white px-2.5 py-1.5 text-xs font-medium text-rose-800 hover:bg-rose-100"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Try again
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function EmptyState({
  title = "Nothing to show yet.",
  hint,
}: {
  title?: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-200 p-10 text-center">
      <Inbox className="w-8 h-8 text-slate-300 mb-2" />
      <p className="text-sm font-medium text-slate-600">{title}</p>
      {hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
    </div>
  );
}

export function LastUpdated({ iso }: { iso?: string | null }) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  const rel =
    mins < 1 ? "just now" : mins < 60 ? `${mins} min ago` : d.toLocaleDateString();
  return <span className="text-[11px] text-slate-400">Data as of {d.toLocaleDateString()} · updated {rel}</span>;
}
