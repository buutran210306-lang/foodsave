/**
 * Điểm uy tín người mua (profiles.points, 0-100) và các khóa mua hàng.
 * Quy tắc: xem src/constants/orderPolicy.ts (CUSTOMER_REPUTATION) và đặc tả mục 2.5-2.6.
 */
import { ERROR_CODES } from "../constants/errors";
import { HTTP_STATUS } from "../constants/http";
import { CUSTOMER_REPUTATION, DAY_MS, NO_SHOW_BAN_COUNT, NO_SHOW_WINDOW_DAYS, RED_BAN_DAYS } from "../constants/orderPolicy";
import { AppError } from "../utils/appError";
import { logger } from "../utils/logger";
import { createNotification } from "./notificationService";
import { handleSupabaseError, supabaseAdmin } from "./supabaseService";

export const customerRank = (score: number): string => {
  if (score >= CUSTOMER_REPUTATION.trustedThreshold) return "Tin cậy";
  if (score >= CUSTOMER_REPUTATION.blockedBelow) return "Hạn chế";
  return "Chặn";
};

interface CustomerTrustRow {
  points: number | null;
  red_ban_until: string | null;
}

export interface CustomerTrustStatus {
  points: number;
  rank: string;
  red_ban_until: string | null;
  red_banned: boolean;
  blocked: boolean;
  no_show_count: number;
  no_show_limit: number;
  window_days: number;
}

const loadTrust = async (customerId: string): Promise<CustomerTrustRow> => {
  const { data, error } = await supabaseAdmin.from("profiles").select("points,red_ban_until").eq("id", customerId).single();
  if (error) handleSupabaseError(error, "Failed to load customer profile");
  return (data as CustomerTrustRow | null) ?? { points: null, red_ban_until: null };
};

const toScore = (points: number | null): number => {
  const value = Number(points);
  return Number.isFinite(value) ? value : CUSTOMER_REPUTATION.initialScore;
};

const formatVnDate = (iso: string): string =>
  new Date(iso).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric" });

