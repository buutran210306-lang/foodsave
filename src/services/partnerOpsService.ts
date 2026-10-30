/**
 * Đợt 4b, cổng cửa hàng: Khách hàng (tổng hợp từ đơn của CHÍNH cửa hàng, số điện thoại che ở máy chủ) và Khuyến mãi (voucher của cửa hàng).
 * Cửa hàng chỉ thấy khách đã từng đặt đơn tại cửa hàng mình; không bao giờ thấy số điện thoại đầy đủ.
 */
import { ERROR_CODES } from "../constants/errors";
import { HTTP_STATUS } from "../constants/http";
import { AppError } from "../utils/appError";
import { adminOpsService, type VoucherInput } from "./adminOpsService";
import { handleSupabaseError, supabaseAdmin } from "./supabaseService";

type Row = Record<string, any>;

/** 0912345678 -> 091••••678 (giữ 3 số đầu, 3 số cuối). Quá ngắn thì che toàn bộ. */
export const maskPhone = (phone: unknown): string => {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (digits.length < 7) return digits ? "••••" : "";
  return `${digits.slice(0, 3)}${"•".repeat(digits.length - 6)}${digits.slice(-3)}`;
};

const ownStoreIds = async (ownerId: string): Promise<string[]> => {
  const { data, error } = await supabaseAdmin.from("stores").select("id").eq("owner_id", ownerId).order("created_at", { ascending: true });
  if (error) handleSupabaseError(error, "Failed to load stores");
  return ((data ?? []) as Row[]).map((row) => String(row.id));
};

export const partnerOpsService = {
  async customers(ownerId: string): Promise<{ items: Row[]; total: number }> {
    const storeIds = await ownStoreIds(ownerId);
    if (storeIds.length === 0) return { items: [], total: 0 };
    const { data, error } = await supabaseAdmin
      .from("orders")
      .select("customer_id,status,total_cents,created_at")
      .in("store_id", storeIds)
      .neq("status", "awaiting_payment")
      .order("created_at", { ascending: false })
      .limit(5000);
    if (error) handleSupabaseError(error, "Failed to load store orders");
    const stats = new Map<string, { orders: number; completed: number; cancelled: number; no_show: number; spent_cents: number; last_order_at: string }>();
    for (const order of (data ?? []) as Row[]) {
      const id = String(order.customer_id);
      const stat = stats.get(id) ?? { orders: 0, completed: 0, cancelled: 0, no_show: 0, spent_cents: 0, last_order_at: String(order.created_at) };
      stat.orders += 1;
      if (order.status === "completed") { stat.completed += 1; stat.spent_cents += Number(order.total_cents || 0); }
      if (order.status === "cancelled") stat.cancelled += 1;
      if (order.status === "no_show") stat.no_show += 1;
      if (String(order.created_at) > stat.last_order_at) stat.last_order_at = String(order.created_at);
      stats.set(id, stat);
    }
    const ids = [...stats.keys()];
    const profiles = new Map<string, Row>();
    if (ids.length > 0) {
      const { data: profileData, error: profileError } = await supabaseAdmin.from("profiles").select("id,full_name,phone,points,rank").in("id", ids);
      if (profileError) handleSupabaseError(profileError, "Failed to load customers");
      for (const profile of (profileData ?? []) as Row[]) profiles.set(String(profile.id), profile);
    }
    const items = ids.map((id) => {
      const stat = stats.get(id)!;
      const profile = profiles.get(id);
      return {
        customer_id: id, name: profile?.full_name || "Khách", phone_masked: maskPhone(profile?.phone), rank: profile?.rank ?? "",
        points: profile?.points ?? null, ...stat
      };
    }).sort((a, b) => b.last_order_at.localeCompare(a.last_order_at));
    return { items, total: items.length };
  },

  async listVouchers(ownerId: string): Promise<Row[]> {
    return adminOpsService.listVouchers(await ownStoreIds(ownerId));
  },

  async createVoucher(ownerId: string, input: VoucherInput): Promise<Row> {
    const storeId = (await ownStoreIds(ownerId))[0];
    if (!storeId) throw new AppError("Chưa có cửa hàng nào cho tài khoản này", HTTP_STATUS.NOT_FOUND, ERROR_CODES.RESOURCE_NOT_FOUND);
    return adminOpsService.createVoucher(storeId, input, null);
  },

  async toggleVoucher(ownerId: string, voucherId: string, isActive: boolean): Promise<Row> {
    return adminOpsService.toggleVoucher(voucherId, isActive, await ownStoreIds(ownerId), null);
  }
};
