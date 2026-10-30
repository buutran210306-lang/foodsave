/**
 * Lớp trừu tượng nhà cung cấp CHI TRẢ (rút tiền cho cửa hàng). PAYOUT_PROVIDER chọn cái đang dùng.
 * Mặc định "manual": admin tự chuyển khoản bên ngoài rồi bấm "Đã chi" kèm mã giao dịch ngân hàng.
 */
import { env } from "../../config/env";
import { ERROR_CODES } from "../../constants/errors";
import { HTTP_STATUS } from "../../constants/http";
import { AppError } from "../../utils/appError";

export interface PayoutWithdrawalRef { id: string; store_id: string; amount_cents: number }
/** account_number chỉ có khi provider cần (needsAccountNumber) và đã được giải mã có ghi nhật ký */
export interface PayoutAccountInfo { bank_name: string; account_holder_name: string; account_last4: string; account_number?: string }
export interface PayoutResult { ref: string | null; status: "awaiting_manual" | "processing" | "paid" | "failed"; message?: string }
export interface PayoutStatusResult { status: "processing" | "paid" | "failed" | "unknown" }

export interface PayoutProvider {
  readonly name: string;
  /** Provider có cần số tài khoản đầy đủ để chi không (manual: không, admin tự xem có ghi nhật ký) */
  readonly needsAccountNumber: boolean;
  createPayout(withdrawal: PayoutWithdrawalRef, account: PayoutAccountInfo): Promise<PayoutResult>;
  getPayoutStatus(ref: string | null): Promise<PayoutStatusResult>;
}

export const payoutNotConfigured = (name: string): AppError =>
  new AppError(
    `Nhà cung cấp chi trả "${name}" chưa được cấu hình. Hãy dùng PAYOUT_PROVIDER=manual hoặc hoàn tất cấu hình theo mục 15 của đặc tả.`,
    HTTP_STATUS.NOT_IMPLEMENTED,
    ERROR_CODES.PROVIDER_NOT_CONFIGURED
  );

const registry = new Map<string, () => PayoutProvider>();
const instances = new Map<string, PayoutProvider>();

export const registerPayoutProvider = (name: string, factory: () => PayoutProvider): void => {
  registry.set(name, factory);
  instances.delete(name);
};

export const getPayoutProvider = (name: string = env.PAYOUT_PROVIDER): PayoutProvider => {
  let instance = instances.get(name);
  if (!instance) {
    const factory = registry.get(name);
    if (!factory) throw payoutNotConfigured(name);
    instance = factory();
    instances.set(name, instance);
  }
  return instance;
};
