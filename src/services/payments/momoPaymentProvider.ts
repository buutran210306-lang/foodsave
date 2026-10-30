import type { CallbackHeaders, PaymentInit, PaymentOrderRef, PaymentProvider, PaymentStatusResult, RefundResult, VerifiedCallback } from "./paymentProvider";
import { providerNotConfigured } from "./paymentProvider";

/**
 * KHUNG nhà cung cấp MoMo thật. CHƯA gọi mạng và CHƯA hoạt động: mọi hàm ném lỗi "chưa cấu hình" rõ ràng.
 * Khi chuyển sang thật (xem đặc tả mục 15), điền từng hàm theo tài liệu MoMo, kiểm thử sandbox rồi mới đặt PAYMENT_PROVIDER=momo:
 *  - createPayment: gọi /create, trả payUrl / qrCodeUrl và requestId làm paymentRef.
 *  - verifyCallback: dựng chuỗi ký IPN theo tài liệu MoMo, so với `signature` bằng hmacSha256Hex + safeEqualHex (đã có sẵn trong paymentProvider.ts).
 *  - refund / getStatus: gọi /refund và /query.
 * Khóa (MOMO_PARTNER_CODE, MOMO_ACCESS_KEY, MOMO_SECRET_KEY) chỉ đặt qua biến môi trường, không bao giờ trong repo.
 */
export class MomoPaymentProvider implements PaymentProvider {
  readonly name = "momo";
  readonly supportsWebhook = true;
  readonly allowsManualConfirm = false;

  async createPayment(_order: PaymentOrderRef): Promise<PaymentInit> {
    throw providerNotConfigured(this.name, "chưa cài đặt createPayment");
  }

  async verifyCallback(_payload: unknown, _headers: CallbackHeaders): Promise<VerifiedCallback> {
    throw providerNotConfigured(this.name, "chưa cài đặt verifyCallback");
  }

  async refund(_paymentRef: string | null, _amount: number): Promise<RefundResult> {
    throw providerNotConfigured(this.name, "chưa cài đặt refund");
  }

  async getStatus(_paymentRef: string | null): Promise<PaymentStatusResult> {
    throw providerNotConfigured(this.name, "chưa cài đặt getStatus");
  }
}
