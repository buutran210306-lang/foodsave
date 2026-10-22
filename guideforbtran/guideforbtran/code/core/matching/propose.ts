import { isValidLatLng } from "../geo/service-area";
import type { LatLng } from "../geo/types";
import {
  DEFAULT_TRAVEL_CONFIG,
  MAX_EXACT_STOPS,
  assertTravelConfig,
  type TravelConfig,
} from "../routing/constants";
import { bestOrder, type RoutePlan, type RouteStop } from "../routing/order";
import { toIso, toMs } from "../routing/time";
import { cmpStr, screenCandidates, type ScreenedOffer } from "./candidates";
import {
  ALGORITHM_VERSION,
  MATCH_LIMITS,
  MATCH_WEIGHTS,
  type MatchLimits,
  type MatchWeights,
} from "./constants";
import { scoreParts, type ScoreParts } from "./score";
import type {
  MatchCandidate,
  MatchNeed,
  MatchOptions,
  MatchPlan,
  MatchResult,
  PlanLine,
  PlanStop,
  SiteScore,
} from "./types";
import {
  ceilToQuantum,
  floorToQuantum,
  isContinuousUnit,
  isUnitCode,
  quantumOf,
  roundTo,
  toNeedUnits,
  type UnitCode,
} from "./units";

/**
 * Engine ghép đơn nhiều cửa hàng (ADR-007 §3–§4). Thuần, tất định, không IO.
 *
 * 1. Sàng lọc ứng viên (`screenCandidates`), gộp lô theo **điểm cửa hàng** (một điểm dừng có thể nhiều lô),
 *    chấm điểm từng điểm (`score.ts`), xếp hạng `score desc, site_id asc`.
 * 2. Duyệt **mọi** tổ hợp 1–3 điểm trong 12 điểm đầu (≤ 298 tổ hợp). Mỗi tổ hợp: cấp số lượng tham lam theo
 *    hạn hiệu lực sớm nhất trước (rồi điểm lô cao hơn, rồi `offer_id`), không vượt số khả dụng của lô, không vượt
 *    phần còn thiếu (trừ dung sai < 1 đơn vị khi quy đổi kg — §4.6), số nguyên với đơn vị đếm. Bỏ tổ hợp có điểm
 *    được cấp 0 (không tối giản) và tổ hợp không có thứ tự đi khả thi (`src/core/routing`).
 * 3. Xếp hạng: phủ (6 chữ số) giảm dần → số điểm dừng tăng dần → km tuyến ước lượng tăng dần → điểm trung bình
 *    giảm dần → danh sách `site_id`.
 * 4. Chưa phủ đủ: mở rộng tham lam tới 5 điểm (thêm điểm tăng phủ nhiều nhất, hòa thì điểm cao hơn rồi
 *    `site_id`), từ 3 tổ hợp đầu **và** từ tập rỗng (bảo đảm phủ của phương án 1 không giảm khi thêm ứng viên).
 * 5. Gộp, bỏ trùng tập điểm, trả tối đa 3 phương án.
 */

interface Site {
  siteId: string;
  storeOrgId: string;
  location: LatLng | null;
  hubKm: number;
  hubTravelMin: number | null;
  offers: ScreenedOffer[];
  availableNeedUnits: number;
  earliestDeadline: number;
  parts: ScoreParts;
  rank: number;
}

interface AllocLine {
  offer: ScreenedOffer;
  qty: number;
  needUnits: number;
}

interface Allocation {
  lines: AllocLine[];
  allocated: number;
  sitesUsed: Set<string>;
}

interface Draft {
  key: string;
  sites: Site[];
  alloc: Allocation;
  covered: number;
  coverage: number;
  route: RoutePlan;
  meanScore: number;
  source: "exact" | "extended";
}

interface Evaluation {
  draft: Draft | null;
  /** Điểm được cấp 0 (tổ hợp không tối giản). */
  zero: Site[];
}

interface Ctx {
  remaining: number;
  unit: UnitCode;
  at: number;
  neededBy: number;
  dropoff: { id: string; location: LatLng };
  travel: TravelConfig;
  limits: MatchLimits;
  allocRank: Map<string, number>;
  memo: Map<string, Evaluation>;
  combos: number;
  routes: number;
}

const setKey = (sites: readonly Site[]) => sites.map((s) => s.siteId).join("\u0000");
const byId = (a: Site, b: Site) => cmpStr(a.siteId, b.siteId);

