import { isValidLatLng } from "../geo/service-area";
import type { LatLng } from "../geo/types";
import { freshnessLabel, type FreshnessLabel, type Perishability } from "../labels";
import { toMs, type TimeInput } from "../routing/time";
import type { DroppedCandidate, MatchCandidate, PickupWindowInput } from "./types";
import {
  floorToQuantum,
  isUnitCode,
  isUnitCompatible,
  quantumOf,
  roundTo,
  toNeedUnits,
  type UnitCode,
} from "./units";

/**
 * Sàng lọc phòng thủ các dòng `match_candidates` (ADR-007 §7: core tự lọc lại dù SQL đã lọc). Một dòng bị bỏ
 * kèm lý do khi: sai dữ liệu, trùng `offer_id`, điểm bị loại, sai danh mục/đơn vị, hết hàng, ngoài bán kính,
 * hết hạn, hoặc cờ khả thi sai (`eta_pickup > effective_deadline`).
 */

const PERISHABILITY: readonly Perishability[] = ["cooked", "fresh", "packaged"];

/** Lô đã chuẩn hoá, thời điểm ở dạng epoch ms. */
export interface ScreenedOffer {
  offerId: string;
  storeOrgId: string;
  siteId: string;
  categoryCode: string;
  unit: UnitCode;
  unitWeightKg: number;
  /** Số khả dụng đã làm tròn xuống theo bước của đơn vị. */
  qty: number;
  /** `qty` quy đổi về đơn vị nhu cầu (§4.6). */
  needUnits: number;
  deadline: number;
  perishability: Perishability;
  /** Nhãn tính lại tại `at` (ADR-005). */
  label: FreshnessLabel;
  distanceKm: number;
  /** `travel_min` của SQL (phút, gồm đệm) nếu hợp lệ. */
  travelMin: number | null;
  etaPickup: number;
  /** Đầu khung lấy; `null` ⇒ không chờ. */
  readyAt: number | null;
  trustScore: number | null;
  location: LatLng | null;
}

export interface ScreenContext {
  unit: UnitCode;
  categoryCodes: readonly string[];
  radiusKm: number;
  at: number;
  excludeSiteIds: readonly string[];
}

export interface ScreenResult {
  offers: ScreenedOffer[];
  dropped: DroppedCandidate[];
}

const RANGE = /^[[(]\s*"?([^",]*?)"?\s*,\s*"?([^",]*?)"?\s*[\])]$/;

function optionalTime(value: TimeInput | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  try {
    return toMs(value);
  } catch {
    return null;
  }
}

/** Đầu/cuối khung lấy (ms). Text `tstzrange` của Postgres, đối tượng `{start, end}` hoặc `null`; sai ⇒ `null`. */
export function parsePickupWindow(window: PickupWindowInput | undefined): {
  start: number | null;
  end: number | null;
} {
  if (window === null || window === undefined) return { start: null, end: null };
  if (typeof window === "string") {
    const m = RANGE.exec(window.trim());
    if (!m) return { start: null, end: null };
    return { start: optionalTime(m[1]), end: optionalTime(m[2]) };
  }
  return { start: optionalTime(window.start), end: optionalTime(window.end) };
}

const num = (v: unknown): number =>
  typeof v === "number" ? v : typeof v === "string" ? Number(v) : Number.NaN;
const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.length > 0;

function normalize(c: MatchCandidate, needUnit: UnitCode): ScreenedOffer | null {
  if (!c || !nonEmpty(c.offer_id) || !nonEmpty(c.site_id) || !nonEmpty(c.store_org_id)) return null;
  if (!nonEmpty(c.category_code) || !isUnitCode(c.unit) || !PERISHABILITY.includes(c.perishability))
    return null;
  const unitWeightKg = num(c.unit_weight_kg);
  const qtyAvailable = num(c.qty_available);
  const distanceKm = num(c.distance_km);
  if (!(unitWeightKg > 0) || !Number.isFinite(qtyAvailable) || !(distanceKm >= 0)) return null;
  const deadline = optionalTime(c.effective_deadline);
  const etaPickup = optionalTime(c.eta_pickup);
  if (deadline === null || etaPickup === null) return null;
  const travelMin = num(c.travel_min);
  const lat = num(c.site_lat);
  const lng = num(c.site_lng);
  const location = c.site_lat === null || c.site_lng === null ? null : { lat, lng };
  const trust = num(c.trust_score);
  const qty = Math.max(0, floorToQuantum(qtyAvailable, quantumOf(c.unit)));
  return {
    offerId: c.offer_id,
    storeOrgId: c.store_org_id,
    siteId: c.site_id,
    categoryCode: c.category_code,
    unit: c.unit,
    unitWeightKg,
    qty,
    needUnits: isUnitCompatible(c.unit, needUnit)
      ? roundTo(toNeedUnits(qty, c.unit, unitWeightKg, needUnit), 6)
      : 0,
    deadline,
    perishability: c.perishability,
    label: c.label,
    distanceKm,
    travelMin: travelMin >= 0 ? travelMin : null,
    etaPickup,
    readyAt: parsePickupWindow(c.pickup_window).start,
    trustScore: Number.isFinite(trust) ? trust : null,
    location: isValidLatLng(location) ? location : null,
  };
}

/** Sàng lọc và chuẩn hoá; kết quả sắp theo `offer_id` (tất định với mọi thứ tự đầu vào). */
export function screenCandidates(candidates: readonly MatchCandidate[], ctx: ScreenContext): ScreenResult {
  const dropped: DroppedCandidate[] = [];
  const valid: ScreenedOffer[] = [];
  for (const c of candidates) {
    const o = normalize(c, ctx.unit);
    if (o) valid.push(o);
    else dropped.push({ offerId: typeof c?.offer_id === "string" ? c.offer_id : "", reason: "invalid" });
  }
  // Trùng offer_id: giữ dòng có số khả dụng nhỏ hơn (an toàn), bỏ phần còn lại
  valid.sort(
    (a, b) =>
      cmpStr(a.offerId, b.offerId) || a.qty - b.qty || cmpStr(a.siteId, b.siteId) || a.deadline - b.deadline,
  );
  const exclude = new Set(ctx.excludeSiteIds);
  const categories = new Set(ctx.categoryCodes);
  const offers: ScreenedOffer[] = [];
  for (let i = 0; i < valid.length; i++) {
    const o = valid[i]!;
    const reason = ((): DroppedCandidate["reason"] | null => {
      if (i > 0 && valid[i - 1]!.offerId === o.offerId) return "duplicate";
      if (exclude.has(o.siteId)) return "excluded_site";
      if (!categories.has(o.categoryCode)) return "category_mismatch";
      if (!isUnitCompatible(o.unit, ctx.unit)) return "unit_mismatch";
      // Quy đổi nhỏ hơn 0,0005 đơn vị nhu cầu làm tròn về 0 ở numeric(12,3) ⇒ coi như hết hàng
      if (!(o.qty > 0) || !(roundTo(o.needUnits, 3) > 0)) return "no_quantity";
      if (o.distanceKm > ctx.radiusKm) return "out_of_radius";
      const label = freshnessLabel(new Date(o.deadline), o.perishability, new Date(ctx.at));
      if (label === "expired" || o.label === "expired") return "expired";
      o.label = label;
      if (o.etaPickup > o.deadline) return "infeasible_timing";
      return null;
    })();
    if (reason) dropped.push({ offerId: o.offerId, reason });
    else offers.push(o);
  }
  dropped.sort((a, b) => cmpStr(a.offerId, b.offerId) || cmpStr(a.reason, b.reason));
  return { offers, dropped };
}

export function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
