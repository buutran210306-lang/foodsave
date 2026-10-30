/**
 * Cấu hình chính sách đơn hàng chỉnh được từ Admin.
 * - Đọc bảng order_policy_config (SQL 036), nhớ tạm 30 giây; không đọc được / chưa có bảng -> dùng giá trị hiện tại trong bộ nhớ
 *   (mặc định là hằng số trong orderPolicy.ts), KHÔNG làm hỏng luồng đặt hàng.
 * - Lưu: kiểm tra hợp lệ trước, rồi mới ghi + áp dụng + ghi nhật ký. Đơn đã tạo giữ nguyên các hạn đã lưu.
 */
import { ERROR_CODES } from "../constants/errors";
import { HTTP_STATUS } from "../constants/http";
import { applyPolicy, currentPolicy, defaultPolicy, type PolicyConfig } from "../constants/orderPolicy";
import { AppError } from "../utils/appError";
import { logger } from "../utils/logger";
import { adminAuditService, type AuditActor } from "./adminAuditService";
import { supabaseAdmin } from "./supabaseService";

const CACHE_MS = 30_000;
let loadedAt = 0;
let loading: Promise<void> | null = null;

const isInt = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;

/** Trả về danh sách lỗi (tiếng Việt). Rỗng = hợp lệ. */
export const validatePolicy = (config: PolicyConfig): string[] => {
  const errors: string[] = [];
  const names = { green: "Xanh", yellow: "Vàng", red: "Đỏ" } as const;
  for (const label of ["green", "yellow", "red"] as const) {
    const p = config.labels?.[label];
    if (!p) { errors.push(`Thiếu cấu hình nhãn ${names[label]}`); continue; }
    if (!isInt(p.payMinutes, 1, 60)) errors.push(`Nhãn ${names[label]}: hạn thanh toán phải từ 1 đến 60 phút`);
    if (!isInt(p.pickupMinutes, 15, 1440)) errors.push(`Nhãn ${names[label]}: hạn lấy hàng phải từ 15 đến 1440 phút`);
    if (!isInt(p.cancelFreeBeforePickupMinutes, 1, 1440)) errors.push(`Nhãn ${names[label]}: hủy miễn phí phải từ 1 đến 1440 phút`);
    if (!isInt(p.finalReminderMinutes, 1, 1440)) errors.push(`Nhãn ${names[label]}: nhắc cuối phải từ 1 đến 1440 phút`);
    if (isInt(p.pickupMinutes, 15, 1440) && isInt(p.cancelFreeBeforePickupMinutes, 1, 1440) && p.cancelFreeBeforePickupMinutes >= p.pickupMinutes) {
      errors.push(`Nhãn ${names[label]}: thời gian hủy miễn phí (${p.cancelFreeBeforePickupMinutes}) phải nhỏ hơn hạn lấy hàng (${p.pickupMinutes})`);
    }
    if (isInt(p.pickupMinutes, 15, 1440) && isInt(p.finalReminderMinutes, 1, 1440) && p.finalReminderMinutes >= p.pickupMinutes) {
      errors.push(`Nhãn ${names[label]}: mốc nhắc cuối (${p.finalReminderMinutes}) phải nhỏ hơn hạn lấy hàng (${p.pickupMinutes})`);
    }
  }
  if (!isInt(config.grace_cancel_minutes, 0, 30)) errors.push("Hủy miễn phí cực ngắn phải từ 0 đến 30 phút");
  else {
    for (const label of ["green", "yellow", "red"] as const) {
      const p = config.labels?.[label];
      if (p && isInt(p.pickupMinutes, 15, 1440) && config.grace_cancel_minutes >= p.pickupMinutes) {
        errors.push(`Hủy miễn phí cực ngắn (${config.grace_cancel_minutes}) phải nhỏ hơn hạn lấy hàng của nhãn ${names[label]}`);
      }
    }
  }
  if (!isInt(config.min_pickup_window_minutes, 5, 240)) errors.push("Thời gian lấy hàng tối thiểu phải từ 5 đến 240 phút");
  if (!isInt(config.no_show_ban_count, 2, 10)) errors.push("Số lần vắng mặt để khóa nhãn đỏ phải từ 2 đến 10");
  if (!isInt(config.no_show_window_days, 7, 365)) errors.push("Khoảng ngày tính vắng mặt phải từ 7 đến 365");
  if (!isInt(config.red_ban_days, 1, 365)) errors.push("Số ngày khóa nhãn đỏ phải từ 1 đến 365");
  return errors;
};

