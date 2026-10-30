import { ERROR_CODES } from "../../constants/errors";
import { HTTP_STATUS } from "../../constants/http";
import { AppError } from "../../utils/appError";
import type { PaymentInit, PaymentOrderRef, PaymentProvider, PaymentStatusResult, RefundResult, VerifiedCallback } from "./paymentProvider";

/**
 * Nhà cung cấp MÔ PHỎNG (mặc định): khách bấm "Đã thanh toán" trong ứng dụng, không có tiền thật chạy qua.
 * Không có webhook (endpoint webhook trả 404). Hoàn tiền chỉ ghi nhận mô phỏng; số dư do sổ cái nội bộ quản lý.
 */
export class SimulatedPaymentProvider implements PaymentProvider {
  readonly name = "simulated";
  readonly supportsWebhook = false;
  readonly allowsManualConfirm = true;

  async createPayment(order: PaymentOrderRef): Promise<PaymentInit> {
    return { provider: this.name, paymentRef: `SIM-${order.order_number}`, mode: "manual_confirm" };
  }

  async verifyCallback(): Promise<VerifiedCallback> {
    throw new AppError("Không có webhook cho nhà cung cấp mô phỏng", HTTP_STATUS.NOT_FOUND, ERROR_CODES.RESOURCE_NOT_FOUND);
  }

  async refund(paymentRef: string | null, amount: number): Promise<RefundResult> {
    return { ok: true, refundRef: `SIM-REFUND-${paymentRef ?? "none"}-${Math.round(amount)}`, simulated: true };
  }

  async getStatus(): Promise<PaymentStatusResult> {
    return { status: "unknown" };
  }
}
