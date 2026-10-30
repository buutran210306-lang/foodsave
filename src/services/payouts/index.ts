import { BankApiPayoutProvider } from "./bankApiPayoutProvider";
import { ManualPayoutProvider } from "./manualPayoutProvider";
import { registerPayoutProvider } from "./payoutProvider";

registerPayoutProvider("manual", () => new ManualPayoutProvider());
registerPayoutProvider("bank_api", () => new BankApiPayoutProvider());

export { getPayoutProvider, registerPayoutProvider } from "./payoutProvider";
export type { PayoutProvider, PayoutResult } from "./payoutProvider";