export const customerReputationService = {
  /** Cộng/trừ điểm, giữ trong [0, 100], cập nhật hạng. Trả điểm mới. */
  async applyDelta(customerId: string, delta: number, reason: string): Promise<number> {
    const current = toScore((await loadTrust(customerId)).points);
    const next = Math.min(CUSTOMER_REPUTATION.maxScore, Math.max(0, current + delta));
    const { error } = await supabaseAdmin.from("profiles").update({ points: next, rank: customerRank(next) }).eq("id", customerId);
    if (error) handleSupabaseError(error, "Failed to update customer reputation");
    logger.info("Updated customer reputation score", { customerId, reason, delta, current, next });
    return next;
  },

  /** Điểm, hạng, khóa nhãn đỏ và số lần no-show trong 60 ngày gần nhất */
  async getStatus(customerId: string): Promise<CustomerTrustStatus> {
    const trust = await loadTrust(customerId);
    const points = toScore(trust.points);
    const since = new Date(Date.now() - NO_SHOW_WINDOW_DAYS * DAY_MS).toISOString();
    const { count, error } = await supabaseAdmin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", customerId)
      .eq("status", "no_show")
      .gte("no_show_at", since);
    if (error) handleSupabaseError(error, "Failed to count no-show orders");
    const redBanned = Boolean(trust.red_ban_until && new Date(trust.red_ban_until).getTime() > Date.now());
    return {
      points,
      rank: customerRank(points),
      red_ban_until: redBanned ? trust.red_ban_until : null,
      red_banned: redBanned,
      blocked: points < CUSTOMER_REPUTATION.blockedBelow,
      no_show_count: count ?? 0,
      no_show_limit: NO_SHOW_BAN_COUNT,
      window_days: NO_SHOW_WINDOW_DAYS
    };
  },

  /** Gọi khi tạo đơn: chặn nếu điểm < 40, hoặc mua nhãn đỏ khi đang bị khóa */
  async assertCanOrder(customerId: string, hasRedLabel: boolean): Promise<void> {
    const trust = await loadTrust(customerId);
    if (toScore(trust.points) < CUSTOMER_REPUTATION.blockedBelow) {
      throw new AppError(
        "Điểm uy tín của bạn đang dưới 40 nên tạm thời không đặt hàng được. Vui lòng liên hệ FoodSave để được hỗ trợ.",
        HTTP_STATUS.FORBIDDEN,
        ERROR_CODES.CUSTOMER_BLOCKED
      );
    }
    if (hasRedLabel && trust.red_ban_until && new Date(trust.red_ban_until).getTime() > Date.now()) {
      throw new AppError(
        `Bạn đang bị khóa mua sản phẩm nhãn đỏ đến ${formatVnDate(trust.red_ban_until)} vì vắng mặt nhiều lần. Bạn vẫn mua được sản phẩm nhãn xanh và vàng.`,
        HTTP_STATUS.FORBIDDEN,
        ERROR_CODES.RED_LABEL_BANNED,
        { red_ban_until: trust.red_ban_until }
      );
    }
  },

  /**
   * Ghi nhận một lần no-show: trừ 15 điểm, đếm 60 ngày. Đủ 3 lần -> khóa nhãn đỏ 30 ngày. Lần 2 -> cảnh báo.
   * Gọi SAU khi đơn đã được đặt status=no_show và no_show_at (để bộ đếm tính cả đơn này).
   */
  async recordNoShow(customerId: string, orderId: string): Promise<{ banned: boolean; count: number }> {
    await customerReputationService.applyDelta(customerId, CUSTOMER_REPUTATION.noShowDelta, "no_show");
    const status = await customerReputationService.getStatus(customerId);

    if (status.no_show_count >= NO_SHOW_BAN_COUNT) {
      const until = new Date(Date.now() + RED_BAN_DAYS * DAY_MS).toISOString();
      const { error } = await supabaseAdmin.from("profiles").update({ red_ban_until: until }).eq("id", customerId);
      if (error) handleSupabaseError(error, "Failed to set red label ban");
      await createNotification({
        recipientId: customerId,
        roleTarget: "customer",
        type: "red-label-banned",
        title: "Bạn bị khóa mua hàng nhãn đỏ 30 ngày",
        body: `Bạn đã vắng mặt ${status.no_show_count} lần trong ${NO_SHOW_WINDOW_DAYS} ngày. Khóa đến ${formatVnDate(until)}. Bạn vẫn mua được sản phẩm nhãn xanh và vàng.`,
        relatedType: "order",
        relatedId: orderId
      });
      return { banned: true, count: status.no_show_count };
    }

    if (status.no_show_count === NO_SHOW_BAN_COUNT - 1) {
      await createNotification({
        recipientId: customerId,
        roleTarget: "customer",
        type: "no-show-warning",
        title: "Cảnh báo: còn 1 lần nữa sẽ bị khóa",
        body: `Bạn đã vắng mặt ${status.no_show_count} lần. Thêm 1 lần nữa trong ${NO_SHOW_WINDOW_DAYS} ngày, bạn sẽ bị khóa mua hàng nhãn đỏ ${RED_BAN_DAYS} ngày.`,
        relatedType: "order",
        relatedId: orderId
      });
    }
    return { banned: false, count: status.no_show_count };
  },

  /** Admin mở khóa nhãn đỏ / chặn. Điểm dưới 40 được nâng lên đúng 40 để đặt hàng lại được. */
  async unlock(customerId: string, note: string | undefined): Promise<{ points: number; rank: string }> {
    const trust = await loadTrust(customerId);
    const points = Math.max(toScore(trust.points), CUSTOMER_REPUTATION.blockedBelow);
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ red_ban_until: null, points, rank: customerRank(points) })
      .eq("id", customerId);
    if (error) handleSupabaseError(error, "Failed to unlock customer");
    logger.info("Admin unlocked customer", { customerId, note });
    await createNotification({
      recipientId: customerId,
      roleTarget: "customer",
      type: "account-unlocked",
      title: "Tài khoản đã được mở khóa mua hàng",
      body: note ? `FoodSave đã mở khóa cho bạn. Ghi chú: ${note}` : "FoodSave đã mở khóa cho bạn, bạn có thể đặt hàng lại."
    });
    return { points, rank: customerRank(points) };
  }
};
