import type { LngLatTuple } from "../geo/types";
import { cmpStr } from "./candidates";
import type { MatchPlan, MatchResult } from "./types";
import { roundTo } from "./units";

/**
 * Dựng tham số cho RPC `reserve_bundle(p_need_id, p_lines, p_client_op_id, p_meta)` (DATA-MODEL §8.4) từ một
 * phương án đã chọn. `inputs_snapshot` lưu vào `need_bundles.inputs_snapshot` để giải thích "vì sao chọn
 * phương án này" (điểm thành phần, ứng viên bị loại, phương án thay thế). Thuần, JSON-serializable.
 */

export interface ReserveBundleLine {
  offer_id: string;
  qty: number;
}

/** Tuyến thật do `MapsProvider.route` trả cho phương án được chọn (ADR-007 §5). */
export interface ProviderRoute {
  geojson: { type: "LineString"; coordinates: LngLatTuple[] };
  distanceM: number;
  durationS: number;
  provider: string;
}

export interface BundleInputsSnapshot {
  algorithm_version: string;
  at: string;
  needed_by: string;
  unit: string;
  remaining: number;
  radius_km: number;
  category_codes: string[];
  exclude_site_ids: string[];
  travel: { detour_factor: number; speed_kmh: number; buffer_minutes: number };
  weights: { urgency: number; proximity: number; quantity_fit: number; trust: number };
  option: {
    rank: number;
    source: "exact" | "extended";
    site_ids: string[];
    order: string[];
    coverage: number;
    covered_qty: number;
    allocated_qty: number;
    shortfall: number;
    est_distance_m: number;
    est_duration_s: number;
    end_at: string;
    warnings: string[];
  };
  sites: {
    site_id: string;
    store_org_id: string;
    rank: number;
    urgency: number;
    proximity: number;
    quantity_fit: number;
    trust: number;
    score: number;
    available_need_units: number;
    distance_km: number;
    earliest_deadline: string;
  }[];
  lines: {
    offer_id: string;
    site_id: string;
    qty: number;
    need_units: number;
    qty_available: number;
    effective_deadline: string;
    label: string;
  }[];
  alternatives: {
    rank: number;
    site_ids: string[];
    coverage: number;
    stop_count: number;
    est_distance_m: number;
    score: number;
  }[];
  candidates: { total: number; used: number; dropped: { offer_id: string; reason: string }[] };
  route_source: "estimate" | "provider";
}

export interface ReserveBundleMeta {
  option_rank: number;
  score: number;
  stop_count: number;
  est_distance_m: number;
  est_duration_s: number;
  algorithm_version: string;
  inputs_snapshot: BundleInputsSnapshot;
  route_geojson?: ProviderRoute["geojson"];
  route_provider?: string;
  rematch_of?: string;
}

export interface ReserveBundlePayload {
  p_lines: ReserveBundleLine[];
  p_meta: ReserveBundleMeta;
}

export interface ReserveBundleOptions {
  /** `need_bundles.id` của phương án bị thiếu khi đây là lần ghép lại. */
  rematchOf?: string | null;
  /** Tuyến thật; có thì `est_distance_m/est_duration_s` lấy từ đây. */
  route?: ProviderRoute | null;
}

/** `plan` là phương án trong `result.plans` hoặc hạng của nó (1–3). */
export function toReserveBundlePayload(
  result: MatchResult,
  plan: MatchPlan | number,
  opts: ReserveBundleOptions = {},
): ReserveBundlePayload {
  const chosen =
    typeof plan === "number"
      ? result.plans.find((p) => p.rank === plan)
      : result.plans.find(
          (p) => p === plan || (p.rank === plan.rank && p.siteIds.join() === plan.siteIds.join()),
        );
  if (!chosen) throw new RangeError("Phương án không thuộc kết quả ghép này");

  const route = opts.route ?? null;
  const estDistanceM = route ? Math.max(0, Math.round(route.distanceM)) : chosen.estDistanceM;
  const estDurationS = route ? Math.max(0, Math.round(route.durationS)) : chosen.estDurationS;
  const { inputs } = result;

  const snapshot: BundleInputsSnapshot = {
    algorithm_version: result.algorithmVersion,
    at: inputs.at,
    needed_by: inputs.neededBy,
    unit: inputs.unit,
    remaining: inputs.remaining,
    radius_km: inputs.radiusKm,
    category_codes: [...inputs.categoryCodes],
    exclude_site_ids: [...inputs.excludeSiteIds],
    travel: {
      detour_factor: inputs.travel.detourFactor,
      speed_kmh: inputs.travel.speedKmh,
      buffer_minutes: inputs.travel.bufferMinutes,
    },
    weights: {
      urgency: inputs.weights.urgency,
      proximity: inputs.weights.proximity,
      quantity_fit: inputs.weights.quantityFit,
      trust: inputs.weights.trust,
    },
    option: {
      rank: chosen.rank,
      source: chosen.source,
      site_ids: [...chosen.siteIds],
      order: [...chosen.route.order],
      coverage: chosen.coverage,
      covered_qty: chosen.coveredQty,
      allocated_qty: chosen.allocatedQty,
      shortfall: chosen.shortfall,
      est_distance_m: chosen.estDistanceM,
      est_duration_s: chosen.estDurationS,
      end_at: chosen.route.endAt,
      warnings: [...chosen.warnings],
    },
    sites: chosen.scores.map((s) => ({
      site_id: s.siteId,
      store_org_id: s.storeOrgId,
      rank: s.rank,
      urgency: s.urgency,
      proximity: s.proximity,
      quantity_fit: s.quantityFit,
      trust: s.trust,
      score: s.score,
      available_need_units: s.availableNeedUnits,
      distance_km: s.distanceKm,
      earliest_deadline: s.earliestDeadline,
    })),
    lines: chosen.lines.map((l) => ({
      offer_id: l.offerId,
      site_id: l.siteId,
      qty: l.qty,
      need_units: l.needUnits,
      qty_available: l.qtyAvailable,
      effective_deadline: l.effectiveDeadline,
      label: l.label,
    })),
    alternatives: result.plans
      .filter((p) => p !== chosen)
      .map((p) => ({
        rank: p.rank,
        site_ids: [...p.siteIds],
        coverage: p.coverage,
        stop_count: p.stopCount,
        est_distance_m: p.estDistanceM,
        score: p.score,
      })),
    candidates: {
      total: result.candidates.total,
      used: result.candidates.used,
      dropped: result.candidates.dropped.map((d) => ({ offer_id: d.offerId, reason: d.reason })),
    },
    route_source: route ? "provider" : "estimate",
  };

  const meta: ReserveBundleMeta = {
    option_rank: chosen.rank,
    score: roundTo(Math.min(1, Math.max(0, chosen.score)), 4),
    stop_count: chosen.stopCount,
    est_distance_m: estDistanceM,
    est_duration_s: estDurationS,
    algorithm_version: result.algorithmVersion,
    inputs_snapshot: snapshot,
  };
  if (route) {
    meta.route_geojson = route.geojson;
    meta.route_provider = route.provider;
  }
  if (opts.rematchOf) meta.rematch_of = opts.rematchOf;

  return {
    p_lines: chosen.lines
      .map((l) => ({ offer_id: l.offerId, qty: l.qty }))
      .sort((a, b) => cmpStr(a.offer_id, b.offer_id)),
    p_meta: meta,
  };
}
