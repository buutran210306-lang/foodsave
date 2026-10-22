import { LABEL_THRESHOLDS_V1, type Perishability } from "../labels";
import { toMs, type TimeInput } from "../routing/time";
import { MATCH_WEIGHTS, type MatchWeights } from "./constants";
import { roundTo } from "./units";

/**
 * Chấm điểm ứng viên (ADR-007 §2). Mọi thành phần chuẩn hoá về [0, 1]:
 *
 * | Thành phần | Công thức |
 * |---|---|
 * | Độ gấp `u` | `clamp(1 − giờ_còn_lại / H(perishability), 0, 1)`; H = ngưỡng Xanh của nhãn v1: 12 h (cooked), 72 h (fresh), 168 h (packaged) |
 * | Gần `p` | `clamp(1 − distance_km / radius_km, 0, 1)` |
 * | Khớp số lượng `f` | `min(khả_dụng_quy_đổi, R) / R`, R = phần còn thiếu của nhu cầu |
 * | Uy tín `t` | `clamp(trust_score / 100, 0, 1)` |
 *
 * `score = 0,4u + 0,3p + 0,2f + 0,1t`; `pre_score` của SQL = `0,4u + 0,3p + 0,1t` (chưa biết R).
 * Hai phía dùng chung `fixtures.json`.
 */

const HOUR = 3_600_000;

export interface ScoreParts {
  urgency: number;
  proximity: number;
  quantityFit: number;
  trust: number;
  score: number;
}

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

/** Số giờ "Xanh" tối đa theo loại hàng — mốc nhãn chuyển Vàng (`LABEL_THRESHOLDS_V1.yellowAtMostMs`). */
export function urgencyHorizonHours(perishability: Perishability): number {
  return LABEL_THRESHOLDS_V1[perishability].yellowAtMostMs / HOUR;
}

export function urgencyScore(deadline: TimeInput, perishability: Perishability, at: TimeInput): number {
  const hoursLeft = (toMs(deadline, "effective_deadline") - toMs(at, "at")) / HOUR;
  return clamp01(1 - hoursLeft / urgencyHorizonHours(perishability));
}

export function proximityScore(distanceKm: number, radiusKm: number): number {
  if (!(radiusKm > 0)) return 0;
  return clamp01(1 - distanceKm / radiusKm);
}

export function quantityFitScore(availableNeedUnits: number, remaining: number): number {
  if (!(remaining > 0)) return 0;
  return clamp01(Math.min(Math.max(availableNeedUnits, 0), remaining) / remaining);
}

export function trustScoreNorm(trustScore: number | null | undefined): number {
  return clamp01((trustScore ?? 0) / 100);
}

export function combineScore(
  parts: Omit<ScoreParts, "score">,
  weights: Readonly<MatchWeights> = MATCH_WEIGHTS,
): number {
  return (
    weights.urgency * parts.urgency +
    weights.proximity * parts.proximity +
    weights.quantityFit * parts.quantityFit +
    weights.trust * parts.trust
  );
}

export interface PreScoreInput {
  effectiveDeadline: TimeInput;
  perishability: Perishability;
  at: TimeInput;
  distanceKm: number;
  radiusKm: number;
  trustScore: number | null | undefined;
}

/** `pre_score` của `match_candidates` (không có thành phần khớp số lượng), làm tròn 4 chữ số như SQL. */
export function preScore(input: PreScoreInput, weights: Readonly<MatchWeights> = MATCH_WEIGHTS): number {
  return roundTo(
    combineScore(
      {
        urgency: urgencyScore(input.effectiveDeadline, input.perishability, input.at),
        proximity: proximityScore(input.distanceKm, input.radiusKm),
        quantityFit: 0,
        trust: trustScoreNorm(input.trustScore),
      },
      weights,
    ),
    4,
  );
}

/** Điểm đầy đủ của một ứng viên (lô hoặc điểm cửa hàng) khi đã biết phần còn thiếu `remaining`. */
export function scoreParts(
  input: PreScoreInput & { availableNeedUnits: number; remaining: number },
  weights: Readonly<MatchWeights> = MATCH_WEIGHTS,
): ScoreParts {
  const parts = {
    urgency: urgencyScore(input.effectiveDeadline, input.perishability, input.at),
    proximity: proximityScore(input.distanceKm, input.radiusKm),
    quantityFit: quantityFitScore(input.availableNeedUnits, input.remaining),
    trust: trustScoreNorm(input.trustScore),
  };
  return { ...parts, score: combineScore(parts, weights) };
}
