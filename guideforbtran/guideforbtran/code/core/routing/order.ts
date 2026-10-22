import { isValidLatLng } from "../geo/service-area";
import type { LatLng } from "../geo/types";
import { DEFAULT_TRAVEL_CONFIG, MAX_EXACT_STOPS, assertTravelConfig, type TravelConfig } from "./constants";
import { haversineKm, travelMinutes } from "./distance";
import { toIso, toMs, toMsOrNull, type TimeInput } from "./time";

/**
 * Thứ tự điểm lấy tối ưu cho một chuyến (ADR-007 §5, US-CHA-17): xuất phát từ `start` (mặc định là điểm
 * giao — điểm nhận của tổ chức), đi qua mọi điểm lấy, kết thúc ở điểm giao.
 *
 * - ≤ `MAX_EXACT_STOPS` (5) điểm: duyệt **mọi** hoán vị (≤ 120), tối ưu chính xác.
 * - Nhiều hơn: láng giềng gần nhất và "hạn sớm trước", mỗi bản cải thiện bằng 2-opt (không đảm bảo tối ưu).
 *
 * Khả thi: tới điểm trước `readyAt` (đầu khung lấy) thì chờ; bắt đầu lấy sau `deadline` (hạn hiệu lực) là trễ.
 * Thứ tự trễ bị loại; nếu mọi thứ tự đều trễ thì trả thứ tự trễ ít nhất với `feasible = false` (UI cảnh báo).
 * Xếp hạng: khả thi → (trễ ít nhất) → mục tiêu (`distance`: km rồi thời gian; `duration`: thời gian rồi km)
 * → thứ tự `id` từ điển (tất định).
 *
 * Khoảng cách: haversine × hệ số đường vòng. Điểm ẩn (không có toạ độ — DATA-MODEL §2.1 `sites.visibility`)
 * dùng `hubKm` (khoảng cách tới điểm giao do SQL tính) và cận trên bất đẳng thức tam giác qua điểm giao.
 */

const MINUTE = 60_000;

export interface RouteAnchor {
  id: string;
  location: LatLng;
}

export interface RouteStop {
  id: string;
  /** `null` ⇒ điểm ẩn: ước lượng qua `hubKm`. */
  location: LatLng | null;
  /** Khoảng cách chim bay (km) tới điểm giao — `match_candidates.distance_km`. Ưu tiên hơn toạ độ cho chặng nối điểm giao. */
  hubKm?: number | null;
  /** Thời gian (phút, đã gồm đệm) của chặng điểm giao ↔ điểm này — `match_candidates.travel_min`. */
  hubTravelMin?: number | null;
  /** Sớm nhất được lấy (đầu khung lấy). Tới sớm hơn thì chờ. */
  readyAt?: TimeInput | null;
  /** Muộn nhất được lấy (hạn hiệu lực sớm nhất của các lô lấy ở điểm này). */
  deadline?: TimeInput | null;
}

export type RouteObjective = "distance" | "duration";

export interface RouteInput {
  stops: readonly RouteStop[];
  /** Điểm giao (điểm nhận của tổ chức), luôn là điểm cuối. */
  dropoff: RouteAnchor;
  /** Điểm xuất phát (khu vực của tình nguyện viên); bỏ trống ⇒ xuất phát từ điểm giao. */
  start?: RouteAnchor | null;
  departAt: TimeInput;
  /** Hạn tới điểm giao (tùy chọn). */
  dropoffDeadline?: TimeInput | null;
  config?: TravelConfig;
  /** Mặc định `distance` (ADR-007 §5). `duration` cho "tổng thời gian nhỏ nhất" (US-CHA-17 AC1). */
  objective?: RouteObjective;
}

export interface RouteLeg {
  from: string;
  to: string;
  kind: "pickup" | "dropoff";
  crowKm: number;
  roadKm: number;
  /** Phút di chuyển của chặng, đã gồm đệm. */
  travelMin: number;
  arriveAt: string;
  /** Lúc bắt đầu lấy/giao = max(tới nơi, đầu khung lấy). */
  serviceAt: string;
  waitMin: number;
  deadline: string | null;
  lateMin: number;
}

