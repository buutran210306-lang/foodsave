import type { LatLng } from "../geo/types";

/**
 * Deep link chỉ đường mở app bản đồ trên điện thoại (ROADMAP P3-10: "Mở Google Maps/Apple Maps", kèm waypoint).
 * Thuần, không IO; chỉ dựng URL. Toạ độ 6 chữ số thập phân (~0,1 m).
 */

export type TravelMode = "two-wheeler" | "driving";

/** Google Maps URLs nhận tối đa 9 điểm trung gian (trình duyệt mobile có thể chỉ nhận 3). */
export const GOOGLE_MAX_WAYPOINTS = 9;

const coord = (p: LatLng) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;

export interface DirectionsOptions {
  /** Điểm đi; bỏ trống ⇒ vị trí hiện tại của người dùng. */
  origin?: LatLng | null;
  /** Các điểm dừng theo thứ tự trước `destination`. */
  waypoints?: readonly LatLng[];
  mode?: TravelMode;
}

/**
 * Link chỉ đường Google Maps (Maps URLs, `api=1`).
 * `travelmode=two-wheeler` (xe máy) có ở Việt Nam; nơi chưa hỗ trợ Google tự chọn phương tiện phù hợp.
 * `waypoints` (tối đa 9) cho cả tuyến nhiều điểm dừng.
 */
export function googleMapsDirectionsUrl(destination: LatLng, opts: DirectionsOptions = {}): string {
  const params = new URLSearchParams({ api: "1" });
  if (opts.origin) params.set("origin", coord(opts.origin));
  params.set("destination", coord(destination));
  params.set("travelmode", opts.mode ?? "two-wheeler");
  const waypoints = (opts.waypoints ?? []).slice(0, GOOGLE_MAX_WAYPOINTS);
  if (waypoints.length > 0) params.set("waypoints", waypoints.map(coord).join("|"));
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

/**
 * Link chỉ đường Apple Maps (Unified Maps URLs, iOS 18.4+: `/directions`, lặp tham số `waypoint` cho tuyến
 * nhiều điểm). Apple Maps không có chế độ xe máy nên luôn dùng `driving`.
 */
export function appleMapsDirectionsUrl(destination: LatLng, opts: DirectionsOptions = {}): string {
  const params = new URLSearchParams();
  if (opts.origin) params.set("source", coord(opts.origin));
  params.set("destination", coord(destination));
  for (const w of opts.waypoints ?? []) params.append("waypoint", coord(w));
  params.set("mode", "driving");
  return `https://maps.apple.com/directions?${params.toString()}`;
}

export interface DirectionsLinks {
  google: string | null;
  apple: string | null;
}

/**
 * Link cho cả tuyến: các điểm lấy theo thứ tự rồi về điểm giao. Có điểm thiếu toạ độ (điểm ẩn) ⇒ cả hai `null`
 * (không dựng tuyến sai); vượt giới hạn waypoint của Google ⇒ chỉ Google `null`.
 */
export function routeDirectionsLinks(
  pickups: readonly (LatLng | null | undefined)[],
  dropoff: LatLng,
  opts: Omit<DirectionsOptions, "waypoints"> = {},
): DirectionsLinks {
  if (pickups.some((p) => !p)) return { google: null, apple: null };
  const waypoints = pickups as LatLng[];
  return {
    google:
      waypoints.length <= GOOGLE_MAX_WAYPOINTS
        ? googleMapsDirectionsUrl(dropoff, { ...opts, waypoints })
        : null,
    apple: appleMapsDirectionsUrl(dropoff, { ...opts, waypoints }),
  };
}
