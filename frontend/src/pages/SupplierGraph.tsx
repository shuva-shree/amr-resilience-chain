import React, { useMemo, useState } from 'react';
import { GitFork, AlertOctagon, RefreshCw, ArrowRight } from 'lucide-react';
import { useAntibiotics } from '../hooks/data';
import { useSupplyTrace, useFailoverAlerts } from '../hooks/data';
import { ErrorState, LoadingRows, EmptyState } from '../components/States';
import type { SupplyEdge } from '../api/types';

const TIER_LABEL: Record<string, string> = {
    API_SUPPLIER: 'API Synthesis',
    MANUFACTURER: 'Manufacturing',
    DISTRIBUTOR: 'Distribution',
    HOSPITAL: 'Hospital',
};

export default function SupplierGraph() {
    const { data: antibiotics } = useAntibiotics();
    const [antibioticId, setAntibioticId] = useState('ANT-MERO');
    const trace = useSupplyTrace('H001', antibioticId);
    const failover = useFailoverAlerts('H001');

    const edges: SupplyEdge[] = trace.data?.edges ?? [];

    // Single-point-of-failure: any single source supplying >70% share at any tier.
    const spof = useMemo(
        () => edges.filter((e) => e.supply_share_pct >= 0.7).sort((a, b) => b.supply_share_pct - a.supply_share_pct),
        [edges],
    );

    const byDepth = useMemo(() => {
        const groups = new Map<number, SupplyEdge[]>();
        for (const e of edges) {
            const arr = groups.get(e.depth) ?? [];
            arr.push(e);
            groups.set(e.depth, arr);
        }
        return [...groups.entries()].sort((a, b) => b[0] - a[0]); // upstream first
    }, [edges]);

    return (
        <div className="space-y-6 max-w-7xl mx-auto">
            <div className="flex justify-between items-start">
                <div>
                    <h2 className="text-xl font-bold text-slate-900">Multi-Tier Supply Chain Dependency Explorer</h2>
                    <p className="text-sm text-slate-500">
                        Upstream supply path — distributors, manufacturers and active-ingredient suppliers — for a selected antibiotic.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <select
                        value={antibioticId}
                        onChange={(e) => setAntibioticId(e.target.value)}
                        className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-md bg-white font-medium text-slate-700"
                    >
                        {(antibiotics ?? [{ antibiotic_id: 'ANT-MERO', antibiotic_name: 'Meropenem' }]).map((a) => (
                            <option key={a.antibiotic_id} value={a.antibiotic_id}>
                                {a.antibiotic_name}
                            </option>
                        ))}
                    </select>
                    <button
                        onClick={trace.refetch}
                        className="p-2 border border-slate-300 rounded-md hover:bg-slate-100"
                        aria-label="Refresh"
                    >
                        <RefreshCw className={`w-4 h-4 text-slate-600 ${trace.loading ? 'animate-spin' : ''}`} />
                    </button>
                </div>
            </div>

            {!trace.loaded && trace.loading && <LoadingRows rows={4} label="Tracing supply chain…" />}
            {trace.error && <ErrorState error={trace.error} onRetry={trace.refetch} title="Unable to trace the supply chain." />}
            {trace.loaded && !trace.error && edges.length === 0 && (
                <EmptyState title="No supply-chain data for this antibiotic." hint="Try a different medicine." />
            )}

            {spof.length > 0 && (
                <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-3">
                    <AlertOctagon className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
                    <div className="text-xs text-amber-900 space-y-1">
                        <p className="font-bold">Single-point-of-failure concentration detected</p>
                        {spof.map((e, i) => (
                            <p key={i}>
                                {(e.supply_share_pct * 100).toFixed(0)}% of{' '}
                                <strong>{e.target_node_name || e.target_node_id}</strong>’s supply for this antibiotic depends on a
                                single source: <strong>{e.source_node_name || e.source_node_id}</strong> (cumulative lead time{' '}
                                {e.total_lead_time} days).
                            </p>
                        ))}
                    </div>
                </div>
            )}

            {trace.loaded && !trace.error && edges.length > 0 && (
                <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-6 space-y-4">
                    <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Upstream Path</h3>
                    <div className="space-y-3">
                        {byDepth.map(([depth, group]) => (
                            <div key={depth} className="flex items-center gap-3 flex-wrap">
                                <span className="text-[10px] font-bold text-slate-400 uppercase w-16 shrink-0">Tier {depth}</span>
                                {group.map((e, i) => (
                                    <div
                                        key={i}
                                        className={`p-3 rounded-lg border text-xs space-y-1 ${
                                            e.supply_share_pct >= 0.7 ? 'border-amber-300 bg-amber-50/40' : 'border-slate-200 bg-slate-50'
                                        }`}
                                    >
                                        <div className="flex items-center gap-1.5 font-bold text-slate-900">
                                            {e.source_node_name || e.source_node_id}
                                            <ArrowRight className="w-3 h-3 text-slate-400" />
                                            {e.target_node_name || e.target_node_id}
                                        </div>
                                        <p className="text-slate-500">
                                            {TIER_LABEL[e.source_node_type ?? ''] || e.source_node_type} ·{' '}
                                            {(e.supply_share_pct * 100).toFixed(0)}% share · +{e.total_lead_time}d lead time
                                        </p>
                                    </div>
                                ))}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-5 space-y-3">
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Pre-Approved Failover Suppliers</h3>
                {!failover.loaded && failover.loading && <LoadingRows rows={2} label="Loading failover options…" />}
                {failover.error && <ErrorState error={failover.error} onRetry={failover.refetch} title="Unable to load failover suppliers." />}
                {failover.loaded && !failover.error && (failover.data ?? []).length === 0 && (
                    <EmptyState title="No failover suppliers configured." />
                )}
                {failover.loaded && !failover.error && (failover.data ?? []).length > 0 && (
                    <table className="w-full text-left text-xs">
                        <thead className="bg-slate-50 font-semibold text-slate-600 border-b border-slate-200">
                            <tr>
                                <th className="py-2.5 px-3">Supplier</th>
                                <th className="py-2.5 px-3">Antibiotic</th>
                                <th className="py-2.5 px-3 text-right">Lead Time</th>
                                <th className="py-2.5 px-3 text-right">Min Order</th>
                                <th className="py-2.5 px-3 text-right">Recommended Order</th>
                                <th className="py-2.5 px-3 text-center">Current Stockout</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                            {(failover.data ?? []).map((f, i) => (
                                <tr key={i}>
                                    <td className="py-3 px-3 font-bold text-slate-900">{f.failover_supplier}</td>
                                    <td className="py-3 px-3 text-slate-600">{f.antibiotic_name || f.antibiotic_id}</td>
                                    <td className="py-3 px-3 text-right text-slate-700">{f.lead_time_days} d</td>
                                    <td className="py-3 px-3 text-right text-slate-700">{f.minimum_order_quantity.toLocaleString()}</td>
                                    <td className="py-3 px-3 text-right font-semibold">{Math.round(f.recommended_order_vials).toLocaleString()}</td>
                                    <td className="py-3 px-3 text-center">
                                        <span
                                            className={`px-2 py-0.5 rounded font-medium ${
                                                f.stockout_flag ? 'bg-rose-50 text-rose-800 border border-rose-200' : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                            }`}
                                        >
                                            {f.stockout_flag ? 'At risk' : 'Covered'}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}