export interface RoutePlan {
  /** `id` các điểm lấy theo thứ tự đi (không gồm điểm giao). */
  order: string[];
  /** `order.length + 1` chặng; chặng cuối về điểm giao. */
  legs: RouteLeg[];
  /** Quãng đường ước lượng (chim bay × hệ số), mét. */
  distanceM: number;
  /** Thời gian di chuyển + đệm, giây (không gồm thời gian chờ khung lấy). */
  durationS: number;
  waitS: number;
  /** Từ lúc xuất phát tới lúc tới điểm giao, giây (gồm chờ). */
  elapsedS: number;
  departAt: string;
  /** ETA tại điểm giao. */
  endAt: string;
  feasible: boolean;
  lateMin: number;
  method: "exact" | "heuristic" | "fixed";
  /** Số thứ tự đã đánh giá (phục vụ đo hiệu năng). */
  evaluated: number;
}

interface Ctx {
  n: number;
  /** `ids[0..n-1]` điểm lấy (đã sắp theo id), `ids[n]` điểm xuất phát, `ids[n+1]` điểm giao. */
  ids: string[];
  ready: number[];
  deadline: number[];
  /** Ma trận (n+2)×(n+2): km chim bay và phút di chuyển (gồm đệm). */
  km: Float64Array;
  min: Float64Array;
  departAt: number;
  endDeadline: number;
  config: TravelConfig;
  objective: RouteObjective;
}

interface Walk {
  dist: number;
  travel: number;
  wait: number;
  late: number;
  end: number;
}

function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function round(x: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(x * f) / f;
}

function compile(input: RouteInput): Ctx {
  const config = assertTravelConfig(input.config ?? DEFAULT_TRAVEL_CONFIG);
  const { dropoff } = input;
  if (!dropoff || !isValidLatLng(dropoff.location)) throw new RangeError("Điểm giao thiếu toạ độ hợp lệ");
  const start = input.start ?? null;
  if (start && !isValidLatLng(start.location)) throw new RangeError("Điểm xuất phát thiếu toạ độ hợp lệ");
  const startIsHub = start === null || start.id === dropoff.id;

  const stops = [...input.stops].sort((a, b) => cmpStr(a.id, b.id));
  const n = stops.length;
  if (n === 0) throw new RangeError("Tuyến cần ít nhất một điểm lấy");
  for (let i = 0; i < n; i++) {
    if (!stops[i]!.id) throw new RangeError("Điểm lấy thiếu id");
    if (i > 0 && stops[i]!.id === stops[i - 1]!.id) throw new RangeError(`Điểm lấy trùng: ${stops[i]!.id}`);
  }

  const located = stops.map((s) => (s.location && isValidLatLng(s.location) ? s.location : null));
  const hubKm = stops.map((s, i) => {
    if (typeof s.hubKm === "number" && Number.isFinite(s.hubKm) && s.hubKm >= 0) return s.hubKm;
    const p = located[i];
    if (!p) throw new RangeError(`Điểm ${s.id} thiếu toạ độ và khoảng cách tới điểm giao`);
    return haversineKm(dropoff.location, p);
  });
  const hubMin = stops.map((s, i) =>
    typeof s.hubTravelMin === "number" && Number.isFinite(s.hubTravelMin) && s.hubTravelMin >= 0
      ? s.hubTravelMin
      : travelMinutes(hubKm[i]!, config),
  );

  const N = n + 2;
  const START = n;
  const END = n + 1;
  const km = new Float64Array(N * N);
  const min = new Float64Array(N * N);
  const set = (a: number, b: number, d: number, m = travelMinutes(d, config)) => {
    km[a * N + b] = d;
    min[a * N + b] = m;
  };
  const startToHub = startIsHub ? 0 : haversineKm(start!.location, dropoff.location);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const a = located[i];
      const b = located[j];
      set(i, j, a && b ? haversineKm(a, b) : hubKm[i]! + hubKm[j]!);
    }
    set(i, END, hubKm[i]!, hubMin[i]);
    if (startIsHub) set(START, i, hubKm[i]!, hubMin[i]);
    else set(START, i, located[i] ? haversineKm(start!.location, located[i]!) : startToHub + hubKm[i]!);
  }

  const ids = stops.map((s) => s.id);
  ids.push(start?.id ?? dropoff.id, dropoff.id);
  return {
    n,
    ids,
    ready: stops.map((s) => toMsOrNull(s.readyAt, `readyAt của ${s.id}`) ?? Number.NEGATIVE_INFINITY),
    deadline: stops.map((s) => toMsOrNull(s.deadline, `deadline của ${s.id}`) ?? Number.POSITIVE_INFINITY),
    km,
    min,
    departAt: toMs(input.departAt, "departAt"),
    endDeadline: toMsOrNull(input.dropoffDeadline, "dropoffDeadline") ?? Number.POSITIVE_INFINITY,
    config,
    objective: input.objective ?? "distance",
  };
}

