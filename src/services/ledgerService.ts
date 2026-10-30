/**
 * Sổ cái tiền MÔ PHỎNG. Mọi thay đổi tiền đi qua `post()` -> hàm SQL fs_post_ledger (idempotent theo idempotency_key).
 * Thiết kế để sau này thay bước "thanh toán" bằng MoMo thật mà không sửa phần còn lại.
 *
 * Quy ước tiền (đặc tả 2.4): total = store_amount + fee + donation, trong đó store_amount = total - fee - donation.
 *   charge  : external -> escrow                       (khi thanh toán)
 *   release : escrow -> ví cửa hàng / doanh thu nền tảng / quỹ từ thiện   (hoàn tất; hoặc hủy muộn / vắng mặt, ghi metadata.reason)
 *   refund  : escrow -> external                       (hủy trong hạn, cửa hàng hủy)
 *   clawback: ví cửa hàng / doanh thu / quỹ -> external (hoàn tiền sau khi đã release, ví cửa hàng được phép âm)
 *   withdraw: ví cửa hàng -> external                  (admin duyệt rút tiền)
 */
import { ERROR_CODES } from "../constants/errors";
import { HTTP_STATUS } from "../constants/http";
import { MIN_WITHDRAWAL } from "../constants/orderPolicy";
import type { Order } from "../types/domain";
import { AppError } from "../utils/appError";
import { logger } from "../utils/logger";
import { createNotification } from "./notificationService";
import { payoutAccountService } from "./payoutAccountService";
import { getPayoutProvider } from "./payouts";
import { handleSupabaseError, supabaseAdmin } from "./supabaseService";

export type SystemWallet = "external" | "escrow" | "platform_revenue" | "charity_pool";
export type LedgerEntryType = "charge" | "release" | "refund" | "refund_clawback" | "withdraw" | "adjustment";
export type SettleReason = "completed" | "late_cancel" | "no_show";

export interface LedgerEntry {
  id: string;
  idempotency_key: string;
  order_id: string | null;
  entry_type: LedgerEntryType;
  from_wallet_id: string;
  to_wallet_id: string;
  amount_cents: number;
  metadata: Record<string, unknown>;
  created_at: string;
}

type OrderMoney = Pick<Order, "id" | "store_id" | "total_cents" | "platform_fee_cents" | "donation_cents">;
type OrderForSync = OrderMoney & Pick<Order, "status" | "settlement_status" | "cancel_reason" | "ledger_synced_status">;

/** Tách tổng tiền đơn thành 3 phần; luôn cộng lại đúng bằng total_cents */
export const splitOrderMoney = (order: OrderMoney): { total: number; store: number; fee: number; donation: number } => {
  const total = Math.max(0, Math.round(Number(order.total_cents) || 0));
  const fee = Math.min(Math.max(0, Math.round(Number(order.platform_fee_cents) || 0)), total);
  const donation = Math.min(Math.max(0, Math.round(Number(order.donation_cents) || 0)), total - fee);
  return { total, fee, donation, store: total - fee - donation };
};

/** Hoàn một phần: trừ ưu tiên từ phần cửa hàng, rồi phí nền tảng, rồi quỹ từ thiện */
export const splitRefund = (money: { store: number; fee: number; donation: number }, amount: number): { store: number; fee: number; donation: number } => {
  let remaining = Math.max(0, Math.round(amount));
  const take = (cap: number): number => { const used = Math.min(cap, remaining); remaining -= used; return used; };
  const store = take(money.store);
  const fee = take(money.fee);
  const donation = take(money.donation);
  return { store, fee, donation };
};

const key = (orderId: string, part: string): string => `order:${orderId}:${part}`;

const systemWalletCache = new Map<SystemWallet, string>();

const systemWallet = async (type: SystemWallet): Promise<string> => {
  const cached = systemWalletCache.get(type);
  if (cached) return cached;
  const { data, error } = await supabaseAdmin.from("wallets").select("id").eq("owner_type", type).is("store_id", null).limit(1);
  if (error) handleSupabaseError(error, "Failed to load system wallet");
  const id = (data as Array<{ id: string }> | null)?.[0]?.id;
  if (!id) throw new AppError(`Chưa có ví hệ thống "${type}". Hãy chạy SQL 030_wallet_ledger.sql.`, HTTP_STATUS.INTERNAL_SERVER_ERROR, ERROR_CODES.INTERNAL_SERVER_ERROR);
  systemWalletCache.set(type, id);
  return id;
};