const sanitize = (raw: unknown): PolicyConfig | null => {
  if (!raw || typeof raw !== "object") return null;
  const base = defaultPolicy();
  const value = raw as Partial<PolicyConfig>;
  const merged: PolicyConfig = {
    labels: {
      green: { ...base.labels.green, ...(value.labels?.green ?? {}) },
      yellow: { ...base.labels.yellow, ...(value.labels?.yellow ?? {}) },
      red: { ...base.labels.red, ...(value.labels?.red ?? {}) }
    },
    grace_cancel_minutes: value.grace_cancel_minutes ?? base.grace_cancel_minutes,
    min_pickup_window_minutes: value.min_pickup_window_minutes ?? base.min_pickup_window_minutes,
    no_show_ban_count: value.no_show_ban_count ?? base.no_show_ban_count,
    no_show_window_days: value.no_show_window_days ?? base.no_show_window_days,
    red_ban_days: value.red_ban_days ?? base.red_ban_days
  };
  // Dữ liệu trong DB hỏng / sai luật: bỏ qua, dùng giá trị đang chạy
  return validatePolicy(merged).length === 0 ? merged : null;
};

const loadFromDb = async (): Promise<void> => {
  try {
    const { data, error } = await supabaseAdmin.from("order_policy_config").select("config").eq("id", 1).maybeSingle();
    if (error) { logger.warn("Không đọc được order_policy_config, dùng cấu hình hiện tại", { error }); return; }
    const config = sanitize((data as { config?: unknown } | null)?.config);
    if (config) applyPolicy(config);
  } catch (error) {
    logger.warn("Không đọc được order_policy_config, dùng cấu hình hiện tại", { error });
  }
};

export const policyConfigService = {
  /** Gọi ở đầu các luồng đặt/thanh toán/tự động: làm mới nếu đã quá 30 giây. Không bao giờ ném lỗi. */
  async ensureFresh(): Promise<void> {
    if (Date.now() - loadedAt < CACHE_MS) return;
    if (!loading) {
      loading = loadFromDb().finally(() => { loadedAt = Date.now(); loading = null; });
    }
    await loading;
  },

  /** Ép đọc lại ở lần gọi sau */
  invalidate(): void { loadedAt = 0; },

  async get(): Promise<{ config: PolicyConfig; updated_at: string | null; updated_by: string | null; stored: boolean }> {
    loadedAt = 0;
    await this.ensureFresh();
    const { data } = await supabaseAdmin.from("order_policy_config").select("updated_at,updated_by").eq("id", 1).maybeSingle();
    const row = data as { updated_at?: string; updated_by?: string } | null;
    return { config: currentPolicy(), updated_at: row?.updated_at ?? null, updated_by: row?.updated_by ?? null, stored: Boolean(row) };
  },

  async save(config: PolicyConfig, actor: AuditActor): Promise<PolicyConfig> {
    const errors = validatePolicy(config);
    if (errors.length > 0) throw new AppError(errors.join("; "), HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
    const before = currentPolicy();
    const { error } = await supabaseAdmin.from("order_policy_config").upsert(
      { id: 1, config, updated_by: actor.userId, updated_at: new Date().toISOString() },
      { onConflict: "id" }
    );
    if (error) throw new AppError("Chưa lưu được cấu hình. Hãy chắc chắn đã chạy SQL 036_admin_ops.sql.", HTTP_STATUS.CONFLICT, ERROR_CODES.SUPABASE_ERROR);
    applyPolicy(config);
    loadedAt = Date.now();
    await adminAuditService.log(actor, "policy.update", "order_policy", "1", { before, after: config });
    return currentPolicy();
  },

  /** Đưa về mặc định trong code (ghi như một lần lưu) */
  async reset(actor: AuditActor): Promise<PolicyConfig> {
    return this.save(defaultPolicy(), actor);
  }
};
