import { haversineM } from "../geo/distance";
import type { LatLng } from "../geo/types";
import { DEFAULT_TRAVEL_CONFIG, type TravelConfig } from "./constants";

/** Khoảng cách đường chim bay (haversine, dùng lại `src/core/geo`), đơn vị km. */
export function haversineKm(a: LatLng, b: LatLng): number {
  return haversineM(a, b) / 1000;
}

/** Quãng đường ước lượng trên đường phố: chim bay × hệ số đường vòng (km). */
export function roadKm(crowKm: number, config: TravelConfig = DEFAULT_TRAVEL_CONFIG): number {
  return crowKm * config.detourFactor;
}

/** Thời gian lái xe thuần (phút), chưa gồm đệm. */
export function driveMinutes(crowKm: number, config: TravelConfig = DEFAULT_TRAVEL_CONFIG): number {
  return ((crowKm * config.detourFactor) / config.speedKmh) * 60;
}

/**
 * Thời gian một chặng (phút) = chim bay × hệ số ÷ tốc độ × 60 + đệm — đúng công thức `private.travel_min`
 * (DATA-MODEL §4.7). Đệm tính cho mỗi lần tới một điểm (điểm lấy hoặc điểm giao).
 */
export function travelMinutes(crowKm: number, config: TravelConfig = DEFAULT_TRAVEL_CONFIG): number {
  return driveMinutes(crowKm, config) + config.bufferMinutes;
}