function validateNeed(need: MatchNeed) {
  if (!need || !isUnitCode(need.unit)) throw new RangeError("Đơn vị của nhu cầu không hợp lệ");
  const remaining = Number(need.quantity);
  if (!Number.isFinite(remaining) || remaining <= 0) throw new RangeError("Số lượng cần phải lớn hơn 0");
  if (!isContinuousUnit(need.unit) && !Number.isInteger(remaining)) {
    throw new RangeError("Nhu cầu tính theo đơn vị đếm phải là số nguyên");
  }
  if (!Array.isArray(need.categoryCodes) || need.categoryCodes.length === 0) {
    throw new RangeError("Nhu cầu cần ít nhất một danh mục");
  }
  if (!isValidLatLng(need.siteLocation)) throw new RangeError("Điểm nhận thiếu toạ độ hợp lệ");
  if (!(Number(need.radiusKm) > 0)) throw new RangeError("Bán kính phải lớn hơn 0");
  return {
    remaining: roundTo(remaining, 3),
    at: toMs(need.at, "at"),
    neededBy: toMs(need.neededBy, "neededBy"),
  };
}

function resolveLimits(partial: Partial<MatchLimits> | undefined): MatchLimits {
  const l = { ...MATCH_LIMITS, ...partial };
  const intIn = (v: number, lo: number, hi: number) => Number.isInteger(v) && v >= lo && v <= hi;
  if (
    !intIn(l.topSites, 1, 30) ||
    !intIn(l.maxStops, 1, MAX_EXACT_STOPS) ||
    !intIn(l.maxExactStops, 1, l.maxStops) ||
    !intIn(l.maxPlans, 1, 3)
  ) {
    throw new RangeError("Giới hạn ghép đơn không hợp lệ");
  }
  return l;
}

function resolveWeights(w: MatchWeights | undefined): MatchWeights {
  const weights = { ...MATCH_WEIGHTS, ...w };
  if (Object.values(weights).some((v) => !Number.isFinite(v) || v < 0)) {
    throw new RangeError("Trọng số không hợp lệ");
  }
  return weights;
}

function buildSites(
  offers: readonly ScreenedOffer[],
  remaining: number,
  radiusKm: number,
  at: number,
  weights: MatchWeights,
): Site[] {
  const groups = new Map<string, ScreenedOffer[]>();
  for (const o of offers) {
    const list = groups.get(o.siteId);
    if (list) list.push(o);
    else groups.set(o.siteId, [o]);
  }
  const sites: Site[] = [];
  for (const [siteId, list] of groups) {
    // Lô quyết định độ gấp: hạn hiệu lực sớm nhất (ADR-007 §2), hòa thì offer_id nhỏ hơn
    const urgent = list.reduce((a, b) => (b.deadline < a.deadline ? b : a));
    const nearest = list.reduce((a, b) => (b.distanceKm < a.distanceKm ? b : a));
    const availableNeedUnits = roundTo(
      list.reduce((s, o) => s + o.needUnits, 0),
      6,
    );
    const trust = list.reduce<number | null>(
      (m, o) => (o.trustScore === null ? m : Math.max(m ?? o.trustScore, o.trustScore)),
      null,
    );
    sites.push({
      siteId,
      storeOrgId: list[0]!.storeOrgId,
      location: list.find((o) => o.location)?.location ?? null,
      hubKm: nearest.distanceKm,
      hubTravelMin: nearest.travelMin,
      offers: list,
      availableNeedUnits,
      earliestDeadline: urgent.deadline,
      parts: scoreParts(
        {
          effectiveDeadline: urgent.deadline,
          perishability: urgent.perishability,
          at,
          distanceKm: nearest.distanceKm,
          radiusKm,
          trustScore: trust,
          availableNeedUnits,
          remaining,
        },
        weights,
      ),
      rank: 0,
    });
  }
  sites.sort((a, b) => b.parts.score - a.parts.score || byId(a, b));
  sites.forEach((s, i) => (s.rank = i + 1));
  return sites;
}