/** Đi theo `perm`; nếu có `legs` thì ghi chi tiết từng chặng. Một nguồn duy nhất cho đánh giá và kết quả. */
function walk(ctx: Ctx, perm: readonly number[], legs?: RouteLeg[]): Walk {
  const N = ctx.n + 2;
  let t = ctx.departAt;
  let prev = ctx.n;
  let dist = 0;
  let travel = 0;
  let wait = 0;
  let late = 0;
  const visit = (to: number, kind: RouteLeg["kind"], ready: number, deadline: number) => {
    const d = ctx.km[prev * N + to]!;
    const m = ctx.min[prev * N + to]!;
    const arrive = t + m * MINUTE;
    const service = Math.max(arrive, ready);
    const l = Math.max(0, service - deadline);
    dist += d;
    travel += m;
    wait += service - arrive;
    late += l;
    legs?.push({
      from: ctx.ids[prev]!,
      to: ctx.ids[to]!,
      kind,
      crowKm: round(d, 3),
      roadKm: round(d * ctx.config.detourFactor, 3),
      travelMin: round(m, 2),
      arriveAt: toIso(arrive),
      serviceAt: toIso(service),
      waitMin: round((service - arrive) / MINUTE, 2),
      deadline: Number.isFinite(deadline) ? toIso(deadline) : null,
      lateMin: round(l / MINUTE, 2),
    });
    t = service;
    prev = to;
  };
  for (const i of perm) visit(i, "pickup", ctx.ready[i]!, ctx.deadline[i]!);
  visit(ctx.n + 1, "dropoff", Number.NEGATIVE_INFINITY, ctx.endDeadline);
  return { dist, travel, wait, late, end: t };
}

/** Khóa so sánh (nhỏ hơn là tốt hơn); làm tròn mét/giây để không phụ thuộc sai số cộng dồn. */
function rankKey(ctx: Ctx, w: Walk): [number, number, number, number] {
  const infeasible = w.late > 0 ? 1 : 0;
  const lateS = Math.round(w.late / 1000);
  const distM = Math.round(w.dist * ctx.config.detourFactor * 1000);
  const elapsedS = Math.round((w.end - ctx.departAt) / 1000);
  return ctx.objective === "duration"
    ? [infeasible, lateS, elapsedS, distM]
    : [infeasible, lateS, distM, elapsedS];
}

function lessKey(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i++) {
    if (a[i]! !== b[i]!) return a[i]! < b[i]!;
  }
  return false;
}

interface Search {
  perm: number[];
  evaluated: number;
}

/** Duyệt mọi hoán vị theo thứ tự từ điển của id; chỉ thay khi tốt hơn hẳn ⇒ hòa thì giữ thứ tự id nhỏ hơn. */
function exactSearch(ctx: Ctx): Search {
  const used = new Array<boolean>(ctx.n).fill(false);
  const perm: number[] = [];
  let best: number[] = [];
  let bestKey: number[] | null = null;
  let evaluated = 0;
  const rec = () => {
    if (perm.length === ctx.n) {
      evaluated++;
      const key = rankKey(ctx, walk(ctx, perm));
      if (bestKey === null || lessKey(key, bestKey)) {
        bestKey = key;
        best = [...perm];
      }
      return;
    }
    for (let i = 0; i < ctx.n; i++) {
      if (used[i]) continue;
      used[i] = true;
      perm.push(i);
      rec();
      perm.pop();
      used[i] = false;
    }
  };
  rec();
  return { perm: best, evaluated };
}

