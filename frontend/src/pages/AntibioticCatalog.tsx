import React, { useEffect, useState } from 'react';
import { Activity, ShieldAlert, RefreshCw } from 'lucide-react';
import { useAmrSurveillance } from '../hooks/data';
import { ErrorState, LoadingRows, EmptyState, LastUpdated } from '../components/States';
import type { AmrSurveillanceRow } from '../api/types';

const AWARE_META: Record<string, string> = {
    ACCESS: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    WATCH: 'bg-amber-50 text-amber-800 border-amber-200',
    RESERVE: 'bg-rose-50 text-rose-800 border-rose-200',
};

function pct(n: number | null | undefined) {
    return n === null || n === undefined ? '—' : `${n.toFixed(1)}%`;
}

export default function AntibioticCatalog() {
    const { data, loading, loaded, error, refetch } = useAmrSurveillance();
    const rows: AmrSurveillanceRow[] = data ?? [];
    const [selectedId, setSelectedId] = useState<string | null>(null);

    useEffect(() => {
        if (!selectedId && rows.length) setSelectedId(rows[0].antibiotic_id);
    }, [rows, selectedId]);

    const selected = rows.find((r) => r.antibiotic_id === selectedId) ?? rows[0];

    return (
        <div className="space-y-6 max-w-7xl mx-auto">
            <div className="flex justify-between items-start">
                <div>
                    <h2 className="text-xl font-bold text-slate-900">Hospital Formulary & AMR Resistance Surveillance</h2>
                    <p className="text-sm text-slate-500">
                        Antimicrobial stewardship monitoring — resistance pressure, consumption and month-over-month trend.
                    </p>
                    <div className="mt-1"><LastUpdated iso={selected?.as_of_date ?? undefined} /></div>
                </div>
                <button
                    onClick={refetch}
                    className="px-3 py-2 border border-slate-300 text-slate-700 text-xs font-semibold rounded-md hover:bg-slate-100 flex items-center gap-2"
                >
                    <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
                </button>
            </div>

            {!loaded && loading && <LoadingRows rows={5} label="Loading surveillance data…" />}
            {error && <ErrorState error={error} onRetry={refetch} title="Unable to load AMR surveillance." />}
            {loaded && !error && rows.length === 0 && <EmptyState title="No surveillance data available." />}

            {loaded && !error && rows.length > 0 && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="lg:col-span-1 bg-white rounded-lg border border-slate-200 shadow-sm p-4 space-y-3">
                        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Monitored Formulary Agents</h3>
                        <div className="space-y-2">
                            {rows.map((drug) => (
                                <button
                                    key={drug.antibiotic_id}
                                    onClick={() => setSelectedId(drug.antibiotic_id)}
                                    className={`w-full text-left p-3 rounded-lg border text-xs transition-all ${
                                        selected?.antibiotic_id === drug.antibiotic_id
                                            ? 'border-sky-500 bg-sky-50/60'
                                            : 'border-slate-200 bg-white hover:bg-slate-50'
                                    }`}
                                >
                                    <div className="flex justify-between items-start gap-2">
                                        <span className="font-bold text-slate-900">{drug.antibiotic_name}</span>
                                        {drug.aware_category && (
                                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${AWARE_META[drug.aware_category] ?? 'bg-slate-50 text-slate-600 border-slate-200'}`}>
                                                {drug.aware_category}
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-slate-500 mt-1">{drug.drug_class || '—'}</p>
                                    <div className="mt-2 flex justify-between items-center pt-2 border-t border-slate-100">
                                        <span className="text-slate-600">Resistance</span>
                                        <span className="font-bold text-slate-800">{pct(drug.resistance_pct)}</span>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>

                    {selected && (
                        <div className="lg:col-span-2 space-y-6">
                            <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-5 space-y-4">
                                <div className="flex justify-between items-start border-b border-slate-200 pb-4">
                                    <div>
                                        {selected.drug_class && (
                                            <span className="text-xs font-semibold text-sky-700 bg-sky-50 px-2 py-0.5 rounded border border-sky-200">
                                                {selected.drug_class}
                                            </span>
                                        )}
                                        <h3 className="text-lg font-bold text-slate-900 mt-1">{selected.antibiotic_name} — Clinical Surveillance</h3>
                                        <p className="text-xs text-slate-500">
                                            Primary monitored pathogen:{' '}
                                            <strong className="text-slate-800">{selected.primary_pathogen || 'Not recorded'}</strong>
                                        </p>
                                    </div>
                                    <div className="text-right">
                                        <span className="text-xs text-slate-500">Current resistance rate</span>
                                        <p className="text-2xl font-bold text-rose-700">{pct(selected.resistance_pct)}</p>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="p-3 bg-slate-50 rounded border border-slate-200 text-xs">
                                        <span className="text-slate-500">Consumption (DDD / 1000 patient-days):</span>
                                        <p className="font-bold text-slate-800 text-sm mt-0.5">
                                            {selected.usage_ddd_rate != null ? selected.usage_ddd_rate.toFixed(1) : '—'}
                                        </p>
                                    </div>
                                    <div className="p-3 bg-slate-50 rounded border border-slate-200 text-xs">
                                        <span className="text-slate-500">Month-over-month resistance change:</span>
                                        <p
                                            className={`font-bold text-sm mt-0.5 flex items-center gap-1 ${
                                                (selected.resistance_change ?? 0) > 0 ? 'text-amber-700' : 'text-emerald-700'
                                            }`}
                                        >
                                            <Activity className="w-4 h-4" />
                                            {selected.resistance_change == null
                                                ? '—'
                                                : `${selected.resistance_change > 0 ? '+' : ''}${selected.resistance_change.toFixed(2)} pts`}
                                        </p>
                                    </div>
                                </div>

                                {selected.aware_category === 'RESERVE' && (
                                    <div className="p-4 bg-sky-50/50 border border-sky-200 rounded-lg text-xs space-y-2">
                                        <div className="flex items-center gap-2 font-bold text-sky-900">
                                            <ShieldAlert className="w-4 h-4 text-sky-700" />
                                            Antimicrobial Stewardship Note
                                        </div>
                                        <p className="text-slate-700 leading-relaxed">
                                            {selected.antibiotic_name} is a WHO <strong>Reserve</strong> agent. Restriction and
                                            approval rules are enforced by hospital policy — see the medicine's regulatory status
                                            before issue.
                                        </p>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