/** Cấp số lượng tham lam trong một tổ hợp (ADR-007 §3.3). */
function allocate(ctx: Ctx, sites: readonly Site[]): Allocation {
  const offers = sites.flatMap((s) => s.offers);
  offers.sort((a, b) => ctx.allocRank.get(a.offerId)! - ctx.allocRank.get(b.offerId)!);
  const lines: AllocLine[] = [];
  const sitesUsed = new Set<string>();
  let allocated = 0;
  for (const o of offers) {
    const rest = roundTo(ctx.remaining - allocated, 6);
    if (roundTo(rest, 3) <= 0) break;
    const qty =
      o.unit === ctx.unit
        ? floorToQuantum(Math.min(o.qty, rest), quantumOf(o.unit))
        : Math.min(o.qty, ceilToQuantum(rest / o.unitWeightKg, quantumOf(o.unit)));
    if (!(qty > 0)) continue;
    const needUnits = roundTo(toNeedUnits(qty, o.unit, o.unitWeightKg, ctx.unit), 6);
    lines.push({ offer: o, qty, needUnits });
    sitesUsed.add(o.siteId);
    allocated = roundTo(allocated + needUnits, 6);
  }
  return { lines, allocated, sitesUsed };
}

function coveredOf(ctx: Ctx, allocated: number): number {
  return roundTo(Math.min(allocated, ctx.remaining), 3);
}

function evaluateSet(ctx: Ctx, sites: Site[]): Evaluation {
  const key = setKey(sites);
  const cached = ctx.memo.get(key);
  if (cached) return cached;
  const alloc = allocate(ctx, sites);
  const zero = sites.filter((s) => !alloc.sitesUsed.has(s.siteId));
  let result: Evaluation = { draft: null, zero };
  if (zero.length === 0) {
    const stops: RouteStop[] = sites.map((s) => {
      const lines = alloc.lines.filter((l) => l.offer.siteId === s.siteId);
      const ready = Math.max(...lines.map((l) => l.offer.readyAt ?? Number.NEGATIVE_INFINITY));
      return {
        id: s.siteId,
        location: s.location,
        hubKm: s.hubKm,
        hubTravelMin: s.hubTravelMin,
        readyAt: Number.isFinite(ready) ? ready : null,
        deadline: Math.min(...lines.map((l) => l.offer.deadline)),
      };
    });
    const route = bestOrder({ stops, dropoff: ctx.dropoff, departAt: ctx.at, config: ctx.travel });
    ctx.routes += route.evaluated;
    const covered = coveredOf(ctx, alloc.allocated);
    if (route.feasible && covered > 0) {
      result = {
        zero,
        draft: {
          key,
          sites,
          alloc,
          covered,
          coverage: covered >= ctx.remaining ? 1 : roundTo(covered / ctx.remaining, 6),
          route,
          meanScore: roundTo(sites.reduce((s, x) => s + x.parts.score, 0) / sites.length, 6),
          source: "exact",
        },
      };
    }
  }
  ctx.memo.set(key, result);
  return result;
}

function compareDrafts(a: Draft, b: Draft): number {
  return (
    b.coverage - a.coverage ||
    a.sites.length - b.sites.length ||
    a.route.distanceM - b.route.distanceM ||
    b.meanScore - a.meanScore ||
    cmpStr(a.key, b.key)
  );
}

function* combinations(n: number, k: number): Generator<number[]> {
  const idx = Array.from({ length: k }, (_, i) => i);
  while (true) {
    yield [...idx];
    let i = k - 1;
    while (i >= 0 && idx[i] === n - k + i) i--;
    if (i < 0) return;
    idx[i]!++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1]! + 1;
  }
}

/** Mở rộng tham lam một tập điểm tới khi phủ đủ hoặc đủ `maxStops` (ADR-007 §4). */
function extend(ctx: Ctx, all: readonly Site[], seed: Site[]): Draft | null {
  let current = seed;
  let covered = seed.length === 0 ? 0 : evaluateSet(ctx, seed).draft!.covered;
  for (let step = 0; step < ctx.limits.maxStops && current.length < ctx.limits.maxStops; step++) {
    if (covered >= ctx.remaining) break;
    const inSet = new Set(current.map((s) => s.siteId));
    const options: { site: Site; set: Site[]; gain: number }[] = [];
    for (const site of all) {
      if (inSet.has(site.siteId)) continue;
      const set = [...current, site].sort(byId);
      const gain = roundTo(coveredOf(ctx, allocate(ctx, set).allocated) - covered, 3);
      if (gain > 0) options.push({ site, set, gain });
    }
    options.sort(
      (a, b) => b.gain - a.gain || b.site.parts.score - a.site.parts.score || byId(a.site, b.site),
    );
    let next: Draft | null = null;
    for (const o of options) {
      let ev = evaluateSet(ctx, o.set);
      if (ev.zero.length > 0)
        ev = evaluateSet(
          ctx,
          o.set.filter((s) => !ev.zero.includes(s)),
        );
      if (ev.draft) {
        next = ev.draft;
        break;
      }
    }
    if (!next) break;
    current = next.sites;
    covered = next.covered;
  }
  return current.length === 0 ? null : evaluateSet(ctx, current).draft;
}

