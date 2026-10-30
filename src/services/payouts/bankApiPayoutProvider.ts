import type { PayoutAccountInfo, PayoutProvider, PayoutResult, PayoutStatusResult, PayoutWithdrawalRef } from "./payoutProvider";
import { payoutNotConfigured } from "./payoutProvider";

/**
 * KHUNG chi trả qua API ngân hàng. CHƯA nối: mọi hàm ném lỗi "chưa cấu hình".
 * Khi chuyển sang thật (đặc tả mục 15): điền createPayout (gọi API chuyển tiền, nhận account.account_number đã giải mã có nhật ký),
 * getPayoutStatus (tra trạng thái) và webhook kết quả; kiểm thử sandbox của ngân hàng rồi mới đặt PAYOUT_PROVIDER=bank_api.
 */
export class BankApiPayoutProvider implements PayoutProvider {
  readonly name = "bank_api";
  readonly needsAccountNumber = true;

  async createPayout(_withdrawal: PayoutWithdrawalRef, _account: PayoutAccountInfo): Promise<PayoutResult> {
    throw payoutNotConfigured(this.name);
  }

  async getPayoutStatus(_ref: string | null): Promise<PayoutStatusResult> {
    throw payoutNotConfigured(this.name);
  }
}