function nearestNeighbour(ctx: Ctx): number[] {
  const N = ctx.n + 2;
  const left = new Set(Array.from({ length: ctx.n }, (_, i) => i));
  const out: number[] = [];
  let cur = ctx.n;
  while (left.size > 0) {
    let next = -1;
    for (const j of left) {
      if (next === -1 || ctx.km[cur * N + j]! < ctx.km[cur * N + next]!) next = j;
    }
    out.push(next);
    left.delete(next);
    cur = next;
  }
  return out;
}

function earliestDeadline(ctx: Ctx): number[] {
  return Array.from({ length: ctx.n }, (_, i) => i).sort(
    (a, b) => ctx.deadline[a]! - ctx.deadline[b]! || ctx.ready[a]! - ctx.ready[b]! || a - b,
  );
}

function twoOpt(ctx: Ctx, seed: number[], counter: { evaluated: number }): { perm: number[]; key: number[] } {
  let best = seed;
  let bestKey: number[] = rankKey(ctx, walk(ctx, best));
  counter.evaluated++;
  for (let pass = 0, improved = true; improved && pass < 50; pass++) {
    improved = false;
    for (let i = 0; i < ctx.n - 1; i++) {
      for (let k = i + 1; k < ctx.n; k++) {
        const cand = [...best.slice(0, i), ...best.slice(i, k + 1).reverse(), ...best.slice(k + 1)];
        const key = rankKey(ctx, walk(ctx, cand));
        counter.evaluated++;
        if (lessKey(key, bestKey)) {
          best = cand;
          bestKey = key;
          improved = true;
        }
      }
    }
  }
  return { perm: best, key: bestKey };
}

function heuristicSearch(ctx: Ctx): Search {
  const counter = { evaluated: 0 };
  const a = twoOpt(ctx, nearestNeighbour(ctx), counter);
  const b = twoOpt(ctx, earliestDeadline(ctx), counter);
  return { perm: lessKey(b.key, a.key) ? b.perm : a.perm, evaluated: counter.evaluated };
}

function buildPlan(
  ctx: Ctx,
  perm: readonly number[],
  method: RoutePlan["method"],
  evaluated: number,
): RoutePlan {
  const legs: RouteLeg[] = [];
  const w = walk(ctx, perm, legs);
  return {
    order: perm.map((i) => ctx.ids[i]!),
    legs,
    distanceM: Math.round(w.dist * ctx.config.detourFactor * 1000),
    durationS: Math.round(w.travel * 60),
    waitS: Math.round(w.wait / 1000),
    elapsedS: Math.round((w.end - ctx.departAt) / 1000),
    departAt: toIso(ctx.departAt),
    endAt: toIso(w.end),
    feasible: w.late <= 0,
    lateMin: round(w.late / MINUTE, 2),
    method,
    evaluated,
  };
}

/** Thứ tự đi tốt nhất (xem mô tả đầu file). Tất định: cùng đầu vào (kể cả hoán vị `stops`) ⇒ cùng kết quả. */
export function bestOrder(input: RouteInput): RoutePlan {
  const ctx = compile(input);
  const search = ctx.n <= MAX_EXACT_STOPS ? exactSearch(ctx) : heuristicSearch(ctx);
  return buildPlan(ctx, search.perm, ctx.n <= MAX_EXACT_STOPS ? "exact" : "heuristic", search.evaluated);
}

/** Ước lượng một thứ tự cho trước (`order` phải là hoán vị các `id` điểm lấy) — ví dụ khi điều phối viên tự sắp. */
export function estimateRoute(input: RouteInput, order: readonly string[]): RoutePlan {
  const ctx = compile(input);
  const index = new Map(ctx.ids.slice(0, ctx.n).map((id, i) => [id, i]));
  const perm = order.map((id) => index.get(id));
  if (perm.length !== ctx.n || perm.some((i) => i === undefined) || new Set(perm).size !== ctx.n) {
    throw new RangeError("order phải là hoán vị của các điểm lấy");
  }
  return buildPlan(ctx, perm as number[], "fixed", 1);
}