function round4(x: number): number {
  return roundTo(x, 4);
}

function siteScoreOf(site: Site): SiteScore {
  return {
    siteId: site.siteId,
    storeOrgId: site.storeOrgId,
    rank: site.rank,
    offerIds: site.offers.map((o) => o.offerId),
    availableNeedUnits: roundTo(site.availableNeedUnits, 3),
    distanceKm: roundTo(site.hubKm, 3),
    earliestDeadline: toIso(site.earliestDeadline),
    urgency: round4(site.parts.urgency),
    proximity: round4(site.parts.proximity),
    quantityFit: round4(site.parts.quantityFit),
    trust: round4(site.parts.trust),
    score: round4(site.parts.score),
  };
}

function toPlan(ctx: Ctx, d: Draft, rank: number, excludeSiteIds: readonly string[]): MatchPlan {
  const seq = new Map(d.route.order.map((id, i) => [id, i]));
  const siteById = new Map(d.sites.map((s) => [s.siteId, s]));
  const lines: PlanLine[] = d.alloc.lines
    .map(({ offer: o, qty, needUnits }): PlanLine => ({
      offerId: o.offerId,
      siteId: o.siteId,
      storeOrgId: o.storeOrgId,
      categoryCode: o.categoryCode,
      unit: o.unit,
      unitWeightKg: o.unitWeightKg,
      qty,
      needUnits: roundTo(needUnits, 3),
      qtyAvailable: o.qty,
      effectiveDeadline: toIso(o.deadline),
      perishability: o.perishability,
      label: o.label,
    }))
    .sort((a, b) => seq.get(a.siteId)! - seq.get(b.siteId)! || cmpStr(a.offerId, b.offerId));
  const stops: PlanStop[] = d.route.order.map((siteId, i) => {
    const leg = d.route.legs[i]!;
    const site = siteById.get(siteId)!;
    return {
      seq: i + 1,
      siteId,
      storeOrgId: site.storeOrgId,
      location: site.location,
      arriveAt: leg.arriveAt,
      serviceAt: leg.serviceAt,
      deadline: leg.deadline,
      offerIds: lines.filter((l) => l.siteId === siteId).map((l) => l.offerId),
    };
  });
  const shortfall = roundTo(ctx.remaining - d.covered, 3);
  const siteIds = d.sites.map((s) => s.siteId);
  return {
    rank,
    algorithmVersion: ALGORITHM_VERSION,
    source: d.source,
    siteIds,
    stopCount: siteIds.length,
    lines,
    stops,
    requestedQty: ctx.remaining,
    allocatedQty: roundTo(d.alloc.allocated, 3),
    coveredQty: d.covered,
    shortfall,
    coverage: d.coverage,
    route: d.route,
    estDistanceM: d.route.distanceM,
    estDurationS: d.route.durationS,
    score: round4(d.meanScore),
    scores: d.sites.map(siteScoreOf),
    redLots: lines.filter((l) => l.label === "red").length,
    warnings: Date.parse(d.route.endAt) > ctx.neededBy ? ["arrives_after_needed_by"] : [],
    rematch:
      shortfall > 0
        ? { remaining: shortfall, excludeSiteIds: [...new Set([...excludeSiteIds, ...siteIds])].sort(cmpStr) }
        : null,
  };
}

/**
 * Đề xuất tối đa 3 phương án ghép cho phần còn thiếu `need.quantity` từ các dòng `match_candidates`.
 * Không có ứng viên hợp lệ ⇒ `plans` rỗng (UI: giữ nhu cầu mở, ghép khi có lô mới).
 */
