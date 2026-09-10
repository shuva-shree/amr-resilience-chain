import React, { useState } from 'react';
import { ShieldCheck, Database, FileText, Play } from 'lucide-react';
import { useAuditEvents, useDataQuality } from '../hooks/data';
import { GovernanceApi } from '../api/endpoints';
import { ApiError } from '../api/client';
import { ErrorState, LoadingRows, EmptyState } from '../components/States';

const RESULT_CLS: Record<string, string> = {
    success: 'bg-emerald-100 text-emerald-800',
    blocked: 'bg-rose-100 text-rose-800',
    pending_approval: 'bg-amber-100 text-amber-800',
    failed: 'bg-rose-100 text-rose-800',
};

export default function GovernancePanel() {
    const [activeTab, setActiveTab] = useState<'audit' | 'dq'>('audit');
    const audit = useAuditEvents(100);
    const dq = useDataQuality();
    const [running, setRunning] = useState(false);
    const [runError, setRunError] = useState<ApiError | null>(null);

    const runDQ = async () => {
        setRunning(true);
        setRunError(null);
        try {
            await GovernanceApi.runDataQuality();
            dq.refetch();
        } catch (e) {
            setRunError(e instanceof ApiError ? e : new ApiError('UNKNOWN', 'Could not run checks.', 0));
        } finally {
            setRunning(false);
        }
    };

    return (
        <div className="max-w-7xl mx-auto space-y-6">
            <div className="border-b border-slate-200 pb-4">
                <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                    <ShieldCheck className="w-7 h-7 text-sky-700" />
                    Governance — Audit Trail & Data Quality
                </h1>
                <p className="text-sm text-slate-500 mt-1">
                    Immutable operational audit log and automated data-quality checks, sourced from BigQuery.
                </p>
            </div>

            <div className="flex border-b border-slate-200 gap-4">
                <TabButton active={activeTab === 'audit'} onClick={() => setActiveTab('audit')} Icon={FileText}>
                    Audit Events
                </TabButton>
                <TabButton active={activeTab === 'dq'} onClick={() => setActiveTab('dq')} Icon={Database}>
                    Data Quality
                </TabButton>
            </div>

            {activeTab === 'audit' && (
                <>
                    {!audit.loaded && audit.loading && <LoadingRows rows={6} label="Loading audit events…" />}
                    {audit.error && <ErrorState error={audit.error} onRetry={audit.refetch} title="Unable to load audit events." />}
                    {audit.loaded && !audit.error && (audit.data ?? []).length === 0 && (
                        <EmptyState title="No audit events recorded yet." hint="Events appear here as medicines are issued and allocations change." />
                    )}
                    {audit.loaded && !audit.error && (audit.data ?? []).length > 0 && (
                        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
                            <table className="w-full text-left text-xs">
                                <thead className="bg-slate-50 text-slate-600 font-semibold">
                                    <tr>
                                        <th className="p-3">Timestamp</th>
                                        <th className="p-3">Event Type</th>
                                        <th className="p-3">Actor</th>
                                        <th className="p-3">Action</th>
                                        <th className="p-3">Result</th>
                                        <th className="p-3">Reason</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-200">
                                    {(audit.data ?? []).map((log) => (
                                        <tr key={log.event_id} className="hover:bg-slate-50/60">
                                            <td className="p-3 text-slate-500 whitespace-nowrap font-mono">
                                                {new Date(log.event_timestamp).toLocaleString()}
                                            </td>
                                            <td className="p-3 font-semibold text-slate-900">{log.event_type}</td>
                                            <td className="p-3">
                                                {log.actor_id}
                                                {log.actor_role && <span className="text-slate-400"> ({log.actor_role})</span>}
                                            </td>
                                            <td className="p-3">{log.action}</td>
                                            <td className="p-3">
                                                <span className={`px-2 py-0.5 rounded ${RESULT_CLS[log.result ?? ''] ?? 'bg-slate-100 text-slate-700'}`}>
                                                    {log.result ?? '—'}
                                                </span>
                                            </td>
                                            <td className="p-3 text-slate-500">{log.reason || '—'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </>
            )}

            {activeTab === 'dq' && (
                <div className="space-y-4">
                    <div className="flex justify-end">
                        <button
                            onClick={runDQ}
                            disabled={running}
                            className="px-4 py-2 bg-sky-700 text-white rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-60"
                        >
                            <Play className="w-4 h-4" /> {running ? 'Running…' : 'Run checks now'}
                        </button>
                    </div>
                    {runError && <ErrorState error={runError} title="The data-quality run did not complete." />}
                    {!dq.loaded && dq.loading && <LoadingRows rows={3} label="Loading data-quality results…" />}
                    {dq.error && <ErrorState error={dq.error} onRetry={dq.refetch} title="Unable to load data-quality results." />}
                    {dq.loaded && !dq.error && (dq.data ?? []).length === 0 && (
                        <EmptyState title="No data-quality runs recorded." hint="Use “Run checks now” to execute the suite." />
                    )}
                    {dq.loaded && !dq.error && (dq.data ?? []).length > 0 && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {(dq.data ?? []).map((check) => (
                                <div key={check.check_id} className="bg-white border border-slate-200 p-4 rounded-xl space-y-2">
                                    <div className="flex justify-between items-start gap-2">
                                        <h3 className="font-semibold text-slate-900 text-sm">{check.check_name}</h3>
                                        <span
                                            className={`px-2 py-0.5 rounded text-xs font-bold ${
                                                check.check_status === 'passed' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                                            }`}
                                        >
                                            {check.check_status.toUpperCase()}
                                        </span>
                                    </div>
                                    <div className="text-xs text-slate-500">
                                        Target: <span className="font-mono text-slate-700">{check.target_table}</span>
                                    </div>
                                    <div className="text-xs text-slate-500">
                                        Checked {check.records_checked} · Passed {check.records_passed} · Failed {check.records_failed}
                                    </div>
                                    <div className="text-[11px] text-slate-400 font-mono">
                                        {new Date(check.check_timestamp).toLocaleString()}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function TabButton({
    active,
    onClick,
    Icon,
    children,
}: {
    active: boolean;
    onClick: () => void;
    Icon: typeof FileText;
    children: React.ReactNode;
}) {
    return (
        <button
            onClick={onClick}
            className={`pb-3 font-medium text-sm flex items-center gap-2 border-b-2 transition-colors ${
                active ? 'border-sky-700 text-sky-700' : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
        >
            <Icon className="w-4 h-4" /> {children}
        </button>
    );
}
