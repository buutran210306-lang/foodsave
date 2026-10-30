/**
 * Chính sách đơn hàng trả trước: MỌI con số nghiệp vụ nằm ở đây để chỉnh một chỗ.
 * Phút/giờ dưới đây là giá trị THẬT; khi DEMO_MODE bật, ORDER_POLICY_TIME_SCALE (<1) rút ngắn để thử nhanh.
 */
import { env } from "../config/env";
import type { ProductLabel } from "../types/domain";

export interface LabelPolicy {
  /** Hạn thanh toán sau khi đặt (phút) */
  payMinutes: number;
  /** Hạn lấy hàng sau khi thanh toán (phút) */
  pickupMinutes: number;
  /** Hủy miễn phí đến trước hạn lấy bao nhiêu phút */
  cancelFreeBeforePickupMinutes: number;
  /** Nhắc cuối khi còn tối đa bấy nhiêu phút tới hạn lấy */
  finalReminderMinutes: number;
}

export const LABEL_POLICY: Record<ProductLabel, LabelPolicy> = {
  green: { payMinutes: 10, pickupMinutes: 120, cancelFreeBeforePickupMinutes: 30, finalReminderMinutes: 15 },
  yellow: { payMinutes: 10, pickupMinutes: 90, cancelFreeBeforePickupMinutes: 20, finalReminderMinutes: 15 },
  red: { payMinutes: 5, pickupMinutes: 60, cancelFreeBeforePickupMinutes: 15, finalReminderMinutes: 10 }
};

/** 3 phút đầu sau thanh toán luôn được hủy miễn phí (sửa đặt nhầm) */
export let GRACE_CANCEL_MINUTES = 3;
/** Còn ít hơn số phút này tới hạn sử dụng thì không cho đặt / không trả hàng về kho */
export let MIN_PICKUP_WINDOW_MINUTES = 15;
/** Cửa hàng được xác nhận hoàn tất trễ tối đa bấy nhiêu phút sau hạn lấy */
export const COMPLETE_GRACE_MINUTES = 5;

export let NO_SHOW_BAN_COUNT = 3;
export let NO_SHOW_WINDOW_DAYS = 60;
export let RED_BAN_DAYS = 30;

export const COMPLAINT_WINDOW_COOKED_HOURS = 12;
export const COMPLAINT_WINDOW_OTHER_HOURS = 24;
export const COMPLAINT_STORE_RESPONSE_HOURS = 12;
export const MIN_WITHDRAWAL = 50000;

export const CHAT_MAX_LENGTH = 500;
export const CHAT_MAX_PER_MINUTE = 20;
export const CHAT_RETENTION_DAYS = 30;

/** Điểm uy tín người mua (0-100) */
export const CUSTOMER_REPUTATION = {
  initialScore: 100,
  maxScore: 100,
  pickupSuccessDelta: 5,
  noShowDelta: -15,
  lateCancelDelta: -5,
  falseComplaintDelta: -10,
  trustedThreshold: 85,
  /** Dưới ngưỡng này (< 40) là "Chặn": không cho tạo đơn */
  blockedBelow: 40
} as const;

/**
 * Cấu hình chỉnh được từ Admin (bảng order_policy_config, SQL 036). Giá trị mặc định ở trên là phương án dự phòng
 * khi bảng chưa có / không đọc được. Áp dụng tại chỗ (các export "let" và LABEL_POLICY được sửa trực tiếp) nên mã đang dùng
 * hằng số không cần đổi. Đơn đã tạo giữ nguyên các hạn đã lưu trong cột (pickup_deadline, cancel_free_until...).
 */
export interface PolicyConfig {
  labels: Record<ProductLabel, LabelPolicy>;
  grace_cancel_minutes: number;
  min_pickup_window_minutes: number;
  no_show_ban_count: number;
  no_show_window_days: number;
  red_ban_days: number;
}

const DEFAULT_LABELS: Record<ProductLabel, LabelPolicy> = {
  green: { ...LABEL_POLICY.green },
  yellow: { ...LABEL_POLICY.yellow },
  red: { ...LABEL_POLICY.red }
};

export const currentPolicy = (): PolicyConfig => ({
  labels: { green: { ...LABEL_POLICY.green }, yellow: { ...LABEL_POLICY.yellow }, red: { ...LABEL_POLICY.red } },
  grace_cancel_minutes: GRACE_CANCEL_MINUTES,
  min_pickup_window_minutes: MIN_PICKUP_WINDOW_MINUTES,
  no_show_ban_count: NO_SHOW_BAN_COUNT,
  no_show_window_days: NO_SHOW_WINDOW_DAYS,
  red_ban_days: RED_BAN_DAYS
});

