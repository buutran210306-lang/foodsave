import type { LatLng } from "./types";

/** Bán kính Trái Đất trung bình (m) — cùng giá trị turf.js dùng. */
export const EARTH_RADIUS_M = 6_371_008.8;

const RAD = Math.PI / 180;

/** Khoảng cách đường chim bay (haversine), đơn vị mét. */
export function haversineM(a: LatLng, b: LatLng): number {
  const dLat = (b.lat - a.lat) * RAD;
  const dLng = (b.lng - a.lng) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Điểm đích khi đi từ `origin` theo hướng `bearingDeg` (0 = bắc, 90 = đông) một quãng `distanceM`
 * trên mặt cầu.
 */
export function destinationPoint(origin: LatLng, distanceM: number, bearingDeg: number): LatLng {
  const delta = distanceM / EARTH_RADIUS_M;
  const theta = bearingDeg * RAD;
  const phi1 = origin.lat * RAD;
  const lambda1 = origin.lng * RAD;
  const sinPhi2 = Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(theta);
  const phi2 = Math.asin(sinPhi2);
  const lambda2 =
    lambda1 +
    Math.atan2(
      Math.sin(theta) * Math.sin(delta) * Math.cos(phi1),
      Math.cos(delta) - Math.sin(phi1) * sinPhi2,
    );
  // Chuẩn hoá kinh độ về [-180, 180)
  const lng = ((((lambda2 / RAD + 540) % 360) + 360) % 360) - 180;
  return { lat: phi2 / RAD, lng };
}
