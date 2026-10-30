/**
 * Lớp trừu tượng nhà cung cấp THANH TOÁN (thu tiền). Mọi cổng thanh toán (mô phỏng, MoMo, VNPay...) cài đặt giao diện này.
 * Phần còn lại của hệ thống (orderService, webhook, hoàn tiền) chỉ nói chuyện với PaymentProvider, nên chuyển từ mô phỏng
 * sang thật chỉ cần đổi PAYMENT_PROVIDER và viết/điền một lớp, không viết lại nghiệp vụ.
 */
import crypto from "crypto";
import { env } from "../../config/env";
import { ERROR_CODES } from "../../constants/errors";
import { HTTP_STATUS } from "../../constants/http";
import type { Order } from "../../types/domain";
import { AppError } from "../../utils/appError";

export type PaymentOrderRef = Pick<Order, "id" | "order_number" | "total_cents" | "payment_method" | "customer_id">;
export type CallbackHeaders = Record<string, string | string[] | undefined>;

/** Thông tin để khách thanh toán */
export interface PaymentInit {
  provider: string;
  /** Mã tham chiếu của nhà cung cấp, lưu vào đơn (orders.payment_ref) */
  paymentRef: string | null;
  /** manual_confirm: khách bấm "Đã thanh toán" (mô phỏng); redirect: chuyển sang trang cổng; qr: hiện mã QR */
  mode: "manual_confirm" | "redirect" | "qr";
  payUrl?: string | null;
  qrCodeUrl?: string | null;
  expiresAt?: string | null;
}

/** Kết quả sau khi đã KIỂM TRA CHỮ KÝ thành công */
export interface VerifiedCallback {
  /** Mã giao dịch của nhà cung cấp: khóa chống xử lý trùng */
  providerTxnId: string;
  /** Mã đơn của FoodSave (orders.order_number) mà giao dịch thuộc về */
  orderNumber: string;
  amount: number;
  status: "paid" | "failed";
  paymentRef?: string | null;
}

export interface RefundResult { ok: boolean; refundRef: string | null; simulated?: boolean }
export interface PaymentStatusResult { status: "pending" | "paid" | "failed" | "refunded" | "unknown"; providerTxnId?: string | null }

export interface PaymentProvider {
  readonly name: string;
  /** Có nhận webhook từ nhà cung cấp không (mô phỏng: không, endpoint webhook trả 404) */
  readonly supportsWebhook: boolean;
  /** Người mua có được tự bấm "Đã thanh toán" không (chỉ mô phỏng). Cổng thật: false, chỉ webhook mới xác nhận. */
  readonly allowsManualConfirm: boolean;
  createPayment(order: PaymentOrderRef): Promise<PaymentInit>;
  /** Kiểm tra chữ ký; chữ ký sai PHẢI ném AppError(401, PAYMENT_SIGNATURE_INVALID) */
  verifyCallback(payload: unknown, headers: CallbackHeaders): Promise<VerifiedCallback>;
  refund(paymentRef: string | null, amount: number, context?: { orderNumber?: string; reason?: string }): Promise<RefundResult>;
  getStatus(paymentRef: string | null): Promise<PaymentStatusResult>;
}

export const providerNotConfigured = (name: string, detail = ""): AppError =>
  new AppError(
    `Nhà cung cấp thanh toán "${name}" chưa được cấu hình${detail ? `: ${detail}` : ""}. Hãy dùng PAYMENT_PROVIDER=simulated hoặc hoàn tất cấu hình theo mục 15 của đặc tả.`,
    HTTP_STATUS.NOT_IMPLEMENTED,
    ERROR_CODES.PROVIDER_NOT_CONFIGURED
  );

export const invalidSignature = (): AppError =>
  new AppError("Chữ ký thông báo thanh toán không hợp lệ", HTTP_STATUS.UNAUTHORIZED, ERROR_CODES.PAYMENT_SIGNATURE_INVALID);

export const hmacSha256Hex = (raw: string, secret: string): string => crypto.createHmac("sha256", secret).update(raw).digest("hex");

/** So sánh chữ ký không để lộ độ dài khớp (chống tấn công thời gian) */
export const safeEqualHex = (a: string, b: string): boolean => {
  const x = Buffer.from(String(a ?? "").toLowerCase());
  const y = Buffer.from(String(b ?? "").toLowerCase());
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

export const headerValue = (headers: CallbackHeaders, name: string): string => {
  const value = headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
};

const registry = new Map<string, () => PaymentProvider>();
const instances = new Map<string, PaymentProvider>();

/** Đăng ký nhà cung cấp (dùng khi khởi động và trong kiểm thử) */
export const registerPaymentProvider = (name: string, factory: () => PaymentProvider): void => {
  registry.set(name, factory);
  instances.delete(name);
};

export const getPaymentProvider = (name: string = env.PAYMENT_PROVIDER): PaymentProvider => {
  let instance = instances.get(name);
  if (!instance) {
    const factory = registry.get(name);
    if (!factory) throw providerNotConfigured(name, "chưa có lớp cài đặt");
    instance = factory();
    instances.set(name, instance);
  }
  return instance;
};
