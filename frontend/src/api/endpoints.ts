// Typed service functions, grouped by domain. Components/hooks call these —
// never `fetch` directly.

import { api, ApiError } from "./client";
import { getAuthHeaders } from "./auth";
import type {
  AllocationRow,
  AmrSurveillanceRow,
  Antibiotic,
  AuditEvent,
  BarcodeResult,
  DashboardSummary,
  DataQualityResult,
  Department,
  FailoverAlert,
  Hospital,
  InventoryItem,
  Prediction,
  PurchaseOrder,
  RegulatoryStatus,
  SupplyNode,
  SupplyTrace,
  TransactionResult,
  TrendPoint,
} from "./types";

export const DashboardApi = {
  summary: (signal?: AbortSignal) =>
    api.get<DashboardSummary>("/dashboard/summary", undefined, signal).then((r) => r.data),
  predictions: (
    params: { threshold?: number; hospital_id?: string; limit?: number } = {},
    signal?: AbortSignal,
  ) => api.get<Prediction[]>("/predictions", params, signal).then((r) => r.data),
  trends: (hospital_id: string, antibiotic_id: string, months = 12, signal?: AbortSignal) =>
    api.get<TrendPoint[]>("/trends", { hospital_id, antibiotic_id, months }, signal).then((r) => r.data),
  amrSurveillance: (signal?: AbortSignal) =>
    api.get<AmrSurveillanceRow[]>("/amr/surveillance", undefined, signal).then((r) => r.data),
};

export const CatalogApi = {
  hospitals: (search?: string, signal?: AbortSignal) =>
    api.get<Hospital[]>("/hospitals", { search }, signal).then((r) => r.data),
  antibiotics: (signal?: AbortSignal) =>
    api.get<Antibiotic[]>("/antibiotics", undefined, signal).then((r) => r.data),
};

export const InventoryApi = {
  list: (
    params: { hospital_id?: string; antibiotic_id?: string; status?: string } = {},
    signal?: AbortSignal,
  ) => api.get<InventoryItem[]>("/inventory", params, signal).then((r) => r.data),
  item: (antibioticId: string, hospitalId = "H001", signal?: AbortSignal) =>
    api.get<InventoryItem>(`/inventory/${encodeURIComponent(antibioticId)}`, { hospital_id: hospitalId }, signal).then((r) => r.data),
  barcode: (barcode: string, hospitalId = "H001", signal?: AbortSignal) =>
    api.get<BarcodeResult>(`/inventory/barcode/${encodeURIComponent(barcode)}`, { hospital_id: hospitalId }, signal).then((r) => r.data),
  regulatoryStatus: (antibioticId: string, quantity = 1, signal?: AbortSignal) =>
    api.get<RegulatoryStatus>(`/inventory/${encodeURIComponent(antibioticId)}/regulatory-status`, { quantity }, signal).then((r) => r.data),
  issue: (payload: {
    antibiotic_id: string;
    quantity: number;
    department_code?: string;
    allocation_id?: string;
    batch_number?: string;
    barcode?: string;
    unit?: string;
    notes?: string;
    event_id?: string;
    has_documentation?: boolean;
    has_approval?: boolean;
  }) => api.post<TransactionResult>("/inventory/transactions", payload).then((r) => r.data),
};

export const DepartmentApi = {
  list: (hospitalId = "H001", signal?: AbortSignal) =>
    api.get<Department[]>("/departments", { hospital_id: hospitalId }, signal).then((r) => r.data),
  allocationSummary: (hospitalId = "H001", signal?: AbortSignal) =>
    api.get<AllocationRow[]>("/departments/allocations/summary", { hospital_id: hospitalId }, signal).then((r) => r.data),
  inventory: (departmentId: string, signal?: AbortSignal) =>
    api.get<AllocationRow[]>(`/departments/${encodeURIComponent(departmentId)}/inventory`, undefined, signal).then((r) => r.data),
};

export const AllocationApi = {
  list: (
    params: { hospital_id?: string; antibiotic_id?: string; department_code?: string } = {},
    signal?: AbortSignal,
  ) => api.get<AllocationRow[]>("/department-allocations", params, signal).then((r) => r.data),
  create: (payload: {
    department_id: string;
    antibiotic_id: string;
    allocated_quantity: number;
    demand_forecast_30d?: number;
    reorder_threshold?: number;
    allocation_period_start?: string;
    allocation_period_end?: string;
    unit?: string;
  }) => api.post<{ allocation_id: string; message: string }>("/department-allocations", payload).then((r) => r.data),
};