export const defaultPolicy = (): PolicyConfig => ({
  labels: { green: { ...DEFAULT_LABELS.green }, yellow: { ...DEFAULT_LABELS.yellow }, red: { ...DEFAULT_LABELS.red } },
  grace_cancel_minutes: 3,
  min_pickup_window_minutes: 15,
  no_show_ban_count: 3,
  no_show_window_days: 60,
  red_ban_days: 30
});

export const applyPolicy = (config: PolicyConfig): void => {
  for (const label of ["green", "yellow", "red"] as const) Object.assign(LABEL_POLICY[label], config.labels[label]);
  GRACE_CANCEL_MINUTES = config.grace_cancel_minutes;
  MIN_PICKUP_WINDOW_MINUTES = config.min_pickup_window_minutes;
  NO_SHOW_BAN_COUNT = config.no_show_ban_count;
  NO_SHOW_WINDOW_DAYS = config.no_show_window_days;
  RED_BAN_DAYS = config.red_ban_days;
};

/** Hệ số rút ngắn thời gian. Luôn bằng 1 ở môi trường thật (chỉ nhận khi DEMO_MODE bật). */
export const timeScale = (): number => (env.DEMO_MODE ? env.ORDER_POLICY_TIME_SCALE : 1);

export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

/** Số phút thật -> mili giây đã áp hệ số demo */
export const policyMs = (minutes: number): number => Math.round(minutes * MINUTE_MS * timeScale());
export const policyHoursMs = (hours: number): number => Math.round(hours * HOUR_MS * timeScale());

const LABEL_RANK: Record<ProductLabel, number> = { green: 1, yellow: 2, red: 3 };

/** Nhãn của đơn = nhãn khẩn cấp nhất trong các sản phẩm (đỏ > vàng > xanh) */
export const mostUrgentLabel = (labels: Array<ProductLabel | string | null | undefined>): ProductLabel => {
  let result: ProductLabel = "green";
  for (const label of labels) {
    if (label === "green" || label === "yellow" || label === "red") {
      if (LABEL_RANK[label] > LABEL_RANK[result]) result = label;
    }
  }
  return result;
};

/** Mốc sớm nhất trong các hạn hiệu lực (ms). Rỗng -> null */
export const earliestDeadline = (isoDates: Array<string | null | undefined>): number | null => {
  const times = isoDates
    .map((value) => (value ? new Date(value).getTime() : Number.NaN))
    .filter((time) => Number.isFinite(time));
  return times.length > 0 ? Math.min(...times) : null;
};

export interface PaymentTimeline {
  pickupDeadline: Date;
  cancelFreeUntil: Date;
}

/**
 * pickup_deadline = min(paid_at + hạn_lấy_theo_nhãn, hạn hiệu lực sớm nhất của sản phẩm)
 * cancel_free_until = max(paid_at + 3 phút, pickup_deadline - hạn_tự_hủy_theo_nhãn)
 */
export const computePaymentTimeline = (label: ProductLabel, paidAt: Date, productDeadlineMs: number | null): PaymentTimeline => {
  const policy = LABEL_POLICY[label];
  const byLabel = paidAt.getTime() + policyMs(policy.pickupMinutes);
  const pickupMs = productDeadlineMs === null ? byLabel : Math.min(byLabel, productDeadlineMs);
  const graceMs = paidAt.getTime() + policyMs(GRACE_CANCEL_MINUTES);
  const cancelFreeMs = Math.max(graceMs, pickupMs - policyMs(policy.cancelFreeBeforePickupMinutes));
  return { pickupDeadline: new Date(pickupMs), cancelFreeUntil: new Date(cancelFreeMs) };
};

/** Lúc tạo đơn: đủ thời gian để thanh toán rồi còn ít nhất 15 phút lấy hàng không? */
export const hasEnoughTimeToOrder = (label: ProductLabel, nowMs: number, productDeadlineMs: number | null): boolean => {
  if (productDeadlineMs === null) return true;
  const need = policyMs(LABEL_POLICY[label].payMinutes) + policyMs(MIN_PICKUP_WINDOW_MINUTES);
  return productDeadlineMs - nowMs >= need;
};
