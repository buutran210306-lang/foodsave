/** Toạ độ WGS84 (độ thập phân). Thuần, dùng chung client/server. */
export interface LatLng {
  lat: number;
  lng: number;
}

/** Cặp toạ độ theo thứ tự GeoJSON: [kinh độ, vĩ độ]. */
export type LngLatTuple = [number, number];
