/**
 * Tài khoản nhận tiền của cửa hàng (bảng store_payout_accounts).
 * - Số tài khoản đầy đủ chỉ lưu dạng MÃ HÓA (AES-256-GCM, khóa PAYOUT_ENCRYPTION_KEY). Mọi API chỉ trả bank_name,
 *   account_holder_name và account_last4 qua toView(); cột account_number_encrypted không bao giờ rời khỏi service này.
 * - Chỉ admin, khi chi trả một lệnh rút, mới xem được số đầy đủ (revealForWithdrawal) và MỖI LẦN đều ghi payout_access_log
 *   TRƯỚC khi giải mã (ghi nhật ký lỗi thì không giải mã).
 * - Đổi tài khoản phải được admin duyệt lại; tài khoản chưa 'verified' thì không tạo được lệnh rút.
 */
import { ERROR_CODES } from "../constants/errors";
import { HTTP_STATUS } from "../constants/http";
import { AppError } from "../utils/appError";
import { logger } from "../utils/logger";
import { decryptAccountNumber, encryptAccountNumber, last4Of, normalizeAccountNumber } from "../utils/payoutCrypto";
import { createNotification } from "./notificationService";
import { handleSupabaseError, supabaseAdmin } from "./supabaseService";

export interface PayoutAccountView {
  id: string;
  store_id: string;
  bank_name: string;
  account_holder_name: string;
  account_last4: string;
  status: "pending_verification" | "verified" | "rejected" | "replaced";
  holder_name_match: boolean | null;
  warning: string | null;
  admin_note: string | null;
  verified_at: string | null;
  created_at: string;
}

interface PayoutAccountRow extends PayoutAccountView {
  account_number_encrypted: string;
  verified_by: string | null;
  updated_at: string;
}

const VIEW_COLUMNS = "id,store_id,bank_name,account_holder_name,account_last4,status,holder_name_match,warning,admin_note,verified_at,created_at";

/** Chỉ các trường an toàn; KHÔNG bao giờ có account_number_encrypted */
const toView = (row: PayoutAccountView): PayoutAccountView => ({
  id: row.id,
  store_id: row.store_id,
  bank_name: row.bank_name,
  account_holder_name: row.account_holder_name,
  account_last4: row.account_last4,
  status: row.status,
  holder_name_match: row.holder_name_match ?? null,
  warning: row.warning ?? null,
  admin_note: row.admin_note ?? null,
  verified_at: row.verified_at ?? null,
  created_at: row.created_at
});

/** Bỏ dấu, viết hoa, chỉ giữ chữ và số để so tên chủ tài khoản với tên đăng ký kinh doanh */
export const normalizePersonName = (value: string): string =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const namesMatch = (holder: string, registered: string): boolean => {
  const a = normalizePersonName(holder);
  const b = normalizePersonName(registered);
  return a.length > 0 && a === b;
};

const loadRegisteredName = async (storeId: string): Promise<string | null> => {
  const { data: profile } = await supabaseAdmin.from("partner_profiles").select("legal_name").eq("store_id", storeId).maybeSingle();
  const legal = (profile as { legal_name?: string | null } | null)?.legal_name?.trim();
  if (legal) return legal;
  const { data: store } = await supabaseAdmin.from("stores").select("legal_name,name").eq("id", storeId).maybeSingle();
  const row = store as { legal_name?: string | null; name?: string | null } | null;
  return row?.legal_name?.trim() || row?.name?.trim() || null;
};

const notifyOwner = async (storeId: string, type: string, title: string, body: string): Promise<void> => {
  const { data } = await supabaseAdmin.from("stores").select("owner_id").eq("id", storeId).maybeSingle();
  const owner = (data as { owner_id: string } | null)?.owner_id;
  if (owner) await createNotification({ recipientId: owner, roleTarget: "partner", type, title, body });
};

