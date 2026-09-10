import React, { useMemo, useState } from 'react';
import { Building2, RefreshCw } from 'lucide-react';
import { useAllocationSummary, useDepartments } from '../hooks/data';
import { ErrorState, LoadingRows, EmptyState } from '../components/States';
import type { AllocationRow } from '../api/types';

const RISK_CLS: Record<string, string> = {
    CRITICAL: 'bg-rose-100 text-rose-800',
    HIGH: 'bg-amber-100 text-amber-800',
    MEDIUM: 'bg-sky-100 text-sky-800',
    LOW: 'bg-slate-100 text-slate-700',
};

function num(n: number | null | undefined, digits = 0) {
    return n === null || n === undefined || Number.isNaN(n)
        ? '—'
        : n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

export default function DepartmentAllocation() {
    const { data, loading, loaded, error, refetch } = useAllocationSummary('H001');
    const { data: departments } = useDepartments('H001');
    const [filterDept, setFilterDept] = useState<string>('ALL');

    const rows: AllocationRow[] = data ?? [];
    const deptCodes = useMemo(
        () => ['ALL', ...Array.from(new Set((departments ?? []).map((d) => d.department_code)))],
        [departments],
    );
    const filtered = filterDept === 'ALL' ? rows : rows.filter((d) => d.department_code === filterDept);

    return (
        <div className="max-w-7xl mx-auto space-y-6">
            <div className="flex justify-between items-center border-b border-slate-200 pb-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                        <Building2 className="w-7 h-7 text-sky-700" />
                        Department Allocation & Demand Coverage
                    </h1>
                    <p className="text-sm text-slate-500 mt-1">
                        Cross-department stock allocation, consumption, and 30-day forecast coverage.
                    </p>
                </div>
                <button
                    onClick={refetch}
                    className="p-2 border border-slate-300 rounded-lg hover:bg-slate-100 transition-colors"
                    aria-label="Refresh"
                >
                    <RefreshCw className={`w-4 h-4 text-slate-600 ${loading ? 'animate-spin' : ''}`} />
                </button>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-semibold text-slate-500">Filter department:</span>
                {deptCodes.map((code) => (
                    <button
                        key={code}
                        onClick={() => setFilterDept(code)}
                        className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                            filterDept === code ? 'bg-sky-700 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                        }`}
                    >
                        {code}
                    </button>
                ))}
            </div>

            {!loaded && loading && <LoadingRows rows={6} label="Loading department allocations…" />}
            {error && <ErrorState error={error} onRetry={refetch} title="Unable to load department allocations." />}
            {loaded && !error && filtered.length === 0 && (
                <EmptyState title="No allocations found for this department." />
            )}

            {loaded && !error && filtered.length > 0 && (
                <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto shadow-sm">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                            <tr>
                                <th className="p-3.5">Medicine</th>
                                <th className="p-3.5">Department</th>
                                <th className="p-3.5 text-right">Allocated</th>
                                <th className="p-3.5 text-right">Consumed</th>
                                <th className="p-3.5 text-right">Available</th>
                                <th className="p-3.5 text-right">30-Day Demand</th>
                                <th className="p-3.5 text-center">Coverage</th>
                                <th className="p-3.5 text-center">Risk</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 text-slate-800">
                            {filtered.map((row) => {
                                const cov = row.calculated_coverage_days;
                                return (
                                    <tr key={row.allocation_id} className="hover:bg-slate-50/60">
                                        <td className="p-3.5 font-medium">
                                            {row.antibiotic_name || row.antibiotic_id}
                                            {row.aware_category && (
                                                <span className="block text-xs font-normal text-slate-400">{row.aware_category}</span>
                                            )}
                                        </td>
                                        <td className="p-3.5">
                                            {row.department_name} <span className="text-slate-400">({row.department_code})</span>
                                        </td>
                                        <td className="p-3.5 text-right">{num(row.allocated_quantity)}</td>
                                        <td className="p-3.5 text-right">{num(row.consumed_quantity)}</td>
                                        <td className="p-3.5 text-right font-semibold">{num(row.available_quantity)}</td>
                                        <td className="p-3.5 text-right text-slate-500">{num(row.demand_forecast_30d)}</td>
                                        <td className="p-3.5 text-center">
                                            <span
                                                className={`px-2 py-0.5 rounded font-mono text-xs font-semibold ${
                                                    cov == null
                                                        ? 'bg-slate-100 text-slate-500'
                                                        : cov < 15
                                                        ? 'bg-rose-100 text-rose-800'
                                                        : cov < 25
                                                        ? 'bg-amber-100 text-amber-800'
                                                        : 'bg-emerald-100 text-emerald-800'
                                                }`}
                                            >
                                                {cov == null ? '—' : `${num(cov, 1)} d`}
                                            </span>
                                        </td>
                                        <td className="p-3.5 text-center">
                                            <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${RISK_CLS[row.risk_level] ?? RISK_CLS.LOW}`}>
                                                {row.risk_level}
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
