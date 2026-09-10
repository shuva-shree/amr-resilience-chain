// Shared API types — mirror the backend DTOs. Domain field names are preserved
// exactly as the backend returns them; view components map to display labels.

export interface DashboardSummary {
  total_hospitals: number;
  tracked_antibiotics: number;
  critical_risk_hospitals: number;
  moderate_risk_hospitals: number;
  avg_stockout_risk_pct: number;
}

export interface Hospital {
  hospital_id: string;
  hospital_name: string;
  city: string;
  state?: string;
  country?: string;
  facility_type?: string;
  bed_capacity?: number;
}

export interface Antibiotic {
  antibiotic_id: string;
  antibiotic_name: string;
  atc_code?: string;
  drug_class?: string;
  aware_category?: string;
  defined_daily_dose_g?: number;
  route_of_admin?: string;
}

export interface Prediction {
  hospital_id: string;
  hospital_name?: string;
  antibiotic_id: string;
  antibiotic_name?: string;
  stockout_probability_30d: number;
  predicted_days_remaining: number | null;
  risk_category: "CRITICAL" | "HIGH" | "MODERATE" | "LOW";
  last_updated?: string;
}

export interface TrendPoint {
  snapshot_date: string;
  stockout_probability: number;
  inventory_units_on_hand: number;
  consumption_rate_daily: number;
  resistance_pct?: number;
  usage_ddd_rate?: number;
}

export interface AmrSurveillanceRow {
  antibiotic_id: string;
  antibiotic_name: string;
  drug_class?: string;
  aware_category?: string;
  primary_pathogen?: string | null;
  resistance_pct?: number | null;
  usage_ddd_rate?: number | null;
  resistance_change?: number | null;
  as_of_date?: string | null;
}

export interface InventoryItem {
  hospital_id: string;
  antibiotic_id: string;
  antibiotic_name: string;
  drug_class?: string;
  aware_category?: string;
  quantity_on_hand: number;
  unit: string;
  daily_consumption: number;
  reorder_point?: number;
  safety_stock?: number;
  as_of_date?: string;
  days_of_supply: number | null;
  safety_target_days: number | null;
  primary_supplier?: string | null;
  status: "critical" | "warning" | "optimal" | "unknown";
  department_allocations?: AllocationRow[];
}

export interface AllocationRow {
  allocation_id: string;
  hospital_id: string;
  department_id: string;
  department_code: string;
  department_name: string;
  antibiotic_id: string;
  antibiotic_name?: string;
  aware_category?: string;
  allocated_quantity: number;
  reserved_quantity: number;
  consumed_quantity: number;
  available_quantity: number;
  demand_forecast_30d: number | null;
  reorder_threshold?: number | null;
  calculated_coverage_days: number | null;
  risk_level: string;
  allocation_status: string;
  unit?: string;
}

export interface Department {
  department_id: string;
  hospital_id: string;
  department_name: string;
  department_code: string;
  department_type: string;
  is_active: boolean;
}

export interface RegulatoryStatus {
  decision: "ALLOW" | "APPROVAL_REQUIRED" | "BLOCKED";
  status: string;
  policyId: string | null;
  policyName: string | null;
  restrictionLevel: string;
  requiresApproval: boolean;
  requiresDocumentation: boolean;
  requiresPrescription: boolean;
  authorized: boolean;
  reason: string | null;
  reasons: string[];
  maxIssueQuantity: number | null;
}

export interface BarcodeResult {
  barcode_value: string;
  barcode_type?: string;
  product_name?: string;
  manufacturer_name?: string;
  strength?: string;
  dosage_form?: string;
  packaging_unit?: string;
  packaging_count?: number;
  antibiotic_id: string;
  antibiotic_name: string;
  atc_code?: string;
  aware_category?: string;
  drug_class?: string;
  policy_id?: string | null;
  policy_name?: string | null;
  restriction_level?: string | null;
  requires_approval?: boolean | null;
  requires_documentation?: boolean | null;
  requires_prescription?: boolean | null;
  inventory: InventoryItem | null;
  total_hospital_stock: number;
  department_allocations: AllocationRow[];
}

export interface SupplyNode {
  node_id: string;
  node_name: string;
  node_type: string;
  country: string;
}

export interface SupplyEdge {
  source_node_id: string;
  source_node_name?: string;
  source_node_type?: string;
  target_node_id: string;
  target_node_name?: string;
  target_node_type?: string;
  antibiotic_id: string;
  supply_share_pct: number;
  total_lead_time: number;
  depth: number;
}

export interface SupplyTrace {
  hospital_id: string;
  antibiotic_id: string;
  edges: SupplyEdge[];
}

export interface FailoverAlert {
  inventory_date: string;
  hospital_id: string;
  antibiotic_id: string;
  antibiotic_name?: string;
  quantity_on_hand: number;
  daily_consumption: number;
  stockout_flag: boolean;
  failover_supplier: string;
  lead_time_days: number;
  minimum_order_quantity: number;
  recommended_order_vials: number;
}

export interface PurchaseOrder {
  purchase_order_id: string;
  hospital_id: string;
  supplier_id: string;
  supplier_name?: string;
  antibiotic_id: string;
  antibiotic_name?: string;
  order_date: string;
  expected_delivery_date: string;
  quantity_ordered: number;
  quantity_received: number;
  status: string;
}

export interface AuditEvent {
  event_id: string;
  hospital_id: string;
  event_timestamp: string;
  event_type: string;
  entity_type?: string;
  entity_id?: string;
  actor_id: string;
  actor_role?: string;
  action: string;
  result?: string;
  reason?: string | null;
  transaction_id?: string | null;
}

export interface DataQualityResult {
  check_id: string;
  check_timestamp: string;
  check_name: string;
  target_table: string;
  records_checked: number;
  records_passed: number;
  records_failed: number;
  check_status: string;
  severity?: string;
}

export interface TransactionResult {
  transaction_id: string;
  event_id: string;
  duplicate: boolean;
  policy_status?: string;
  message: string;
}