const storeWallet = async (storeId: string): Promise<string> => {
  const { data, error } = await supabaseAdmin.rpc("fs_store_wallet", { p_store: storeId });
  if (error) handleSupabaseError(error, "Failed to load store wallet");
  return data as string;
};

const existingKeys = async (orderId: string): Promise<Set<string>> => {
  const { data, error } = await supabaseAdmin.from("ledger_entries").select("idempotency_key").eq("order_id", orderId);
  if (error) handleSupabaseError(error, "Failed to load ledger entries");
  return new Set(((data ?? []) as Array<{ idempotency_key: string }>).map((row) => row.idempotency_key));
};

export const ledgerService = {
  splitOrderMoney,
  splitRefund,

  /** Ghi một bút toán. Gọi lại cùng key trả bút toán cũ, không ghi trùng. */
  async post(idempotencyKey: string, orderId: string | null, type: LedgerEntryType, fromWalletId: string, toWalletId: string, amount: number, metadata: Record<string, unknown> = {}): Promise<LedgerEntry | null> {
    if (!(amount > 0)) return null;
    const { data, error } = await supabaseAdmin.rpc("fs_post_ledger", {
      p_key: idempotencyKey,
      p_order: orderId,
      p_type: type,
      p_from: fromWalletId,
      p_to: toWalletId,
      p_amount: Math.round(amount),
      p_meta: metadata
    });
    if (error) handleSupabaseError(error, "Failed to post ledger entry");
    return data as LedgerEntry;
  },

  getStoreWallet: storeWallet,

  /** Thanh toán thành công: tiền khách vào ví giữ chờ (escrow) */
  async holdCharge(order: OrderMoney): Promise<void> {
    const { total } = splitOrderMoney(order);
    await ledgerService.post(key(order.id, "charge"), order.id, "charge", await systemWallet("external"), await systemWallet("escrow"), total, { stage: "charge" });
  },

  /** Giải ngân: hoàn tất, hoặc hủy muộn / vắng mặt (lúc đó metadata.reason ghi rõ lý do) */
  async settleOrder(order: OrderMoney, reason: SettleReason): Promise<void> {
    const money = splitOrderMoney(order);
    const escrow = await systemWallet("escrow");
    const meta = (part: string): Record<string, unknown> => ({ reason, part });
    await ledgerService.post(key(order.id, "release:store"), order.id, "release", escrow, await storeWallet(order.store_id), money.store, meta("store"));
    await ledgerService.post(key(order.id, "release:fee"), order.id, "release", escrow, await systemWallet("platform_revenue"), money.fee, meta("fee"));
    await ledgerService.post(key(order.id, "release:donation"), order.id, "release", escrow, await systemWallet("charity_pool"), money.donation, meta("donation"));
  },

  /**
   * Hoàn tiền cho khách. Chưa giải ngân: escrow -> external (toàn bộ tổng tiền).
   * Đã giải ngân (khiếu nại được chấp nhận): lấy lại từ ví cửa hàng / doanh thu / quỹ, tổng đúng `amount` (mặc định hoàn 100%).
   */
  async refundOrder(order: OrderMoney, options: { amount?: number; reason: string }): Promise<void> {
    const money = splitOrderMoney(order);
    const external = await systemWallet("external");
    const keys = await existingKeys(order.id);
    const released = keys.has(key(order.id, "release:store")) || keys.has(key(order.id, "release:fee")) || keys.has(key(order.id, "release:donation"));
    const meta = { reason: options.reason };

    if (!released) {
      await ledgerService.post(key(order.id, "refund"), order.id, "refund", await systemWallet("escrow"), external, money.total, meta);
      return;
    }
    const amount = Math.min(money.total, Math.max(0, Math.round(options.amount ?? money.total)));
    const parts = splitRefund(money, amount);
    await ledgerService.post(key(order.id, "clawback:store"), order.id, "refund_clawback", await storeWallet(order.store_id), external, parts.store, { ...meta, part: "store" });
    await ledgerService.post(key(order.id, "clawback:fee"), order.id, "refund_clawback", await systemWallet("platform_revenue"), external, parts.fee, { ...meta, part: "fee" });
    await ledgerService.post(key(order.id, "clawback:donation"), order.id, "refund_clawback", await systemWallet("charity_pool"), external, parts.donation, { ...meta, part: "donation" });
  },

  /**
   * Đưa sổ cái của MỘT đơn về khớp với settlement_status hiện tại của đơn (idempotent, chạy lại bao nhiêu lần cũng an toàn).
   * Được gọi sau mỗi lần đơn đổi trạng thái tiền và bởi tác vụ định kỳ để bù đơn chưa có bút toán (ví dụ đơn tạo trước Đợt 2).
   */
  async syncOrder(order: OrderForSync): Promise<boolean> {
    const status = order.settlement_status ?? "none";
    if (status === "none" || status === "partially_refunded") return false; // khiếu nại hoàn một phần do Đợt 3 xử lý tường minh

    await ledgerService.holdCharge(order);
    if (status === "released" || status === "forfeited") {
      const reason: SettleReason = order.status === "no_show" || order.cancel_reason === "no_show" ? "no_show" : order.cancel_reason === "late_cancel" ? "late_cancel" : "completed";
      await ledgerService.settleOrder(order, reason);
    } else if (status === "refunded") {
      await ledgerService.refundOrder(order, { reason: order.cancel_reason ?? "refund" });
    }
    if (order.ledger_synced_status !== status) {
      await supabaseAdmin.from("orders").update({ ledger_synced_status: status }).eq("id", order.id);
    }
    return true;
  },

  /** Như syncOrder nhưng KHÔNG ném lỗi: nghiệp vụ đơn đã xong, sổ cái thiếu sẽ được tác vụ định kỳ bù. */
  async syncOrderSafe(order: OrderForSync): Promise<void> {
    try {
      await ledgerService.syncOrder(order);
    } catch (error) {
      logger.warn("Chưa ghi được sổ cái cho đơn (sẽ được tác vụ định kỳ bù lại)", { orderId: order.id, error });
    }
  },

  /** Tác vụ định kỳ: bù bút toán cho đơn có settlement_status chưa khớp ledger_synced_status */
  async syncPendingOrders(limitPerStatus = 100): Promise<number> {
    let done = 0;
    for (const status of ["held", "released", "forfeited", "refunded"] as const) {
      const { data, error } = await supabaseAdmin
        .from("orders")
        .select("*")
        .eq("settlement_status", status)
        .or(`ledger_synced_status.is.null,ledger_synced_status.neq.${status}`)
        .limit(limitPerStatus);
      if (error) handleSupabaseError(error, "Failed to load orders to sync ledger");
      for (const order of (data ?? []) as OrderForSync[]) {
        try {
          if (await ledgerService.syncOrder(order)) done += 1;
        } catch (syncError) {
          logger.warn("Bù sổ cái thất bại cho đơn", { orderId: order.id, error: syncError });
        }
      }
    }
    return done;
  },

  /** Số dư ví cửa hàng: tổng, đang chờ rút, khả dụng, tiền giữ chờ khách nhận, đã rút */
  async getStoreBalance(storeId: string): Promise<{ balance: number; pending_withdrawals: number; available: number; held: number; withdrawn: number; held_orders: number }> {
    const walletId = await storeWallet(storeId);
    const { data: wallet, error } = await supabaseAdmin.from("wallets").select("balance_cents").eq("id", walletId).single();
    if (error) handleSupabaseError(error, "Failed to load wallet balance");
    const balance = Number((wallet as { balance_cents: number | string } | null)?.balance_cents ?? 0);

    const { data: withdrawals } = await supabaseAdmin.from("withdrawals").select("amount_cents,status").eq("store_id", storeId).in("status", ["requested", "approved", "processing", "paid"]);
    let pending = 0;
    let withdrawn = 0;
    for (const row of (withdrawals ?? []) as Array<{ amount_cents: number | string; status: string }>) {
      if (row.status === "paid") withdrawn += Number(row.amount_cents);
      else pending += Number(row.amount_cents); // requested / approved / processing: số tiền đang được giữ chỗ
    }

    const { data: heldOrders } = await supabaseAdmin
      .from("orders")
      .select("total_cents,platform_fee_cents,donation_cents,id,store_id")
      .eq("store_id", storeId)
      .eq("settlement_status", "held")
      .limit(500);
    const held = ((heldOrders ?? []) as OrderMoney[]).reduce((sum, row) => sum + splitOrderMoney(row).store, 0);

    return { balance, pending_withdrawals: pending, available: balance - pending, held, withdrawn, held_orders: (heldOrders ?? []).length };
  },

  /** Lịch sử bút toán chạm vào ví cửa hàng (+ vào, − ra) */
  async listStoreEntries(storeId: string, limit = 50): Promise<Array<{ id: string; type: LedgerEntryType; amount: number; order_number: string | null; reason: string | null; created_at: string }>> {
    const walletId = await storeWallet(storeId);
    const { data, error } = await supabaseAdmin
      .from("ledger_entries")
      .select("id,order_id,entry_type,from_wallet_id,to_wallet_id,amount_cents,metadata,created_at")
      .or(`from_wallet_id.eq.${walletId},to_wallet_id.eq.${walletId}`)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) handleSupabaseError(error, "Failed to list store ledger entries");
    const rows = (data ?? []) as LedgerEntry[];
    const orderIds = [...new Set(rows.map((row) => row.order_id).filter((id): id is string => Boolean(id)))];
    const numbers = new Map<string, string>();
    if (orderIds.length > 0) {
      const { data: orders } = await supabaseAdmin.from("orders").select("id,order_number").in("id", orderIds);
      for (const order of (orders ?? []) as Array<{ id: string; order_number: string }>) numbers.set(order.id, order.order_number);
    }
    return rows.map((row) => ({
      id: row.id,
      type: row.entry_type,
      amount: row.to_wallet_id === walletId ? Number(row.amount_cents) : -Number(row.amount_cents),
      order_number: row.order_id ? numbers.get(row.order_id) ?? null : null,
      reason: typeof row.metadata?.reason === "string" ? row.metadata.reason : null,
      created_at: row.created_at
    }));
  },

  /** Gửi lệnh rút về tài khoản nhận tiền ĐÃ XÁC MINH của cửa hàng (không nhận số tài khoản từ client) */
  async requestWithdrawal(storeId: string, amount: number): Promise<unknown> {
    if (amount < MIN_WITHDRAWAL) {
      throw new AppError(`Số tiền rút tối thiểu là ${MIN_WITHDRAWAL.toLocaleString("vi-VN")}đ`, HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
    }
    const account = await payoutAccountService.requireVerified(storeId);
    const { data, error } = await supabaseAdmin.rpc("fs_request_withdrawal", { p_store: storeId, p_amount: Math.round(amount), p_account: account.id });
    if (error) {
      if (error.message.includes("insufficient_balance")) {
        throw new AppError("Số tiền rút vượt quá số dư khả dụng", HTTP_STATUS.CONFLICT, ERROR_CODES.INSUFFICIENT_BALANCE);
      }
      if (error.message.includes("account_not_verified")) {
        throw new AppError("Tài khoản nhận tiền chưa được xác minh", HTTP_STATUS.CONFLICT, ERROR_CODES.ACCOUNT_NOT_VERIFIED);
      }
      handleSupabaseError(error, "Failed to request withdrawal");
    }
    return data;
  },

  async listWithdrawals(storeId: string): Promise<unknown[]> {
    const { data, error } = await supabaseAdmin.from("withdrawals").select("*").eq("store_id", storeId).order("requested_at", { ascending: false }).limit(50);
    if (error) handleSupabaseError(error, "Failed to list withdrawals");
    return data ?? [];
  },

  async listAllWithdrawals(status?: string): Promise<unknown[]> {
    let query = supabaseAdmin.from("withdrawals").select("*, stores(name)").order("requested_at", { ascending: false }).limit(100);
    if (status) query = query.eq("status", status);
    const { data, error } = await query;
    if (error) handleSupabaseError(error, "Failed to list withdrawals");
    return data ?? [];
  },

  /**
   * Chuyển trạng thái lệnh rút: approve → start → pay (hoặc reject / fail). Mỗi bước idempotent và ghi người thực hiện + thời gian
   * (hàm SQL fs_withdrawal_transition). Chỉ `pay` mới trừ ví thật (bút toán rút) và bắt buộc có mã giao dịch ngân hàng.
   * `start` gọi PayoutProvider.createPayout (thủ công: chỉ đánh dấu đang chi).
   */
  async transitionWithdrawal(id: string, action: "approve" | "reject" | "start" | "pay" | "fail", adminId: string, options: { note?: string | undefined; bank_txn_ref?: string | undefined } = {}): Promise<Record<string, unknown>> {
    const { data: before } = await supabaseAdmin.from("withdrawals").select("status,store_id,amount_cents").eq("id", id).maybeSingle();
    const prior = before as { status: string; store_id: string; amount_cents: number } | null;
    if (!prior) throw new AppError("Không tìm thấy lệnh rút", HTTP_STATUS.NOT_FOUND, ERROR_CODES.RESOURCE_NOT_FOUND);

    let ref: string | null = options.bank_txn_ref?.trim() || null;
    if (action === "start" && prior.status === "approved") {
      const provider = getPayoutProvider();
      const account = await payoutAccountService.accountInfoForPayout(id, adminId, provider.needsAccountNumber);
      const result = await provider.createPayout({ id, store_id: prior.store_id, amount_cents: Number(prior.amount_cents) }, account);
      ref = result.ref;
    }
    if (action === "pay" && !ref) {
      throw new AppError("Cần nhập mã giao dịch ngân hàng khi xác nhận đã chi", HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
    }
    if (action === "fail" && !(options.note && options.note.trim().length >= 3)) {
      throw new AppError("Cần nhập lý do khi đánh dấu chi trả thất bại", HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
    }

    const { data, error } = await supabaseAdmin.rpc("fs_withdrawal_transition", { p_id: id, p_action: action, p_actor: adminId, p_note: options.note ?? null, p_ref: ref });
    if (error) {
      const m = error.message;
      if (m.includes("not_found")) throw new AppError("Không tìm thấy lệnh rút", HTTP_STATUS.NOT_FOUND, ERROR_CODES.RESOURCE_NOT_FOUND);
      if (m.includes("invalid_transition")) throw new AppError("Lệnh rút không ở trạng thái phù hợp cho bước này", HTTP_STATUS.CONFLICT, ERROR_CODES.PAYOUT_INVALID_TRANSITION);
      if (m.includes("insufficient_balance")) throw new AppError("Ví cửa hàng không đủ số dư để chi lệnh rút này", HTTP_STATUS.CONFLICT, ERROR_CODES.INSUFFICIENT_BALANCE);
      if (m.includes("account_not_verified")) throw new AppError("Tài khoản nhận tiền của lệnh rút chưa được xác minh", HTTP_STATUS.CONFLICT, ERROR_CODES.ACCOUNT_NOT_VERIFIED);
      if (m.includes("ref_required")) throw new AppError("Cần nhập mã giao dịch ngân hàng", HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
      handleSupabaseError(error, "Failed to update withdrawal");
    }
    const after = data as Record<string, unknown>;

    // Thông báo cho chủ cửa hàng khi trạng thái thật sự thay đổi (gọi lặp lại không thông báo lại)
    const target: Record<string, string> = { approve: "approved", reject: "rejected", start: "processing", pay: "paid", fail: "failed" };
    if (prior.status !== target[action] && after.status === target[action]) {
      const { data: store } = await supabaseAdmin.from("stores").select("owner_id").eq("id", prior.store_id).maybeSingle();
      const owner = (store as { owner_id: string } | null)?.owner_id;
      const amount = Number(prior.amount_cents).toLocaleString("vi-VN") + "đ";
      const text: Record<string, [string, string]> = {
        approve: ["Lệnh rút tiền đã được duyệt", `Lệnh rút ${amount} đã được duyệt và sẽ được chi sớm.`],
        reject: ["Lệnh rút tiền bị từ chối", `Lệnh rút ${amount} bị từ chối${options.note ? ": " + options.note : ""}. Số tiền đã được trả lại vào số dư khả dụng.`],
        start: ["Lệnh rút tiền đang được chi", `Lệnh rút ${amount} đang được chuyển vào tài khoản của bạn.`],
        pay: ["Đã chi tiền rút", `Đã chuyển ${amount} vào tài khoản của bạn.`],
        fail: ["Chi tiền rút thất bại", `Lệnh rút ${amount} chưa chi được${options.note ? ": " + options.note : ""}. Số tiền vẫn còn trong ví của bạn.`]
      };
      if (owner) await createNotification({ recipientId: owner, roleTarget: "partner", type: "withdrawal-update", title: text[action]![0], body: text[action]![1] });
    }
    return after;
  },

  async financeSummary(): Promise<Record<string, unknown>> {
    const { data, error } = await supabaseAdmin.rpc("fs_finance_summary");
    if (error) handleSupabaseError(error, "Failed to load finance summary");
    return (data as Record<string, unknown> | null) ?? {};
  },

  /** Đối soát: tổng số dư mọi ví = 0 và số dư từng ví = tổng vào - tổng ra */
  async reconcile(): Promise<{ total_balance: number; mismatched_wallets: number; entry_count: number; ok: boolean }> {
    const { data, error } = await supabaseAdmin.rpc("fs_ledger_check");
    if (error) handleSupabaseError(error, "Failed to reconcile ledger");
    const row = (Array.isArray(data) ? data[0] : data) as { total_balance: number | string; mismatched_wallets: number; entry_count: number | string } | null;
    const total = Number(row?.total_balance ?? 0);
    const mismatched = Number(row?.mismatched_wallets ?? 0);
    return { total_balance: total, mismatched_wallets: mismatched, entry_count: Number(row?.entry_count ?? 0), ok: total === 0 && mismatched === 0 };
  },

  async listEntries(filter: { type?: string | undefined; order_number?: string | undefined; from?: string | undefined; to?: string | undefined; page: number; limit: number }): Promise<{ items: unknown[]; total: number }> {
    let orderId: string | null = null;
    if (filter.order_number) {
      const { data: found } = await supabaseAdmin.from("orders").select("id").eq("order_number", filter.order_number).maybeSingle();
      orderId = (found as { id: string } | null)?.id ?? null;
      if (!orderId) return { items: [], total: 0 };
    }
    let query = supabaseAdmin
      .from("ledger_entries")
      .select("id,order_id,entry_type,from_wallet_id,to_wallet_id,amount_cents,metadata,created_at", { count: "exact" })
      .order("created_at", { ascending: false })
      .range((filter.page - 1) * filter.limit, filter.page * filter.limit - 1);
    if (filter.type) query = query.eq("entry_type", filter.type);
    if (orderId) query = query.eq("order_id", orderId);
    if (filter.from) query = query.gte("created_at", filter.from);
    if (filter.to) query = query.lte("created_at", filter.to);
    const { data, error, count } = await query;
    if (error) handleSupabaseError(error, "Failed to list ledger entries");
    const rows = (data ?? []) as LedgerEntry[];

    const { data: wallets } = await supabaseAdmin.from("wallets").select("id,owner_type,store_id").limit(2000);
    const walletRows = (wallets ?? []) as Array<{ id: string; owner_type: string; store_id: string | null }>;
    const storeIds = [...new Set(walletRows.map((w) => w.store_id).filter((id): id is string => Boolean(id)))];
    const storeNames = new Map<string, string>();
    if (storeIds.length > 0) {
      const { data: stores } = await supabaseAdmin.from("stores").select("id,name").in("id", storeIds);
      for (const s of (stores ?? []) as Array<{ id: string; name: string }>) storeNames.set(s.id, s.name);
    }
    const walletLabel = new Map<string, string>();
    const SYSTEM_LABELS: Record<string, string> = { external: "Bên ngoài (khách / ngân hàng)", escrow: "Giữ chờ (escrow)", platform_revenue: "Doanh thu nền tảng", charity_pool: "Quỹ từ thiện" };
    for (const w of walletRows) walletLabel.set(w.id, w.store_id ? `Ví ${storeNames.get(w.store_id) ?? "cửa hàng"}` : SYSTEM_LABELS[w.owner_type] ?? w.owner_type);

    const orderIds = [...new Set(rows.map((row) => row.order_id).filter((id): id is string => Boolean(id)))];
    const numbers = new Map<string, string>();
    if (orderIds.length > 0) {
      const { data: orders } = await supabaseAdmin.from("orders").select("id,order_number").in("id", orderIds);
      for (const o of (orders ?? []) as Array<{ id: string; order_number: string }>) numbers.set(o.id, o.order_number);
    }
    return {
      total: count ?? rows.length,
      items: rows.map((row) => ({
        id: row.id,
        type: row.entry_type,
        order_number: row.order_id ? numbers.get(row.order_id) ?? null : null,
        from: walletLabel.get(row.from_wallet_id) ?? "—",
        to: walletLabel.get(row.to_wallet_id) ?? "—",
        amount: Number(row.amount_cents),
        reason: typeof row.metadata?.reason === "string" ? row.metadata.reason : null,
        created_at: row.created_at
      }))
    };
  }
};
