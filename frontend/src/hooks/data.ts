// Read hooks — thin wrappers over the endpoint services + useAsync.

import {
  CatalogApi,
  DashboardApi,
  DepartmentApi,
  GovernanceApi,
  InventoryApi,
  SupplyChainApi,
  AllocationApi,
  RecommendationApi,
  ScenarioApi,
  AmrExplorerApi,
  IngestionApi,
  VendorApi,
  AuthApi,
} from "../api/endpoints";
import { useAsync } from "./useAsync";

export const useRecommendations = (hospitalId = "H001") =>
  useAsync((s) => RecommendationApi.list(hospitalId, s), [hospitalId]);

export const useScenarioPresets = () => useAsync((s) => ScenarioApi.presets(s), []);

export const useAmrFilters = () => useAsync((s) => AmrExplorerApi.filters(s), []);
export const useAmrSummary = (p: Record<string, string | undefined>) =>
  useAsync((s) => AmrExplorerApi.summary(p, s), [p.region, p.pathogen, p.antibiotic, p.specimen]);
export const useAmrMatrix = (region?: string, specimen?: string) =>
  useAsync((s) => AmrExplorerApi.matrix({ region, specimen }, s), [region, specimen]);
export const useAmrTrend = (pathogen: string, antibiotic: string, region?: string) =>
  useAsync((s) => AmrExplorerApi.trend(pathogen, antibiotic, region, s), [pathogen, antibiotic, region]);

export const useGlassRuns = () => useAsync((s) => IngestionApi.glassRuns(s), []);
export const useHospitalBatches = () => useAsync((s) => IngestionApi.hospitalBatches(s), []);
export const useVendorDocs = (status?: string) => useAsync((s) => VendorApi.list(status, s), [status]);
export const useVendorDoc = (id: string | null) =>
  useAsync((s) => (id ? VendorApi.get(id, s) : Promise.resolve(undefined as any)), [id]);

export const useDashboardSummary = () =>
  useAsync((s) => DashboardApi.summary(s), []);

export const usePredictions = (threshold = 0.2, hospitalId?: string) =>
  useAsync((s) => DashboardApi.predictions({ threshold, hospital_id: hospitalId, limit: 200 }, s), [threshold, hospitalId]);

export const useTrends = (hospitalId: string, antibioticId: string, months = 12) =>
  useAsync(
    (s) => DashboardApi.trends(hospitalId, antibioticId, months, s),
    [hospitalId, antibioticId, months],
  );

export const useAmrSurveillance = () =>
  useAsync((s) => DashboardApi.amrSurveillance(s), []);

export const useHospitals = (search?: string) =>
  useAsync((s) => CatalogApi.hospitals(search, s), [search]);

export const useAntibiotics = () =>
  useAsync((s) => CatalogApi.antibiotics(s), []);

export const useInventory = (hospitalId = "H001", antibioticId?: string) =>
  useAsync((s) => InventoryApi.list({ hospital_id: hospitalId, antibiotic_id: antibioticId }, s), [hospitalId, antibioticId]);

export const useInventoryItem = (antibioticId: string | null, hospitalId = "H001") =>
  useAsync(
    (s) => (antibioticId ? InventoryApi.item(antibioticId, hospitalId, s) : Promise.resolve(undefined as any)),
    [antibioticId, hospitalId],
  );

export const useDepartments = (hospitalId = "H001") =>
  useAsync((s) => DepartmentApi.list(hospitalId, s), [hospitalId]);

export const useAllocationSummary = (hospitalId = "H001") =>
  useAsync((s) => DepartmentApi.allocationSummary(hospitalId, s), [hospitalId]);

export const useAllocations = (params: { hospital_id?: string; antibiotic_id?: string; department_code?: string } = {}) =>
  useAsync((s) => AllocationApi.list(params, s), [params.hospital_id, params.antibiotic_id, params.department_code]);

export const useSupplyNodes = () => useAsync((s) => SupplyChainApi.nodes(s), []);

export const useSupplyTrace = (hospitalId = "H001", antibioticId = "ANT-MERO") =>
  useAsync((s) => SupplyChainApi.trace(hospitalId, antibioticId, s), [hospitalId, antibioticId]);

export const useFailoverAlerts = (hospitalId?: string) =>
  useAsync((s) => SupplyChainApi.failoverAlerts(hospitalId, s), [hospitalId]);

export const usePurchaseOrders = (hospitalId?: string) =>
  useAsync((s) => SupplyChainApi.purchaseOrders(hospitalId, s), [hospitalId]);

export const useAuditEvents = (limit = 50) =>
  useAsync((s) => GovernanceApi.auditEvents({ limit }, s), [limit]);

export const useDataQuality = () => useAsync((s) => GovernanceApi.dataQuality(s), []);

export const useStaffUsers = (nonce = 0) => useAsync((s) => AuthApi.listUsers(s), [nonce]);
export const useAuthRoles = () => useAsync((s) => AuthApi.roles(s), []);