export function proposePlans(
  need: MatchNeed,
  candidates: readonly MatchCandidate[],
  options: MatchOptions = {},
): MatchResult {
  const { remaining, at, neededBy } = validateNeed(need);
  const travel = assertTravelConfig({ ...(options.travel ?? DEFAULT_TRAVEL_CONFIG) });
  const weights = resolveWeights(options.weights);
  const limits = resolveLimits(options.limits);
  const excludeSiteIds = [...new Set(options.excludeSiteIds ?? [])].sort(cmpStr);
  const radiusKm = Number(need.radiusKm);

  const screened = screenCandidates(candidates, {
    unit: need.unit,
    categoryCodes: need.categoryCodes,
    radiusKm,
    at,
    excludeSiteIds,
  });
  const sites = buildSites(screened.offers, remaining, radiusKm, at, weights);

  // Thứ tự cấp: hạn hiệu lực sớm trước → điểm lô cao hơn → offer_id
  const offerScore = new Map(
    screened.offers.map((o) => [
      o.offerId,
      scoreParts(
        {
          effectiveDeadline: o.deadline,
          perishability: o.perishability,
          at,
          distanceKm: o.distanceKm,
          radiusKm,
          trustScore: o.trustScore,
          availableNeedUnits: o.needUnits,
          remaining,
        },
        weights,
      ).score,
    ]),
  );
  const allocOrder = [...screened.offers].sort(
    (a, b) =>
      a.deadline - b.deadline ||
      offerScore.get(b.offerId)! - offerScore.get(a.offerId)! ||
      cmpStr(a.offerId, b.offerId),
  );

  const ctx: Ctx = {
    remaining,
    unit: need.unit,
    at,
    neededBy,
    dropoff: { id: need.siteId ?? "dropoff", location: need.siteLocation },
    travel,
    limits,
    allocRank: new Map(allocOrder.map((o, i) => [o.offerId, i])),
    memo: new Map(),
    combos: 0,
    routes: 0,
  };

  // Phần chính xác: mọi tổ hợp 1..3 điểm trong top 12
  const pool = new Map<string, Draft>();
  const top = sites.slice(0, limits.topSites);
  for (let k = 1; k <= Math.min(limits.maxExactStops, top.length); k++) {
    for (const idx of combinations(top.length, k)) {
      ctx.combos++;
      const ev = evaluateSet(ctx, idx.map((i) => top[i]!).sort(byId));
      if (ev.draft) pool.set(ev.draft.key, ev.draft);
    }
  }

  // Phần mở rộng tham lam khi chưa phủ đủ
  const ranked = [...pool.values()].sort(compareDrafts);
  if (sites.length > 0 && !(ranked[0]?.coverage === 1)) {
    const seeds = [...ranked.slice(0, limits.maxPlans).map((d) => d.sites), []];
    for (const seed of seeds) {
      const d = extend(ctx, sites, seed);
      if (d && !pool.has(d.key)) pool.set(d.key, { ...d, source: "extended" });
    }
  }

  const plans = [...pool.values()]
    .sort(compareDrafts)
    .slice(0, limits.maxPlans)
    .map((d, i) => toPlan(ctx, d, i + 1, excludeSiteIds));

  return {
    algorithmVersion: ALGORITHM_VERSION,
    inputs: {
      at: toIso(at),
      neededBy: toIso(neededBy),
      unit: need.unit,
      remaining,
      radiusKm,
      categoryCodes: [...need.categoryCodes],
      excludeSiteIds,
      travel: { ...travel },
      weights,
      limits,
    },
    plans,
    siteScores: sites.map(siteScoreOf),
    candidates: { total: candidates.length, used: screened.offers.length, dropped: screened.dropped },
    stats: { combosEvaluated: ctx.combos, routesEvaluated: ctx.routes },
  };
}

/**
 * Ghép lại phần thiếu (ADR-007 §4, US-CHA-12): chạy lại đúng thuật toán với R = `remaining`, loại các điểm
 * đã có phân bổ sống. Truyền thẳng `plan.rematch` của một phương án còn thiếu.
 */
export function rematch(
  need: MatchNeed,
  candidates: readonly MatchCandidate[],
  shortfall: { remaining: number; excludeSiteIds: readonly string[] },
  options: MatchOptions = {},
): MatchResult {
  return proposePlans({ ...need, quantity: shortfall.remaining }, candidates, {
    ...options,
    excludeSiteIds: [...(options.excludeSiteIds ?? []), ...shortfall.excludeSiteIds],
  });
}
