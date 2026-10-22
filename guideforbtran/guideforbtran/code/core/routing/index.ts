/**
 * Engine tuyến (ADR-007 §5) — TypeScript thuần, không IO. Dùng cho ước lượng tuyến của phương án ghép,
 * sắp thứ tự điểm dừng của chuyến, chia tuyến cho 2 tình nguyện viên và deep link bản đồ.
 */
export {
  DEFAULT_TRAVEL_CONFIG,
  MAX_EXACT_STOPS,
  TRAVEL_SETTING_KEYS,
  assertTravelConfig,
  travelConfigFrom,
  type TravelConfig,
} from "./constants";
export { driveMinutes, haversineKm, roadKm, travelMinutes } from "./distance";
export {
  GOOGLE_MAX_WAYPOINTS,
  appleMapsDirectionsUrl,
  googleMapsDirectionsUrl,
  routeDirectionsLinks,
  type DirectionsLinks,
  type DirectionsOptions,
  type TravelMode,
} from "./links";
export {
  bestOrder,
  estimateRoute,
  type RouteAnchor,
  type RouteInput,
  type RouteLeg,
  type RouteObjective,
  type RoutePlan,
  type RouteStop,
} from "./order";
export { MAX_SPLIT_STOPS, splitBetweenTwo, type SplitInput, type SplitPlan } from "./split";
export { parseTimestamp, toIso, toMs, toMsOrNull, type TimeInput } from "./time";
