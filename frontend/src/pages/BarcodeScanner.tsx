import React, { useState, useEffect, useRef } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { QrCode, Camera, Upload, Search, RefreshCw, AlertCircle, CheckCircle2, ShieldAlert } from 'lucide-react';
import { InventoryApi } from '../api/endpoints';
import { ApiError } from '../api/client';
import type { BarcodeResult, RegulatoryStatus } from '../api/types';

const RESTRICTION_CLS: Record<string, string> = {
    unrestricted: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    restricted: 'bg-amber-50 text-amber-800 border-amber-200',
    controlled: 'bg-orange-50 text-orange-800 border-orange-200',
    reserve: 'bg-rose-50 text-rose-800 border-rose-200',
};

export default function BarcodeScanner() {
    const [scanResult, setScanResult] = useState<string>('');
    const [isCameraActive, setIsCameraActive] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');

    const [status, setStatus] = useState<'idle' | 'searching' | 'found' | 'notfound' | 'error'>('idle');
    const [item, setItem] = useState<BarcodeResult | null>(null);
    const [regulatory, setRegulatory] = useState<RegulatoryStatus | null>(null);
    const [lookupError, setLookupError] = useState<string>('');

    const html5QrcodeInstance = useRef<Html5Qrcode | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    const formatsToSupport = [
        Html5QrcodeSupportedFormats.QR_CODE,
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.UPC_A,
        Html5QrcodeSupportedFormats.UPC_E,
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.CODE_39,
    ];

    const startCamera = async () => {
        setErrorMessage('');
        setIsCameraActive(true);
        try {
            if (!html5QrcodeInstance.current) html5QrcodeInstance.current = new Html5Qrcode('reader');
            await html5QrcodeInstance.current.start(
                { facingMode: 'environment' },
                { fps: 10, qrbox: { width: 280, height: 160 }, formatsToSupport },
                (decodedText: string) => {
                    handleScanSuccess(decodedText);
                    stopCamera();
                },
                () => {},
            );
        } catch {
            setErrorMessage('Camera access failed. Ensure permissions are granted.');
            setIsCameraActive(false);
        }
    };

    const stopCamera = async () => {
        if (html5QrcodeInstance.current?.isScanning) {
            try {
                await html5QrcodeInstance.current.stop();
            } catch {
                /* ignore */
            }
        }
        setIsCameraActive(false);
    };

    const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        setErrorMessage('');
        try {
            const scanner = new Html5Qrcode('reader');
            const decodedText = await scanner.scanFile(file, true);
            handleScanSuccess(decodedText);
            scanner.clear();
        } catch {
            setErrorMessage('Could not detect a valid barcode in the uploaded image.');
        }
    };

    const handleScanSuccess = (code: string) => {
        setScanResult(code);
        void performLookup(code);
    };

    const performLookup = async (code: string) => {
        setStatus('searching');
        setItem(null);
        setRegulatory(null);
        setLookupError('');
        try {
            const result = await InventoryApi.barcode(code);
            setItem(result);
            setStatus('found');
            try {
                const reg = await InventoryApi.regulatoryStatus(result.antibiotic_id, 1);
                setRegulatory(reg);
            } catch {
                /* regulatory status is supplementary */
            }
        } catch (e) {
            if (e instanceof ApiError && e.code === 'MEDICINE_NOT_FOUND') {
                setStatus('notfound');
            } else {
                setStatus('error');
                setLookupError(e instanceof ApiError ? e.message : 'Lookup failed. Please try again.');
            }
        }
    };

    useEffect(
        () => () => {
            if (html5QrcodeInstance.current?.isScanning) html5QrcodeInstance.current.stop().catch(() => {});
        },
        [],
    );

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm">
                <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                    <QrCode className="w-5 h-5 text-sky-600" /> Barcode Identification
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                    Scan or upload a medicine barcode to identify the product, check stock and see its regulatory status.
                    Identification does not authorize an issue.
                </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm flex flex-col">
                    <h3 className="text-sm font-semibold text-slate-800 mb-4">Capture Input</h3>
                    <div className="relative bg-slate-900 rounded-lg overflow-hidden h-64 flex items-center justify-center border border-slate-300">
                        <div id="reader" className="w-full h-full object-cover" />
                        {!isCameraActive && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400 bg-slate-950/80 p-4 text-center">
                                <QrCode className="w-12 h-12 mb-2 text-slate-500" />
                                <p className="text-xs font-medium">Camera preview inactive</p>
                                <p className="text-[11px] text-slate-500 mt-1">Start camera or upload an image to scan</p>
                            </div>
                        )}
                    </div>

                    {errorMessage && (
                        <div className="mt-3 p-3 bg-rose-50 border border-rose-200 rounded-md flex items-center gap-2 text-xs text-rose-700">
                            <AlertCircle className="w-4 h-4 shrink-0" />
                            <span>{errorMessage}</span>
                        </div>
                    )}

                    <div className="mt-4 grid grid-cols-2 gap-3">
                        {!isCameraActive ? (
                            <button
                                onClick={startCamera}
                                className="flex items-center justify-center gap-2 px-4 py-2.5 bg-sky-600 hover:bg-sky-700 text-white rounded-md text-xs font-medium"
                            >
                                <Camera className="w-4 h-4" /> Start Camera
                            </button>
                        ) : (
                            <button
                                onClick={stopCamera}
                                className="flex items-center justify-center gap-2 px-4 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-md text-xs font-medium"
                            >
                                <RefreshCw className="w-4 h-4 animate-spin" /> Stop Camera
                            </button>
                        )}
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md text-xs font-medium border border-slate-300"
                        >
                            <Upload className="w-4 h-4" /> Upload Image
                        </button>
                        <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept="image/*" className="hidden" />
                    </div>

                    <div className="mt-4">
                        <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Or enter manually</label>
                        <form
                            onSubmit={(e) => {
                                e.preventDefault();
                                const v = new FormData(e.currentTarget).get('code') as string;
                                if (v?.trim()) handleScanSuccess(v.trim());
                            }}
                            className="mt-1 flex gap-2"
                        >
                            <input
                                name="code"
                                placeholder="Barcode value"
                                className="flex-1 px-3 py-1.5 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-sky-500"
                            />
                            <button className="px-3 py-1.5 bg-slate-800 text-white rounded-md text-xs font-medium">Look up</button>
                        </form>
                    </div>
                </div>

                <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm flex flex-col">
                    <h3 className="text-sm font-semibold text-slate-800 mb-4">Result</h3>

                    {scanResult && (
                        <div className="p-3 bg-slate-50 rounded-md border border-slate-200 mb-4">
                            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">Scanned code</span>
                            <span className="font-mono text-sm font-bold text-slate-800 break-all">{scanResult}</span>
                        </div>
                    )}

                    {status === 'idle' && (
                        <div className="flex-1 flex flex-col items-center justify-center text-slate-400 p-6 border-2 border-dashed border-slate-200 rounded-lg">
                            <Search className="w-8 h-8 text-slate-300 mb-2" />
                            <p className="text-xs font-medium text-slate-600">No barcode scanned yet</p>
                        </div>
                    )}

                    {status === 'searching' && (
                        <div className="flex items-center gap-2 text-xs text-sky-700 bg-sky-50 p-3 rounded border border-sky-200">
                            <RefreshCw className="w-4 h-4 animate-spin" /> Looking up medicine catalog…
                        </div>
                    )}

                    {status === 'notfound' && (
                        <div className="p-4 bg-amber-50 border border-amber-200 rounded-md text-xs text-amber-900 space-y-2">
                            <p className="font-semibold">Medicine not found</p>
                            <p>This barcode is not registered in the active medicine catalog.</p>
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                className="mt-1 px-2.5 py-1 rounded border border-amber-300 bg-white font-medium"
                            >
                                Search manually
                            </button>
                        </div>
                    )}

                    {status === 'error' && (
                        <div className="p-4 bg-rose-50 border border-rose-200 rounded-md text-xs text-rose-800">
                            <p className="font-semibold">Unable to complete the lookup.</p>
                            <p>{lookupError}</p>
                        </div>
                    )}

                    {status === 'found' && item && (
                        <div className="space-y-3 flex-1 text-xs">
                            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-md space-y-1">
                                <div className="flex items-center gap-2 text-emerald-800 font-semibold">
                                    <CheckCircle2 className="w-4 h-4 text-emerald-600" /> Identified
                                </div>
                                <p className="text-slate-800 font-bold text-sm">{item.product_name || item.antibiotic_name}</p>
                                <p className="text-slate-600">
                                    {item.antibiotic_name}
                                    {item.strength ? ` · ${item.strength}` : ''}
                                    {item.dosage_form ? ` · ${item.dosage_form}` : ''}
                                </p>
                                <p className="text-slate-500">
                                    {item.manufacturer_name}
                                    {item.aware_category ? ` · AWaRe: ${item.aware_category}` : ''}
                                </p>
                            </div>

                            <div className="grid grid-cols-2 gap-2">
                                <Stat label="Hospital stock" value={`${(item.total_hospital_stock ?? 0).toLocaleString()} ${item.inventory?.unit?.toLowerCase() ?? ''}`} />
                                <Stat label="Days of supply" value={item.inventory?.days_of_supply != null ? `${item.inventory.days_of_supply.toFixed(1)} d` : '—'} />
                            </div>

                            {item.department_allocations.length > 0 && (
                                <div className="border border-slate-200 rounded-md overflow-hidden">
                                    <table className="w-full">
                                        <thead className="bg-slate-50 text-slate-500">
                                            <tr>
                                                <th className="text-left p-2">Department</th>
                                                <th className="text-right p-2">Available</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                            {item.department_allocations.map((a) => (
                                                <tr key={a.allocation_id}>
                                                    <td className="p-2">{a.department_name} ({a.department_code})</td>
                                                    <td className="p-2 text-right font-mono">{a.available_quantity.toLocaleString()}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}

                            <div
                                className={`p-3 rounded-md border ${RESTRICTION_CLS[item.restriction_level ?? 'unrestricted'] ?? RESTRICTION_CLS.unrestricted}`}
                            >
                                <div className="flex items-center gap-1.5 font-semibold">
                                    <ShieldAlert className="w-3.5 h-3.5" />
                                    {(item.restriction_level ?? 'unrestricted').replace(/^\w/, (c) => c.toUpperCase())} medicine
                                </div>
                                {regulatory && (
                                    <ul className="mt-1 list-disc list-inside space-y-0.5">
                                        {regulatory.reasons.map((r, i) => (
                                            <li key={i}>{r}</li>
                                        ))}
                                    </ul>
                                )}
                                {regulatory?.decision === 'APPROVAL_REQUIRED' && (
                                    <p className="mt-2 font-medium">
                                        Additional authorization required. Raise an approval request before issuing this medicine.
                                    </p>
                                )}
                                {regulatory?.decision === 'BLOCKED' && (
                                    <p className="mt-2 font-medium">
                                        Issue is not permitted for your role / department under the active policy.
                                    </p>
                                )}
                            </div>
                            <p className="text-[11px] text-slate-400">
                                Identification only. To issue this medicine use the inventory transaction workflow, where the
                                policy decision is enforced server-side.
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

function Stat({ label, value }: { label: string; value: string }) {
    return (
        <div className="p-2.5 bg-slate-50 rounded border border-slate-200">
            <span className="text-[10px] text-slate-500 uppercase tracking-wider block">{label}</span>
            <span className="font-bold text-slate-800">{value}</span>
        </div>
    );
}
