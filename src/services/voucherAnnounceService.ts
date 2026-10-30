/**
 * Báo "Có voucher mới" cho người mua, ĐÚNG MỘT LẦN cho mỗi voucher vừa tạo (gọi ngay sau khi tạo, không gọi khi bật/tắt lại).
 *  - Voucher toàn hệ thống (store_id rỗng, do Admin tạo): một thông báo theo vai trò "customer" (ai cũng thấy ở chuông)
 *    + push cho mọi người mua đã bật thông báo (trừ ai đã tắt nhóm "Khuyến mãi").
 *  - Voucher của một cửa hàng: chỉ báo người đã yêu thích cửa hàng hoặc đã từng đặt ở cửa hàng đó (tối đa 300 người).
 * Chưa bắt đầu hoặc đã hết hạn thì không báo. Lỗi ở đây không làm hỏng việc tạo voucher.
 */
import { logger } from "../utils/logger";
import { createNotification } from "./notificationService";
import { pushService } from "./pushService";
import { supabaseAdmin } from "./supabaseService";

interface VoucherLike {
  id?: string | null;
  store_id?: string | null;
  code: string;
  percent_off?: number | null;
  fixed_discount_cents?: number | null;
  min_order_cents?: number | null;
  starts_at: string;
  expires_at: string;
  is_active?: boolean | null;
}

const MAX_STORE_RECIPIENTS = 300;

const discountText = (v: VoucherLike): string =>
  v.percent_off ? `giảm ${v.percent_off}%` : `giảm ${Math.round(Number(v.fixed_discount_cents) || 0).toLocaleString("vi-VN")}đ`;

export const voucherAnnounceService = {
  async announce(voucher: VoucherLike): Promise<{ recipients: number }> {
    try {
      const nowMs = Date.now();
      if (voucher.is_active === false || new Date(voucher.starts_at).getTime() > nowMs + 60_000 || new Date(voucher.expires_at).getTime() <= nowMs) return { recipients: 0 };
      const title = "Có voucher mới!";
      const body = `Mã ${voucher.code} – ${discountText(voucher)}${voucher.min_order_cents ? ` cho đơn từ ${Math.round(Number(voucher.min_order_cents)).toLocaleString("vi-VN")}đ` : ""}`;
      const meta = { type: "voucher-new", relatedType: "voucher", relatedId: voucher.id ?? null };

      if (!voucher.store_id) {
        await createNotification({ roleTarget: "customer", title, body, ...meta });
        const result = await pushService.sendToAllCustomers({ title, body, url: "/FOODSAVE_USER.html", appUrl: "/FOODSAVE_APP.html#voucher", tag: `voucher-${voucher.id ?? voucher.code}`, type: "voucher-new" }, "promo");
        return { recipients: result.users };
      }

      const [fav, ord] = await Promise.all([
        supabaseAdmin.from("favorite_stores").select("user_id").eq("store_id", voucher.store_id).limit(MAX_STORE_RECIPIENTS),
        supabaseAdmin.from("orders").select("customer_id").eq("store_id", voucher.store_id).neq("status", "awaiting_payment").limit(MAX_STORE_RECIPIENTS)
      ]);
      const ids = new Set<string>();
      for (const row of (fav.data ?? []) as Array<{ user_id: string }>) ids.add(row.user_id);
      for (const row of (ord.data ?? []) as Array<{ customer_id: string }>) ids.add(row.customer_id);
      const list = [...ids].slice(0, MAX_STORE_RECIPIENTS);
      for (let i = 0; i < list.length; i += 10) {
        await Promise.all(list.slice(i, i + 10).map((userId) => createNotification({ recipientId: userId, roleTarget: "customer", title, body, ...meta })));
      }
      return { recipients: list.length };
    } catch (error) {
      logger.warn("Không báo được voucher mới", error instanceof Error ? error.message : error);
      return { recipients: 0 };
    }
  }
};
