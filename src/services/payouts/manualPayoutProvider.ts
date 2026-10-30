import type { PayoutAccountInfo, PayoutProvider, PayoutResult, PayoutStatusResult, PayoutWithdrawalRef } from "./payoutProvider";

/** Chi trả THỦ CÔNG: không gọi ngân hàng. Admin chuyển khoản bên ngoài rồi bấm "Đã chi" kèm mã giao dịch ngân hàng. */
export class ManualPayoutProvider implements PayoutProvider {
  readonly name = "manual";
  readonly needsAccountNumber = false;

  async createPayout(_withdrawal: PayoutWithdrawalRef, _account: PayoutAccountInfo): Promise<PayoutResult> {
    return { ref: null, status: "awaiting_manual", message: "Chuyển khoản thủ công bên ngoài rồi bấm Đã chi kèm mã giao dịch ngân hàng" };
  }

  async getPayoutStatus(): Promise<PayoutStatusResult> {
    return { status: "processing" };
  }
}
