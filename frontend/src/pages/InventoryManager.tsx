import React, { useMemo, useState } from 'react';
import { Package, AlertTriangle, ShieldCheck, Clock, Filter, RefreshCw } from 'lucide-react';
import { useInventory } from '../hooks/data';
import { ErrorState, LoadingRows, EmptyState, LastUpdated } from '../components/States';
import type { InventoryItem } from '../api/types';

const STATUS_META: Record<string, { label: string; cls: string; Icon: typeof ShieldCheck }> = {
    optimal: { label: 'Healthy Buffer', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200', Icon: ShieldCheck },
    warning: { label: 'Reorder Soon', cls: 'bg-amber-50 text-amber-800 border-amber-200', Icon: AlertTriangle },
    critical: { label: 'Stockout Danger', cls: 'bg-rose-50 text-rose-800 border-rose-200', Icon: AlertTriangle },
    unknown: { label: 'No Consumption Data', cls: 'bg-slate-50 text-slate-600 border-slate-200', Icon: Clock },
};

function fmt(n: number | null | undefined, digits = 0): string {
    if (n === null || n === undefined || Number.isNaN(n)) return '—';
    return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

export default function InventoryManager() {
    const { data, loading, loaded, error, refetch } = useInventory('H001');
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');

    const items: InventoryItem[] = data ?? [];

    const filtered = useMemo(
        () =>
            items.filter((item) => {
                const q = searchTerm.toLowerCase();
                const matchesSearch =
                    !q ||
                    item.antibiotic_name.toLowerCase().includes(q) ||
                    item.antibiotic_id.toLowerCase().includes(q) ||
                    (item.drug_class ?? '').toLowerCase().includes(q);
                const matchesStatus = statusFilter === 'all' || item.status === statusFilter;
                return matchesSearch && matchesStatus;
            }),
        [items, searchTerm, statusFilter],
    );

    const counts = useMemo(() => {
        const c = { critical: 0, warning: 0, optimal: 0 };
        for (const i of items) if (i.status in c) (c as any)[i.status]++;
        return c;
    }, [items]);

    const asOf = items[0]?.as_of_date;

    return (
        <div className="space-y-6 max-w-7xl mx-auto">
            <div className="flex justify-between items-start">
                <div>
                    <h2 className="text-xl font-bold text-slate-900">Pharmacy Inventory & Stock Coverage</h2>
                    <p className="text-sm text-slate-500">
                        Current on-hand stock, daily burn rate, and safety-buffer coverage for tracked antibiotics.
                    </p>
                    <div className="mt-1"><LastUpdated iso={asOf} /></div>
                </div>
                <button
                    onClick={refetch}
                    className="px-3 py-2 border border-slate-300 text-slate-700 text-xs font-semibold rounded-md hover:bg-slate-100 transition-colors flex items-center gap-2"
                >
                    <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <SummaryCard label="Tracked Antibiotics" value={loaded ? String(items.length) : '—'} hint="Latest inventory snapshot" />
                <SummaryCard label="Below Safety Buffer" value={loaded ? String(counts.warning) : '—'} hint="Coverage under safety target" tone="amber" />
                <SummaryCard label="Critical Stockout Risk" value={loaded ? String(counts.critical) : '—'} hint="Under 10 days of supply" tone="rose" />
                <SummaryCard label="Healthy Buffer" value={loaded ? String(counts.optimal) : '—'} hint="At or above target coverage" tone="emerald" />
            </div>

            <div className="p-4 bg-white rounded-lg border border-slate-200 shadow-sm flex flex-wrap gap-4 items-center justify-between">
                <input
                    type="text"
                    placeholder="Search antibiotic name, ID or class…"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="flex-1 min-w-[260px] px-3 py-1.5 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
                <div className="flex items-center gap-2 text-xs font-medium text-slate-600">
                    <Filter className="w-3.5 h-3.5" /> Status
                    <select
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                        className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-md bg-white font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-500"
                    >
                        <option value="all">All inventory</option>
                        <option value="optimal">Healthy buffer</option>
                        <option value="warning">Reorder soon</option>
                        <option value="critical">Critical risk</option>
                    </select>
                </div>
            </div>

            {!loaded && loading && <LoadingRows rows={5} label="Loading inventory…" />}
            {error && <ErrorState error={error} onRetry={refetch} title="Unable to load inventory." />}
            {loaded && !error && filtered.length === 0 && (
                <EmptyState title="No matching medicines." hint="Adjust your search or status filter." />
            )}

            {loaded && !error && filtered.length > 0 && (
                <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-x-auto">
                    <table className="w-full text-left text-xs text-slate-700">
                        <thead className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-600">
                            <tr>
                                <th className="py-3 px-4">Antibiotic</th>
                                <th className="py-3 px-4">Class / AWaRe</th>
                                <th className="py-3 px-4 text-right">Stock On-Hand</th>
                                <th className="py-3 px-4 text-right">Daily Use</th>
                                <th className="py-3 px-4 text-right">Days of Supply</th>
                                <th className="py-3 px-4">Primary Supplier</th>
                                <th className="py-3 px-4 text-right">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                            {filtered.map((item) => {
                                const meta = STATUS_META[item.status] ?? STATUS_META.unknown;
                                const dos = item.days_of_supply;
                                return (
                                    <tr key={item.antibiotic_id} className="hover:bg-slate-50/80 transition-colors">
                                        <td className="py-3 px-4 font-bold text-slate-900">{item.antibiotic_name}</td>
                                        <td className="py-3 px-4 text-slate-600">
                                            {item.drug_class || '—'}
                                            {item.aware_category && (
                                                <span className="ml-1.5 text-[10px] font-semibold text-slate-400">{item.aware_category}</span>
                                            )}
                                        </td>
                                        <td className="py-3 px-4 text-right font-mono font-medium">
                                            {fmt(item.quantity_on_hand)} {item.unit?.toLowerCase()}
                                        </td>
                                        <td className="py-3 px-4 text-right font-mono text-slate-600">{fmt(item.daily_consumption)}</td>
                                        <td className="py-3 px-4 text-right">
                                            <span
                                                className={`font-bold ${dos !== null && dos < 10 ? 'text-rose-700' : dos !== null && dos < 30 ? 'text-amber-700' : 'text-slate-800'}`}
                                            >
                                                {dos === null ? '—' : `${fmt(dos, 1)} d`}
                                            </span>
                                            {item.safety_target_days != null && (
                                                <span className="ml-1 text-[10px] text-slate-400">/ {fmt(item.safety_target_days, 0)}d target</span>
                                            )}
                                        </td>
                                        <td className="py-3 px-4 text-slate-600">{item.primary_supplier || '—'}</td>
                                        <td className="py-3 px-4 text-right">
                                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold border ${meta.cls}`}>
                                                <meta.Icon className="w-3 h-3" /> {meta.label}
                                            </span>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

function SummaryCard({
    label,
    value,
    hint,
    tone = 'slate',
}: {
    label: string;
    value: string;
    hint: string;
    tone?: 'slate' | 'amber' | 'rose' | 'emerald';
}) {
    const toneCls = {
        slate: 'border-slate-200',
        amber: 'border-amber-200 bg-amber-50/30',
        rose: 'border-rose-200 bg-rose-50/30',
        emerald: 'border-emerald-200 bg-emerald-50/30',
    }[tone];
    return (
        <div className={`p-4 bg-white rounded-lg border shadow-sm ${toneCls}`}>
            <p className="text-xs font-medium text-slate-500">{label}</p>
            <p className="text-2xl font-bold text-slate-900 mt-1">{value}</p>
            <p className="text-xs text-slate-500 mt-1">{hint}</p>
        </div>
    );
}
