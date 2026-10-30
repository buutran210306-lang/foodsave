import type { LatLng } from "../geo/types";
import type { FreshnessLabel, Perishability } from "../labels";
import type { RoutePlan } from "../routing/order";
import type { TravelConfig } from "../routing/constants";
import type { TimeInput } from "../routing/time";
import type { MatchLimits, MatchWeights } from "./constants";
import type { ScoreParts } from "./score";
import type { UnitCode } from "./units";

/** Khung lấy: text `tstzrange` của PostgREST (`["…","…")`) hoặc đã tách sẵn. */
export type PickupWindowInput = string | { start: TimeInput | null; end: TimeInput | null } | null;

/**
 * Một dòng của RPC `match_candidates` (DATA-MODEL §8.4), đúng tên cột — truyền thẳng `data` của
 * `supabase.rpc('match_candidates', …)`. `site_lat/site_lng` là `null` với điểm ẩn.
 */
export interface MatchCandidate {
  offer_id: string;
  store_org_id: string;
  site_id: string;
  category_code: string;
  unit: UnitCode;
  unit_weight_kg: number;
  qty_available: number;
  available_need_units: number;
  effective_deadline: TimeInput;
  perishability: Perishability;
  label: FreshnessLabel;
  distance_km: number;
  travel_min: number;
  eta_pickup: TimeInput;
  eta_dropoff: TimeInput;
  pickup_window: PickupWindowInput;
  trust_score: number | null;
  pre_score: number | null;
  site_lat: number | null;
  site_lng: number | null;
}

/** Nhu cầu cần ghép (phần còn thiếu) và điểm nhận. */
export interface MatchNeed {
  /** Phần còn thiếu R theo đơn vị nhu cầu (> 0; số nguyên nếu đơn vị đếm). */
  quantity: number;
  unit: UnitCode;
  /** Danh mục thay thế được cho nhau (`needs.category_codes`). */
  categoryCodes: readonly string[];
  /** Điểm nhận của tổ chức — điểm xuất phát và điểm giao của tuyến ước lượng. */
  siteLocation: LatLng;
  /** `sites.radius_km` của điểm nhận. */
  radiusKm: number;
  neededBy: TimeInput;
  /** Thời điểm tính (giống `p_at` của `match_candidates`). */
  at: TimeInput;
  /** `id` điểm nhận (để gắn vào tuyến); mặc định `"dropoff"`. */
  siteId?: string;
}

export interface MatchOptions {
  /** Bỏ các điểm cửa hàng này (ghép lại phần thiếu: điểm đã có phân bổ sống). */
  excludeSiteIds?: readonly string[];
  travel?: TravelConfig;
  weights?: MatchWeights;
  limits?: Partial<MatchLimits>;
}

export type DropReason =
  | "invalid"
  | "duplicate"
  | "excluded_site"
  | "category_mismatch"
  | "unit_mismatch"
  | "no_quantity"
  | "out_of_radius"
  | "expired"
  | "infeasible_timing";

export interface DroppedCandidate {
  offerId: string;
  reason: DropReason;
}

/** Điểm thành phần của một điểm cửa hàng (gộp các lô của điểm). */
export interface SiteScore extends ScoreParts {
  siteId: string;
  storeOrgId: string;
  /** Hạng theo điểm (1 = cao nhất); ≤ `topSites` mới vào phần duyệt chính xác. */
  rank: number;
  offerIds: string[];
  /** Σ khả dụng quy đổi về đơn vị nhu cầu. */
  availableNeedUnits: number;
  distanceKm: number;
  /** Hạn hiệu lực sớm nhất trong các lô của điểm (quyết định độ gấp). */
  earliestDeadline: string;
}

export interface PlanLine {
  offerId: string;
  siteId: string;
  storeOrgId: string;
  categoryCode: string;
  unit: UnitCode;
  unitWeightKg: number;
  /** Số lượng giữ, theo đơn vị của lô (số nguyên nếu đơn vị đếm). */
  qty: number;
  /** `qty` quy đổi về đơn vị nhu cầu (§4.6). */
  needUnits: number;
  /** Phần khả dụng của lô lúc tính. */
  qtyAvailable: number;
  effectiveDeadline: string;
  perishability: Perishability;
  label: FreshnessLabel;
}

export interface PlanStop {
  seq: number;
  siteId: string;
  storeOrgId: string;
  /** `null` với điểm ẩn. */
  location: LatLng | null;
  arriveAt: string;
  serviceAt: string;
  deadline: string | null;
  offerIds: string[];
}

export type PlanWarning = "arrives_after_needed_by";

export interface MatchPlan {
  /** 1–3, đúng thứ tự xếp hạng. */
  rank: number;
  algorithmVersion: string;
  /** `exact`: từ phần duyệt mọi tổ hợp ≤ 3 điểm; `extended`: từ phần mở rộng tham lam. */
  source: "exact" | "extended";
  /** Tập điểm cửa hàng, sắp theo id. */
  siteIds: string[];
  stopCount: number;
  lines: PlanLine[];
  /** Điểm lấy theo thứ tự đi. */
  stops: PlanStop[];
  /** R — phần còn thiếu lúc tính. */
  requestedQty: number;
  /** Σ quy đổi đã giữ; có thể vượt R ít hơn một đơn vị khi quy đổi kg (§4.6). */
  allocatedQty: number;
  /** min(allocatedQty, R). */
  coveredQty: number;
  shortfall: number;
  /** coveredQty / R, 6 chữ số. */
  coverage: number;
  route: RoutePlan;
  estDistanceM: number;
  estDurationS: number;
  /** Trung bình điểm các điểm cửa hàng (`need_bundles.score`, 4 chữ số). */
  score: number;
  /** Điểm thành phần của từng điểm trong phương án. */
  scores: SiteScore[];
  /** Số lô nhãn Đỏ (US-CHA-10 AC1). */
  redLots: number;
  warnings: PlanWarning[];
  /** Gợi ý ghép lại khi còn thiếu: đúng phần thiếu, loại các điểm đã dùng. */
  rematch: { remaining: number; excludeSiteIds: string[] } | null;
}

export interface MatchInputsSummary {
  at: string;
  neededBy: string;
  unit: UnitCode;
  remaining: number;
  radiusKm: number;
  categoryCodes: string[];
  excludeSiteIds: string[];
  travel: TravelConfig;
  weights: MatchWeights;
  limits: MatchLimits;
}

export interface MatchResult {
  algorithmVersion: string;
  inputs: MatchInputsSummary;
  /** ≤ `maxPlans` phương án, tập điểm khác nhau, đã xếp hạng. */
  plans: MatchPlan[];
  /** Mọi điểm cửa hàng hợp lệ, theo hạng điểm. */
  siteScores: SiteScore[];
  candidates: { total: number; used: number; dropped: DroppedCandidate[] };
  stats: { combosEvaluated: number; routesEvaluated: number };
}
