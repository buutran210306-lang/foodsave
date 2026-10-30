import { bestOrder, type RouteAnchor, type RouteInput, type RoutePlan } from "./order";

/**
 * Chia điểm lấy của một phương án cho 2 tình nguyện viên ("2 TNV chia tuyến", US-CHA-16, ROADMAP P3-09).
 * Duyệt mọi cách chia thành 2 nhóm khác rỗng (2ⁿ − 2, n ≤ `MAX_SPLIT_STOPS`); mỗi nhóm lấy thứ tự tốt nhất
 * bằng `bestOrder`, xuất phát từ khu vực của TNV đó (nếu có) và cùng kết thúc ở điểm giao.
 * Xếp hạng: cả hai tuyến khả thi → tổng phút trễ → thời gian của tuyến dài hơn (cân bằng theo thời gian)
 * → tổng thời gian → tổng km → cách chia đầu tiên theo thứ tự id (tất định).
 */

export const MAX_SPLIT_STOPS = 10;

export interface SplitInput extends Omit<RouteInput, "start"> {
  /** Khu vực xuất phát (gần đúng) của TNV 1 và TNV 2; thiếu ⇒ xuất phát từ điểm giao. */
  bases?: readonly [RouteAnchor | null | undefined, RouteAnchor | null | undefined] | null;
}

export interface SplitPlan {
  /** `routes[0]` cho TNV 1, `routes[1]` cho TNV 2; mỗi tuyến có ít nhất một điểm lấy. */
  routes: [RoutePlan, RoutePlan];
  /** Thời gian của tuyến dài hơn (giây). */
  makespanS: number;
  /** Chênh lệch thời gian giữa hai tuyến (giây). */
  imbalanceS: number;
  feasible: boolean;
  evaluated: number;
}

function lessKey(a: readonly number[], b: readonly number[]): boolean {
  const i = a.findIndex((v, k) => v !== b[k]);
  return i !== -1 && a[i]! < b[i]!;
}

export function splitBetweenTwo(input: SplitInput): SplitPlan {
  const { bases, stops: rawStops, ...rest } = input;
  const stops = [...rawStops].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const n = stops.length;
  if (n < 2) throw new RangeError("Cần ít nhất 2 điểm lấy để chia cho 2 tình nguyện viên");
  if (n > MAX_SPLIT_STOPS) throw new RangeError(`Chỉ chia được tối đa ${MAX_SPLIT_STOPS} điểm lấy`);

  let best: { routes: [RoutePlan, RoutePlan]; key: number[] } | null = null;
  let evaluated = 0;
  for (let mask = 1; mask < (1 << n) - 1; mask++) {
    const first = stops.filter((_, i) => (mask & (1 << i)) !== 0);
    const second = stops.filter((_, i) => (mask & (1 << i)) === 0);
    const r0 = bestOrder({ ...rest, stops: first, start: bases?.[0] ?? null });
    const r1 = bestOrder({ ...rest, stops: second, start: bases?.[1] ?? null });
    evaluated += r0.evaluated + r1.evaluated;
    const key = [
      r0.feasible && r1.feasible ? 0 : 1,
      Math.round((r0.lateMin + r1.lateMin) * 60),
      Math.max(r0.elapsedS, r1.elapsedS),
      r0.elapsedS + r1.elapsedS,
      r0.distanceM + r1.distanceM,
    ];
    if (best === null || lessKey(key, best.key)) best = { routes: [r0, r1], key };
  }
  const [r0, r1] = best!.routes;
  return {
    routes: [r0, r1],
    makespanS: Math.max(r0.elapsedS, r1.elapsedS),
    imbalanceS: Math.abs(r0.elapsedS - r1.elapsedS),
    feasible: r0.feasible && r1.feasible,
    evaluated,
  };
}
