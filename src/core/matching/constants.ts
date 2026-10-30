/**
 * Hằng số engine ghép đơn (ADR-007). Đổi thuật toán theo cách làm thay đổi kết quả ⇒ tăng
 * `ALGORITHM_VERSION` (lưu vào `need_bundles.algorithm_version`, CHECK `^match-v[0-9]+$`).
 */

export const ALGORITHM_VERSION = "match-v1";

export interface MatchWeights {
  urgency: number;
  proximity: number;
  quantityFit: number;
  trust: number;
}

/** score = 0,4·độ gấp + 0,3·gần + 0,2·khớp số lượng + 0,1·uy tín (ADR-007 §2). Tổng = 1. */
export const MATCH_WEIGHTS: Readonly<MatchWeights> = Object.freeze({
  urgency: 0.4,
  proximity: 0.3,
  quantityFit: 0.2,
  trust: 0.1,
});

export interface MatchLimits {
  /** Số điểm cửa hàng điểm cao nhất được duyệt tổ hợp chính xác (ADR-007 §3.1). */
  topSites: number;
  /** Cỡ tổ hợp tối đa của phần duyệt chính xác: C(12,1)+C(12,2)+C(12,3) = 298 tổ hợp. */
  maxExactStops: number;
  /** Số điểm lấy tối đa một phương án (`app_settings.max_pickup_stops`). */
  maxStops: number;
  /** Số phương án trả về. */
  maxPlans: number;
}

export const MATCH_LIMITS: Readonly<MatchLimits> = Object.freeze({
  topSites: 12,
  maxExactStops: 3,
  maxStops: 5,
  maxPlans: 3,
});

/** `app_settings.matching_candidate_limit` — số dòng tối đa `match_candidates` trả (chỉ để tham chiếu/đo). */
export const CANDIDATE_LIMIT = 15;
