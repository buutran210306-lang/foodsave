import { MomoPaymentProvider } from "./momoPaymentProvider";
import { registerPaymentProvider } from "./paymentProvider";
import { SimulatedPaymentProvider } from "./simulatedPaymentProvider";

// Đăng ký các nhà cung cấp có sẵn; PAYMENT_PROVIDER chọn cái đang dùng
registerPaymentProvider("simulated", () => new SimulatedPaymentProvider());
registerPaymentProvider("momo", () => new MomoPaymentProvider());

export { getPaymentProvider, registerPaymentProvider } from "./paymentProvider";
export type { PaymentProvider, PaymentInit, VerifiedCallback, RefundResult } from "./paymentProvider";
