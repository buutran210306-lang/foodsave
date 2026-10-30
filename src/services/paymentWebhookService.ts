/**
 * Webhook của nhà cung cấp thanh toán thật: POST /api/v1/payments/webhook/:provider
 *  1. Chỉ nhận webhook của nhà cung cấp ĐANG DÙNG (PAYMENT_PROVIDER) và có hỗ trợ webhook; mô phỏng => 404.
 *  2. Chữ ký do provider.verifyCallback kiểm tra; sai chữ ký => 401, không ghi gì vào đơn.
 *  3. Chống xử lý trùng theo (nhà cung cấp, mã giao dịch của họ) bằng bảng payment_events: gọi lại không ghi trùng.
 *  4. Số tiền phải khớp tổng đơn; lệch thì từ chối, không đánh dấu đã thanh toán.
 *  5. Thành công => orderService.markPaidBySystem (đúng một đường với nút mô phỏng: hạn, sổ cái, thông báo).
 *  6. Thanh toán đến SAU khi đơn đã hết hạn/hủy: ghi nhận và gọi provider.refund để trả tiền cho khách.
 * Luôn trả 200 cho thông báo hợp lệ (nhà cung cấp thường gọi lại nếu nhận mã khác 200).
 */
import { env } from "../config/env";
import { ERROR_CODES } from "../constants/errors";
import { HTTP_STATUS } from "../constants/http";
import { AppError } from "../utils/appError";
import { logger } from "../utils/logger";
import { getPaymentProvider } from "./payments";
import { type CallbackHeaders } from "./payments/paymentProvider";
import { orderService } from "./orderService";
import { handleSupabaseError, supabaseAdmin } from "./supabaseService";
import type { Order } from "../types/domain";

export interface WebhookOutcome {
  ok: boolean;
  duplicate: boolean;
  outcome: "paid" | "failed" | "late_payment_refunded" | "amount_mismatch" | "order_not_found" | "duplicate";
}

const notFound = (): AppError => new AppError("Not found", HTTP_STATUS.NOT_FOUND, ERROR_CODES.RESOURCE_NOT_FOUND);

const finishEvent = async (provider: string, txnId: string, status: "processed" | "rejected" | "ignored", result: Record<string, unknown>, orderId?: string | null): Promise<void> => {
  const { error } = await supabaseAdmin
    .from("payment_events")
    .update({ status, result, processed_at: new Date().toISOString(), ...(orderId ? { order_id: orderId } : {}) })
    .eq("provider", provider)
    .eq("provider_txn_id", txnId);
  if (error) logger.warn("Không cập nhật được payment_events", { provider, txnId, error });
};

export const paymentWebhookService = {
  async handle(providerName: string, payload: unknown, headers: CallbackHeaders): Promise<WebhookOutcome> {
    // Chỉ nhà cung cấp đang dùng và có webhook; còn lại coi như không tồn tại
    if (providerName !== env.PAYMENT_PROVIDER) throw notFound();
    const provider = getPaymentProvider(providerName);
    if (!provider.supportsWebhook) throw notFound();

    // Chữ ký sai ném 401 ngay tại đây: chưa ghi gì vào database
    const callback = await provider.verifyCallback(payload, headers);

    // Chống trùng theo mã giao dịch của nhà cung cấp
    const { data: existing, error: existingError } = await supabaseAdmin
      .from("payment_events")
      .select("status")
      .eq("provider", provider.name)
      .eq("provider_txn_id", callback.providerTxnId)
      .maybeSingle();
    if (existingError) handleSupabaseError(existingError, "Failed to read payment event");
    const prior = (existing as { status: string } | null)?.status;
    if (prior && prior !== "received") return { ok: true, duplicate: true, outcome: "duplicate" };

    if (!prior) {
      const { error: insertError } = await supabaseAdmin.from("payment_events").insert({
        provider: provider.name,
        provider_txn_id: callback.providerTxnId,
        amount_cents: Math.round(callback.amount),
        status: "received"
      });
      if (insertError) {
        // Hai webhook cùng mã giao dịch đến đồng thời: bên thua cuộc coi là trùng
        if (insertError.code === "23505") return { ok: true, duplicate: true, outcome: "duplicate" };
        handleSupabaseError(insertError, "Failed to record payment event");
      }
    }

    const { data: orderRow, error: orderError } = await supabaseAdmin.from("orders").select("*").eq("order_number", callback.orderNumber).maybeSingle();
    if (orderError) handleSupabaseError(orderError, "Failed to load order for webhook");
    const order = orderRow as Order | null;
    if (!order) {
      await finishEvent(provider.name, callback.providerTxnId, "rejected", { reason: "order_not_found", order_number: callback.orderNumber });
      return { ok: false, duplicate: false, outcome: "order_not_found" };
    }

    if (Math.round(callback.amount) !== Math.round(Number(order.total_cents))) {
      logger.warn("Webhook thanh toán lệch số tiền, từ chối", { orderId: order.id, expected: order.total_cents, got: callback.amount });
      await finishEvent(provider.name, callback.providerTxnId, "rejected", { reason: "amount_mismatch", expected: order.total_cents, got: callback.amount }, order.id);
      return { ok: false, duplicate: false, outcome: "amount_mismatch" };
    }

    if (callback.status === "failed") {
      await finishEvent(provider.name, callback.providerTxnId, "processed", { outcome: "failed" }, order.id);
      return { ok: true, duplicate: false, outcome: "failed" };
    }

    try {
      await orderService.markPaidBySystem(order.id, undefined, { provider: provider.name, ref: callback.paymentRef ?? callback.providerTxnId });
      await finishEvent(provider.name, callback.providerTxnId, "processed", { outcome: "paid" }, order.id);
      return { ok: true, duplicate: false, outcome: "paid" };
    } catch (error) {
      // Tiền đã về nhưng đơn không còn nhận thanh toán (hết hạn / đã hủy): trả tiền lại cho khách
      if (error instanceof AppError && (error.code === ERROR_CODES.PAYMENT_EXPIRED || error.statusCode === HTTP_STATUS.CONFLICT)) {
        let refunded = false;
        try {
          const refund = await provider.refund(callback.paymentRef ?? callback.providerTxnId, Math.round(callback.amount), { orderNumber: order.order_number, reason: "late_payment" });
          refunded = refund.ok;
        } catch (refundError) {
          logger.error("Hoàn tiền thanh toán đến muộn thất bại, cần xử lý tay", { orderId: order.id, error: refundError });
        }
        await finishEvent(provider.name, callback.providerTxnId, "processed", { outcome: "late_payment", refunded }, order.id);
        return { ok: true, duplicate: false, outcome: "late_payment_refunded" };
      }
      throw error; // lỗi hệ thống: để nhà cung cấp gọi lại (sự kiện vẫn ở trạng thái "received" nên sẽ được xử lý lại)
    }
  }
};
