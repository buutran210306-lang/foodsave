/**
 * Engine nhãn tươi (ADR-005) — bản TypeScript của `public.freshness_label` (DATA-MODEL §8.1).
 * Thuần, không IO. Ngưỡng label_rules version 1; mọi thay đổi phải sửa đồng thời SQL + fixtures.json.
 */

export type Perishability = "cooked" | "fresh" | "packaged";
export type FreshnessLabel = "green" | "yellow" | "red" | "expired";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Ngưỡng v1: còn < red ⇒ Đỏ; ≤ yellow ⇒ Vàng; còn lại Xanh. */
export const LABEL_THRESHOLDS_V1: Record<Perishability, { redBelowMs: number; yellowAtMostMs: number }> = {
  cooked: { redBelowMs: 4 * HOUR, yellowAtMostMs: 12 * HOUR },
  fresh: { redBelowMs: 24 * HOUR, yellowAtMostMs: 72 * HOUR },
  packaged: { redBelowMs: 3 * DAY, yellowAtMostMs: 7 * DAY },
};

/** Thứ tự ưu tiên hiển thị: Đỏ → Vàng → Xanh → Hết hạn. */
export const LABEL_PRIORITY: Record<FreshnessLabel, number> = { red: 0, yellow: 1, green: 2, expired: 3 };

export function freshnessLabel(deadline: Date, perishability: Perishability, at: Date): FreshnessLabel {
  const remaining = deadline.getTime() - at.getTime();
  if (remaining <= 0) return "expired";
  const t = LABEL_THRESHOLDS_V1[perishability];
  if (remaining < t.redBelowMs) return "red";
  if (remaining <= t.yellowAtMostMs) return "yellow";
  return "green";
}

/**
 * Thời điểm nhãn đổi lần tới (để đếm ngược / lên lịch cảnh báo "chuyển Đỏ").
 * Trả null khi đã hết hạn.
 */
export function nextLabelChangeAt(deadline: Date, perishability: Perishability, at: Date): Date | null {
  const t = LABEL_THRESHOLDS_V1[perishability];
  const d = deadline.getTime();
  switch (freshnessLabel(deadline, perishability, at)) {
    case "green":
      return new Date(d - t.yellowAtMostMs); // tại đúng mốc này nhãn thành Vàng
    case "yellow":
      return new Date(d - t.redBelowMs + 1); // ngay sau mốc 4h/24h/3d còn lại ⇒ Đỏ
    case "red":
      return new Date(d);
    case "expired":
      return null;
  }
}

/** Hạn hiệu lực = mốc đến trước trong các mốc có giá trị (DATA-MODEL §4.2). */
export function effectiveDeadline(input: {
  expiresAt: Date;
  pickupWindowEnd?: Date | null;
  siteCloseAt?: Date | null;
}): Date {
  const candidates = [input.expiresAt, input.pickupWindowEnd, input.siteCloseAt].filter(
    (d): d is Date => d instanceof Date,
  );
  return new Date(Math.min(...candidates.map((d) => d.getTime())));
}

const VN_OFFSET = "+07:00"; // Asia/Ho_Chi_Minh không có giờ mùa hè

/** Hạn chỉ có ngày ⇒ 23:59 giờ Việt Nam ngày đó (DATA-MODEL §4.3). */
export function dateOnlyExpiry(date: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`invalid_date: ${date}`);
  return new Date(`${date}T23:59:00${VN_OFFSET}`);
}
