/**
 * Chuyển dữ liệu của dự án FoodSave bản cũ (bảng `donations`, `stores`, `charity_needs`) sang đầu vào của
 * engine ghép đơn trong `src/core/matching`. Thuần TypeScript, không gọi database: dễ test, dễ giải thích.
 *
 * Quy ước:
 * - Mỗi cửa hàng (`stores`) là một "điểm lấy" (site_id = store_id).
 * - Mặc định đơn vị là kg (bản cũ lưu `donations.weight_kg`). Có thể truyền `qty` + `unit` để dùng ổ, hộp…
 * - Giờ `pickup_start` / `pickup_end` dạng "HH:MM" được hiểu theo giờ Việt Nam (UTC+7) của ngày đang tính.
 */
import { freshnessLabel, type Perishability } from "../core/labels";
import type { MatchCandidate, MatchNeed, UnitCode } from "../core/matching";
import { haversineKm, travelMinutes } from "../core/routing/distance";

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

export interface DonationRowForMatch {
  id: string;
  store_id: string;
  weight_kg: number | string;
  expires_at: string;
  /** "HH:MM" (giờ VN) hoặc ISO đầy đủ. */
  pickup_start: string;
  pickup_end: string;
  category_code?: string | null;
  perishability?: Perishability | null;
  /** Tùy chọn: số lượng theo đơn vị khác kg (ví dụ 20 ổ). Bỏ trống ⇒ dùng weight_kg với đơn vị kg. */
  qty?: number | null;
  unit?: UnitCode | null;
}

export interface StoreRowForMatch {
  id: string;
  latitude: number | null;
  longitude: number | null;
  /** Thang 0–5 của bảng stores; đổi sang 0–100 cho điểm uy tín. */
  rating?: number | string | null;
}

export interface CharityNeedForMatch {
  /** Phần còn thiếu, theo `unit`. */
  quantity: number;
  unit?: UnitCode;
  categoryCodes: string[];
  /** Cần nhận trước thời điểm này (ISO). */
  neededBy: string;
  charityLat: number;
  charityLng: number;
  radiusKm: number;
}

/** Ngày (yyyy-mm-dd) theo giờ Việt Nam của thời điểm `at`. */
function vnDate(at: Date): string {
  return new Date(at.getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);
}

/** "HH:MM" của ngày `at` (giờ VN) → Date. Chuỗi ISO đầy đủ thì đọc thẳng. */
export function vnTimeOnDate(value: string, at: Date): Date | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (m) {
    const hh = m[1]!.padStart(2, "0");
    const d = new Date(`${vnDate(at)}T${hh}:${m[2]}:00+07:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Một lô tặng + cửa hàng của nó ⇒ một dòng ứng viên cho engine. Trả `null` khi thiếu tọa độ hoặc giờ hỏng
 * (engine sẽ không xét lô đó).
 */
export function buildCandidate(
  donation: DonationRowForMatch,
  store: StoreRowForMatch,
  need: CharityNeedForMatch,
  at: Date,
): MatchCandidate | null {
  if (store.latitude == null || store.longitude == null) return null;
  const expiresAt = new Date(donation.expires_at);
  const start = vnTimeOnDate(donation.pickup_start, at);
  const end = vnTimeOnDate(donation.pickup_end, at);
  if (Number.isNaN(expiresAt.getTime()) || !start || !end) return null;

  // Hạn hiệu lực = mốc sớm nhất giữa hạn dùng và giờ hết khung lấy
  const deadline = new Date(Math.min(expiresAt.getTime(), end.getTime()));
  const perishability: Perishability = donation.perishability ?? "cooked";

  const store_ = { lat: store.latitude, lng: store.longitude };
  const charity = { lat: need.charityLat, lng: need.charityLng };
  const distanceKm = haversineKm(charity, store_);
  const travelMin = travelMinutes(distanceKm);

  // Tới nơi sớm hơn giờ mở khung lấy thì chờ tới giờ mở
  const arrive = at.getTime() + travelMin * 60_000;
  const etaPickup = new Date(Math.max(arrive, start.getTime()));
  const etaDropoff = new Date(etaPickup.getTime() + travelMin * 60_000);

  const unit: UnitCode = donation.unit ?? "kg";
  const weightKg = Number(donation.weight_kg);
  const qty = donation.qty ?? weightKg;
  const unitWeightKg = unit === "kg" ? 1 : qty > 0 ? weightKg / qty : 0;
  const rating = store.rating != null ? Number(store.rating) : null;

  return {
    offer_id: donation.id,
    store_org_id: store.id,
    site_id: store.id,
    category_code: donation.category_code ?? "other",
    unit,
    unit_weight_kg: unitWeightKg,
    qty_available: qty,
    available_need_units: qty,
    effective_deadline: deadline.toISOString(),
    perishability,
    label: freshnessLabel(deadline, perishability, at),
    distance_km: Math.round(distanceKm * 1000) / 1000,
    travel_min: Math.round(travelMin * 10) / 10,
    eta_pickup: etaPickup.toISOString(),
    eta_dropoff: etaDropoff.toISOString(),
    pickup_window: { start: start.toISOString(), end: end.toISOString() },
    trust_score: rating != null && Number.isFinite(rating) ? Math.round(rating * 20) : null,
    pre_score: null,
    site_lat: store.latitude,
    site_lng: store.longitude,
  };
}

/** Nhu cầu của tổ chức ⇒ đầu vào `MatchNeed` của engine. */
export function buildNeed(need: CharityNeedForMatch, at: Date): MatchNeed {
  return {
    quantity: need.quantity,
    unit: need.unit ?? "kg",
    categoryCodes: need.categoryCodes,
    siteLocation: { lat: need.charityLat, lng: need.charityLng },
    radiusKm: need.radiusKm,
    neededBy: need.neededBy,
    at: at.toISOString(),
    siteId: "charity",
  };
}