export const payoutAccountService = {
  /** Cửa hàng gửi tài khoản mới: mã hóa số đầy đủ, cũ chuyển 'replaced', mới chờ admin xác minh */
  async submit(storeId: string, input: { bank_name: string; account_holder_name: string; account_number: string }): Promise<PayoutAccountView> {
    const digits = normalizeAccountNumber(input.account_number);
    if (!digits) throw new AppError("Số tài khoản chỉ gồm chữ số, từ 6 đến 30 số", HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
    const cipher = encryptAccountNumber(digits); // thiếu khóa mã hóa thì ném lỗi, KHÔNG lưu rõ
    const { data, error } = await supabaseAdmin.rpc("fs_submit_payout_account", {
      p_store: storeId,
      p_bank: input.bank_name.trim(),
      p_holder: input.account_holder_name.trim(),
      p_last4: last4Of(digits),
      p_cipher: cipher
    });
    if (error) handleSupabaseError(error, "Failed to submit payout account");
    return toView(data as PayoutAccountView);
  },

  /** Tài khoản hiện hành (đang chờ duyệt hoặc đã xác minh) + vài bản gần nhất, chỉ dạng che */
  async getForStore(storeId: string): Promise<{ current: PayoutAccountView | null; history: PayoutAccountView[] }> {
    const { data, error } = await supabaseAdmin.from("store_payout_accounts").select(VIEW_COLUMNS).eq("store_id", storeId).order("created_at", { ascending: false }).limit(5);
    if (error) handleSupabaseError(error, "Failed to load payout account");
    const rows = ((data ?? []) as PayoutAccountView[]).map(toView);
    return { current: rows.find((row) => row.status === "pending_verification" || row.status === "verified") ?? null, history: rows };
  },

  /** Tài khoản đã xác minh để tạo lệnh rút; không có thì ném lỗi rõ ràng */
  async requireVerified(storeId: string): Promise<PayoutAccountView> {
    const { current } = await payoutAccountService.getForStore(storeId);
    if (!current) {
      throw new AppError("Cửa hàng chưa có tài khoản nhận tiền. Hãy thêm tài khoản trong mục Ví.", HTTP_STATUS.CONFLICT, ERROR_CODES.ACCOUNT_NOT_VERIFIED);
    }
    if (current.status !== "verified") {
      throw new AppError("Tài khoản nhận tiền đang chờ admin xác minh nên chưa thể rút tiền.", HTTP_STATUS.CONFLICT, ERROR_CODES.ACCOUNT_NOT_VERIFIED);
    }
    return current;
  },

  /** Admin: danh sách tài khoản (che) kèm tên cửa hàng và tên đăng ký kinh doanh để đối chiếu */
  async listForAdmin(status?: string): Promise<Array<PayoutAccountView & { store_name: string | null; registered_name: string | null }>> {
    let query = supabaseAdmin.from("store_payout_accounts").select(`${VIEW_COLUMNS}, stores(name)`).order("created_at", { ascending: false }).limit(100);
    if (status) query = query.eq("status", status);
    const { data, error } = await query;
    if (error) handleSupabaseError(error, "Failed to list payout accounts");
    const rows = (data ?? []) as unknown as Array<PayoutAccountView & { stores?: { name: string } | null }>;
    const out: Array<PayoutAccountView & { store_name: string | null; registered_name: string | null }> = [];
    for (const row of rows) {
      out.push({ ...toView(row), store_name: row.stores?.name ?? null, registered_name: await loadRegisteredName(row.store_id) });
    }
    return out;
  },

  /**
   * Admin xác minh / từ chối. Tên chủ tài khoản phải khớp tên đăng ký kinh doanh; lệch thì đánh dấu cảnh báo
   * `name_mismatch` và bắt buộc có ghi chú nếu vẫn xác minh.
   */
  async decide(accountId: string, verify: boolean, adminId: string, note: string | undefined): Promise<PayoutAccountView> {
    const { data: found, error: loadError } = await supabaseAdmin.from("store_payout_accounts").select(VIEW_COLUMNS).eq("id", accountId).maybeSingle();
    if (loadError) handleSupabaseError(loadError, "Failed to load payout account");
    const account = found as PayoutAccountView | null;
    if (!account) throw new AppError("Không tìm thấy tài khoản nhận tiền", HTTP_STATUS.NOT_FOUND, ERROR_CODES.RESOURCE_NOT_FOUND);

    const registered = await loadRegisteredName(account.store_id);
    const match = registered ? namesMatch(account.account_holder_name, registered) : null;
    const warning = match === false ? "name_mismatch" : match === null ? "no_registered_name" : null;
    if (verify && warning && !(note && note.trim().length >= 3)) {
      throw new AppError(
        warning === "name_mismatch"
          ? `Tên chủ tài khoản "${account.account_holder_name}" không khớp tên đăng ký kinh doanh "${registered}". Nhập ghi chú lý do nếu vẫn xác minh.`
          : "Cửa hàng chưa có tên đăng ký kinh doanh để đối chiếu. Nhập ghi chú nếu vẫn xác minh.",
        HTTP_STATUS.CONFLICT,
        ERROR_CODES.VALIDATION_ERROR
      );
    }

    const { data, error } = await supabaseAdmin.rpc("fs_decide_payout_account", {
      p_id: accountId, p_verify: verify, p_admin: adminId, p_note: note ?? null, p_match: match, p_warning: warning
    });
    if (error) {
      if (error.message.includes("invalid_transition")) throw new AppError("Tài khoản này không còn ở trạng thái chờ duyệt", HTTP_STATUS.CONFLICT, ERROR_CODES.RESOURCE_CONFLICT);
      handleSupabaseError(error, "Failed to decide payout account");
    }
    const result = toView(data as PayoutAccountView);
    await notifyOwner(
      account.store_id,
      "payout-account-decision",
      verify ? "Tài khoản nhận tiền đã được xác minh" : "Tài khoản nhận tiền bị từ chối",
      verify ? `Tài khoản ${account.bank_name} ••••${account.account_last4} đã được xác minh, bạn có thể rút tiền.` : `Tài khoản ${account.bank_name} ••••${account.account_last4} bị từ chối${note ? `: ${note}` : ""}. Hãy kiểm tra và gửi lại.`
    );
    return result;
  },

  /**
   * Admin xem số tài khoản ĐẦY ĐỦ để chi trả cho MỘT lệnh rút (đang approved/processing).
   * Ghi payout_access_log (ai, khi nào, lệnh nào) TRƯỚC khi giải mã; ghi nhật ký lỗi thì không giải mã.
   */
  async revealForWithdrawal(withdrawalId: string, adminId: string, reason: string): Promise<{ bank_name: string; account_holder_name: string; account_number: string }> {
    const { data: withdrawal, error } = await supabaseAdmin.from("withdrawals").select("id,store_id,status,payout_account_id").eq("id", withdrawalId).maybeSingle();
    if (error) handleSupabaseError(error, "Failed to load withdrawal");
    const w = withdrawal as { id: string; store_id: string; status: string; payout_account_id: string | null } | null;
    if (!w) throw new AppError("Không tìm thấy lệnh rút", HTTP_STATUS.NOT_FOUND, ERROR_CODES.RESOURCE_NOT_FOUND);
    if (!["approved", "processing"].includes(w.status)) {
      throw new AppError("Chỉ xem được số tài khoản của lệnh rút đã duyệt và chưa chi xong", HTTP_STATUS.CONFLICT, ERROR_CODES.PAYOUT_INVALID_TRANSITION);
    }
    if (!w.payout_account_id) {
      throw new AppError("Lệnh rút này được gửi trước khi có tài khoản mã hóa; hãy nhờ cửa hàng thêm tài khoản nhận tiền rồi gửi lệnh mới", HTTP_STATUS.CONFLICT, ERROR_CODES.ACCOUNT_NOT_VERIFIED);
    }
    const { data: row, error: accountError } = await supabaseAdmin.from("store_payout_accounts").select("id,bank_name,account_holder_name,account_number_encrypted,status").eq("id", w.payout_account_id).maybeSingle();
    if (accountError) handleSupabaseError(accountError, "Failed to load payout account");
    const account = row as Pick<PayoutAccountRow, "id" | "bank_name" | "account_holder_name" | "account_number_encrypted" | "status"> | null;
    if (!account || account.status === "rejected") {
      throw new AppError("Tài khoản nhận tiền của lệnh rút không hợp lệ", HTTP_STATUS.CONFLICT, ERROR_CODES.ACCOUNT_NOT_VERIFIED);
    }

    const { error: logError } = await supabaseAdmin.from("payout_access_log").insert({ account_id: account.id, withdrawal_id: w.id, admin_id: adminId, reason });
    if (logError) {
      logger.error("Không ghi được nhật ký xem số tài khoản, từ chối giải mã", logError);
      throw new AppError("Không ghi được nhật ký truy cập nên không thể hiện số tài khoản", HTTP_STATUS.INTERNAL_SERVER_ERROR, ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
    return { bank_name: account.bank_name, account_holder_name: account.account_holder_name, account_number: decryptAccountNumber(account.account_number_encrypted) };
  },

  /** Dùng cho provider chi trả cần số đầy đủ; cũng ghi nhật ký */
  async accountInfoForPayout(withdrawalId: string, adminId: string, needsNumber: boolean): Promise<{ bank_name: string; account_holder_name: string; account_last4: string; account_number?: string }> {
    const { data: withdrawal } = await supabaseAdmin.from("withdrawals").select("payout_account_id,bank_name,account_last4").eq("id", withdrawalId).maybeSingle();
    const w = withdrawal as { payout_account_id: string | null; bank_name: string; account_last4: string } | null;
    if (!w) throw new AppError("Không tìm thấy lệnh rút", HTTP_STATUS.NOT_FOUND, ERROR_CODES.RESOURCE_NOT_FOUND);
    let holder = "";
    if (w.payout_account_id) {
      const { data: acc } = await supabaseAdmin.from("store_payout_accounts").select("account_holder_name").eq("id", w.payout_account_id).maybeSingle();
      holder = (acc as { account_holder_name?: string } | null)?.account_holder_name ?? "";
    }
    if (!needsNumber) return { bank_name: w.bank_name, account_holder_name: holder, account_last4: w.account_last4 };
    const full = await payoutAccountService.revealForWithdrawal(withdrawalId, adminId, "provider_payout");
    return { bank_name: full.bank_name, account_holder_name: full.account_holder_name, account_last4: w.account_last4, account_number: full.account_number };
  }
};
