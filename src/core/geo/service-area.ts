import type { LatLng } from "./types";

/**
 * Vùng phục vụ (xấp xỉ) của FoodSave: khung bao TP.HCM theo địa giới mới từ 01/7/2025
 * (gồm Bình Dương, Bà Rịa – Vũng Tàu cũ; không gồm Côn Đảo). Dùng để chặn ghim lệch ra ngoài
 * (ADR-006, spike map-goong §Kết luận). Đổi giá trị phải cập nhật ADR-006.
 */
export const SERVICE_AREA_BBOX = {
  minLng: 106.33,
  maxLng: 107.6,
  minLat: 10.3,
  maxLat: 11.55,
} as const;

/** Tâm TP.HCM cũ — vị trí mặc định khi chưa có ghim (trùng HCMC_CENTER của provider). */
export const DEFAULT_MAP_CENTER: LatLng = { lat: 10.7769, lng: 106.7009 };

/** Toạ độ là số hữu hạn và nằm trong miền WGS84. */
export function isValidLatLng(p: LatLng | null | undefined): p is LatLng {
  return (
    !!p &&
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    p.lat >= -90 &&
    p.lat <= 90 &&
    p.lng >= -180 &&
    p.lng <= 180
  );
}

/** Điểm nằm trong vùng phục vụ (biên tính là bên trong). */
export function isInServiceArea(p: LatLng | null | undefined): boolean {
  if (!isValidLatLng(p)) return false;
  const b = SERVICE_AREA_BBOX;
  return p.lng >= b.minLng && p.lng <= b.maxLng && p.lat >= b.minLat && p.lat <= b.maxLat;
}