export const SupplyChainApi = {
  nodes: (signal?: AbortSignal) =>
    api.get<SupplyNode[]>("/supply-chain/nodes", undefined, signal).then((r) => r.data),
  trace: (hospitalId = "H001", antibioticId = "ANT-MERO", signal?: AbortSignal) =>
    api.get<SupplyTrace>("/supply-chain/trace", { hospital_id: hospitalId, antibiotic_id: antibioticId }, signal).then((r) => r.data),
  failoverAlerts: (hospitalId?: string, signal?: AbortSignal) =>
    api.get<FailoverAlert[]>("/supply-chain/failover-alerts", { hospital_id: hospitalId }, signal).then((r) => r.data),
  purchaseOrders: (hospitalId?: string, signal?: AbortSignal) =>
    api.get<PurchaseOrder[]>("/supply-chain/purchase-orders", { hospital_id: hospitalId }, signal).then((r) => r.data),
};

export interface AuthUserDto {
  userId: string;
  username: string;
  name: string;
  role: string;
  roleLabel: string;
  departmentCode: string;
  hospitalId: string;
}

export interface StaffUser {
  userId: string;
  username: string;
  fullName: string;
  role: string;
  roleLabel: string;
  departmentCode: string | null;
  hospitalId: string;
  isActive: boolean;
  createdAt: string | null;
}
export interface RoleOption { value: string; label: string; }

export const AuthApi = {
  login: (username: string, password: string) =>
    api.post<{ token: string; expiresAt: number; user: AuthUserDto }>("/auth/login", { username, password }).then((r) => r.data),
  me: (signal?: AbortSignal) => api.get<AuthUserDto>("/auth/me", undefined, signal).then((r) => r.data),

  changePassword: (current_password: string, new_password: string) =>
    api.post<{ changed: boolean }>("/auth/change-password", { current_password, new_password }).then((r) => r.data),

  roles: (signal?: AbortSignal) =>
    api.get<RoleOption[]>("/auth/roles", undefined, signal).then((r) => r.data),
  listUsers: (signal?: AbortSignal) =>
    api.get<StaffUser[]>("/auth/users", undefined, signal).then((r) => r.data),
  createUser: (body: {
    username: string; full_name: string; role: string; password: string;
    department_code?: string | null; hospital_id?: string;
  }) => api.post<StaffUser>("/auth/users", body).then((r) => r.data),
  updateUser: (
    userId: string,
    body: Partial<{ full_name: string; role: string; department_code: string | null; is_active: boolean; new_password: string }>,
  ) => api.patch<StaffUser>(`/auth/users/${encodeURIComponent(userId)}`, body).then((r) => r.data),
};

export interface RecommendationItem {
  id: string;
  category: string;
  severity: "CRITICAL" | "HIGH" | "MODERATE" | "LOW";
  title: string;
  detail: string;
  recommended_action: string;
  antibiotic_id: string;
}

export const RecommendationApi = {
  list: (hospitalId = "H001", signal?: AbortSignal) =>
    api.get<RecommendationItem[]>("/recommendations", { hospital_id: hospitalId }, signal).then((r) => r.data),
};

export interface ScenarioPreset {
  id: string;
  name: string;
  demand_surge_pct: number;
  lead_time_delay_days: number;
}

export interface ScenarioResult {
  inputs: Record<string, unknown>;
  as_of: string;
  unit: string;
  current_stock: number;
  baseline: { daily_consumption: number; days_to_depletion: number; replenishment_lead_time_days: number };
  scenario: {
    daily_consumption: number;
    days_to_depletion: number;
    replenishment_lead_time_days: number;
    coverage_gap_days: number;
    risk_level: string;
    recommended_buffer_order: number;
  };
  suppliers: { supplier_id: string; supplier_name: string; lead_time_days: number; allocation_share: number; is_primary_supplier: boolean }[];
  disabled_supplier_id: string | null;
  note: string;
}

export const ScenarioApi = {
  presets: (signal?: AbortSignal) =>
    api.get<ScenarioPreset[]>("/scenarios/presets", undefined, signal).then((r) => r.data),
  simulate: (payload: {
    hospital_id?: string;
    antibiotic_id: string;
    demand_surge_pct: number;
    lead_time_delay_days: number;
    disabled_supplier_id?: string | null;
  }) => api.post<ScenarioResult>("/scenarios/simulate", payload).then((r) => r.data),
};

// ---- Module 4: AMR isolate explorer ----
export interface AmrFilters {
  regions: string[];
  pathogens: string[];
  antibiotics: string[];
  specimens: string[];
  infection_types: string[];
}
export interface AmrMatrixCell {
  pathogen: string;
  antibiotic: string;
  n: number;
  resistance_pct: number | null;
}
export interface AmrTrendPoint {
  month: string;
  isolates_tested: number;
  resistance_pct: number | null;
  mic90: number | null;
}

