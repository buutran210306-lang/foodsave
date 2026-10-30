/**
 * Engine ghép đơn nhiều cửa hàng (ADR-007) — TypeScript thuần, không IO. Đầu vào là các dòng RPC
 * `match_candidates`; đầu ra là tối đa 3 phương án và tham số `reserve_bundle` của phương án được chọn.
 */
export { parsePickupWindow, screenCandidates, type ScreenedOffer } from "./candidates";
export {
  ALGORITHM_VERSION,
  CANDIDATE_LIMIT,
  MATCH_LIMITS,
  MATCH_WEIGHTS,
  type MatchLimits,
  type MatchWeights,
} from "./constants";
export {
  toReserveBundlePayload,
  type BundleInputsSnapshot,
  type ProviderRoute,
  type ReserveBundleLine,
  type ReserveBundleMeta,
  type ReserveBundleOptions,
  type ReserveBundlePayload,
} from "./payload";
export { proposePlans, rematch } from "./propose";
export {
  combineScore,
  preScore,
  proximityScore,
  quantityFitScore,
  scoreParts,
  trustScoreNorm,
  urgencyHorizonHours,
  urgencyScore,
  type PreScoreInput,
  type ScoreParts,
} from "./score";
export type {
  DropReason,
  DroppedCandidate,
  MatchCandidate,
  MatchInputsSummary,
  MatchNeed,
  MatchOptions,
  MatchPlan,
  MatchResult,
  PickupWindowInput,
  PlanLine,
  PlanStop,
  PlanWarning,
  SiteScore,
} from "./types";
export {
  UNIT_CODES,
  ceilToQuantum,
  floorToQuantum,
  isContinuousUnit,
  isUnitCode,
  isUnitCompatible,
  quantumOf,
  roundTo,
  toNeedUnits,
  type UnitCode,
} from "./units";