export const AmrExplorerApi = {
  filters: (s?: AbortSignal) => api.get<AmrFilters>("/amr/isolates/filters", undefined, s).then((r) => r.data),
  summary: (p: Record<string, string | undefined>, s?: AbortSignal) =>
    api.get<any>("/amr/isolates/summary", p, s).then((r) => r.data),
  matrix: (p: { region?: string; specimen?: string }, s?: AbortSignal) =>
    api.get<AmrMatrixCell[]>("/amr/isolates/matrix", p, s).then((r) => r.data),
  trend: (pathogen: string, antibiotic: string, region?: string, s?: AbortSignal) =>
    api.get<AmrTrendPoint[]>("/amr/isolates/trend", { pathogen, antibiotic, region }, s).then((r) => r.data),
};

// ---- Modules 1 & 2: ingestion ----
export interface GlassRun {
  run_id: string;
  run_type: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  query_params: string;
  files_downloaded: number;
  rows_ingested: number;
  rows_deduplicated: number;
  dataset_version: string;
  error: string | null;
  triggered_by: string;
  raw_object_uris: string | null;
}
export interface HospitalBatch {
  batch_id: string;
  source: string;
  hospital_id: string | null;
  received_at: string;
  object_uri: string | null;
  record_count: number;
  accepted_count: number;
  rejected_count: number;
  pii_fields_removed: string[] | string;
  status: string;
  error: string | null;
  submitted_by: string;
}

export const IngestionApi = {
  glassRun: (payload: { region?: string; infection_type?: string; pathogen?: string; antibiotic?: string; scrape: boolean }) =>
    api.post<{ status: string; message: string }>("/ingestion/glass/run", payload).then((r) => r.data),
  glassRuns: (s?: AbortSignal) => api.get<GlassRun[]>("/ingestion/glass/runs", { limit: 30 }, s).then((r) => r.data),
  hospitalBatches: (s?: AbortSignal) =>
    api.get<HospitalBatch[]>("/ingestion/hospital/batches", { limit: 50 }, s).then((r) => r.data),
  pushRecords: (records: unknown[], hospitalId?: string) =>
    api.post<any>("/ingestion/hospital/records", records, { hospital_id: hospitalId }).then((r) => r.data),
  processDrops: () => api.post<any>("/ingestion/hospital/process-drops").then((r) => r.data),
};

// ---- Module 3: vendor documents ----
export interface VendorDoc {
  document_id: string;
  vendor_name: string | null;
  doc_type: string;
  status: "pending" | "validated" | "approved" | "rejected";
  invoice_amount: number | null;
  currency: string | null;
  contract_expiration: string | null;
  extraction_method: string;
  original_filename: string | null;
  size_bytes: number | null;
  uploaded_by: string;
  uploaded_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
}
export interface VendorDocDetail {
  document: VendorDoc & {
    object_uri: string;
    line_items: any[];
    extracted_metadata: Record<string, any>;
    review_notes: string | null;
    allowed_actions: string[];
  };
  events: {
    event_id: string;
    event_type: string;
    actor_id: string;
    actor_role: string;
    from_status: string | null;
    to_status: string | null;
    notes: string | null;
    event_timestamp: string;
  }[];
  download_url: string;
}

export const VendorApi = {
  list: (status?: string, s?: AbortSignal) =>
    api.get<VendorDoc[]>("/vendor/documents", { status }, s).then((r) => r.data),
  get: (id: string, s?: AbortSignal) =>
    api.get<VendorDocDetail>(`/vendor/documents/${encodeURIComponent(id)}`, undefined, s).then((r) => r.data),
  upload: async (file: File, docType: string, vendorName?: string) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("doc_type", docType);
    if (vendorName) fd.append("vendor_name", vendorName);
    const base = (import.meta as any).env?.VITE_API_BASE_URL?.replace(/\/$/, "") || "/api/v1";
    const res = await fetch(`${base}/vendor/documents`, { method: "POST", headers: getAuthHeaders(), body: fd });
    const j = await res.json().catch(() => null);
    if (!res.ok || !j || j.success === false) {
      throw new ApiError(
        j?.error?.code || "UPLOAD_FAILED", j?.error?.message || "Upload failed.", res.status, j?.error?.requestId,
      );
    }
    return j.data;
  },
  transition: (id: string, action: string, notes?: string) =>
    api.post<{ status: string }>(`/vendor/documents/${encodeURIComponent(id)}/transition`, { action, notes }).then((r) => r.data),
};

export const GovernanceApi = {
  auditEvents: (params: { limit?: number; event_type?: string; entity_id?: string } = {}, signal?: AbortSignal) =>
    api.get<AuditEvent[]>("/governance/audit-events", params, signal).then((r) => r.data),
  dataQuality: (signal?: AbortSignal) =>
    api.get<DataQualityResult[]>("/governance/data-quality", undefined, signal).then((r) => r.data),
  runDataQuality: () => api.post<DataQualityResult[]>("/governance/data-quality/run").then((r) => r.data),
};
