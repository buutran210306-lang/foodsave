/**
 * Chat theo đơn giữa người mua và cửa hàng (đặc tả 14.3).
 * - Mở từ lúc thanh toán thành công; gửi tin khi đơn pending/confirmed/ready đã thanh toán.
 * - Đơn completed/cancelled/no_show: đóng gửi tin, vẫn xem lại.
 * - Admin chỉ ĐỌC, và chỉ khi đơn có khiếu nại. Không gửi ảnh, tối đa 500 ký tự, 20 tin/phút/người gửi.
 */
import { ERROR_CODES } from "../constants/errors";
import { HTTP_STATUS } from "../constants/http";
import { CHAT_MAX_PER_MINUTE, CHAT_RETENTION_DAYS, DAY_MS } from "../constants/orderPolicy";
import type { UserRole } from "../types/domain";
import { AppError } from "../utils/appError";
import { logger } from "../utils/logger";
import { createNotification } from "./notificationService";
import { handleSupabaseError, supabaseAdmin } from "./supabaseService";

export interface ChatMessage {
  id: string;
  order_id: string;
  sender_id: string | null;
  sender_role: "customer" | "partner" | "system";
  body: string;
  read_at: string | null;
  created_at: string;
}

interface ChatOrder {
  id: string;
  order_number: string;
  customer_id: string;
  status: string;
  payment_status: string;
  store_id: string;
  stores: { owner_id: string; name: string };
}

const OPEN_STATUSES = new Set(["pending", "confirmed", "ready"]);

const forbidden = (message: string): AppError => new AppError(message, HTTP_STATUS.FORBIDDEN, ERROR_CODES.CHAT_FORBIDDEN);

const loadChatOrder = async (orderId: string): Promise<ChatOrder> => {
  const { data, error } = await supabaseAdmin
    .from("orders")
    .select("id,order_number,customer_id,status,payment_status,store_id,stores!inner(owner_id,name)")
    .eq("id", orderId)
    .maybeSingle();
  if (error) handleSupabaseError(error, "Failed to load order for chat");
  if (!data) throw new AppError("Không tìm thấy đơn hàng", HTTP_STATUS.NOT_FOUND, ERROR_CODES.RESOURCE_NOT_FOUND);
  return data as unknown as ChatOrder;
};

/** Trả vai trò chat của người gọi trong đơn này, hoặc ném CHAT_FORBIDDEN */
const resolveSide = async (order: ChatOrder, actorId: string, actorRole: UserRole): Promise<"customer" | "partner" | "admin"> => {
  if (actorRole === "admin") {
    const { count, error } = await supabaseAdmin.from("complaints").select("id", { count: "exact", head: true }).eq("order_id", order.id);
    if (error) handleSupabaseError(error, "Failed to check complaint for chat");
    if ((count ?? 0) === 0) throw forbidden("Admin chỉ xem được chat của đơn có khiếu nại");
    return "admin";
  }
  if (order.customer_id === actorId) return "customer";
  if (order.stores.owner_id === actorId) return "partner";
  throw forbidden("Bạn không thuộc cuộc trò chuyện của đơn này");
};

export const orderChatService = {
  async list(orderId: string, actorId: string, actorRole: UserRole): Promise<{ messages: ChatMessage[]; can_send: boolean }> {
    const order = await loadChatOrder(orderId);
    const side = await resolveSide(order, actorId, actorRole);
    // Chưa thanh toán thì chưa có cuộc trò chuyện
    if (order.payment_status !== "paid" && order.status === "awaiting_payment") return { messages: [], can_send: false };

    const { data, error } = await supabaseAdmin
      .from("order_messages")
      .select("id,order_id,sender_id,sender_role,body,read_at,created_at")
      .eq("order_id", orderId)
      .order("created_at", { ascending: true })
      .limit(300);
    if (error) handleSupabaseError(error, "Failed to load chat messages");
    return {
      messages: (data ?? []) as ChatMessage[],
      can_send: side !== "admin" && order.payment_status === "paid" && OPEN_STATUSES.has(order.status)
    };
  },

  async send(orderId: string, actorId: string, actorRole: UserRole, body: string): Promise<ChatMessage> {
    if (actorRole === "admin") throw forbidden("Admin chỉ được xem chat, không gửi tin");
    const order = await loadChatOrder(orderId);
    const side = await resolveSide(order, actorId, actorRole);
    if (side === "admin") throw forbidden("Admin chỉ được xem chat, không gửi tin");

    if (order.payment_status !== "paid" || !OPEN_STATUSES.has(order.status)) {
      throw new AppError("Cuộc trò chuyện của đơn này đã đóng, chỉ còn xem lại", HTTP_STATUS.CONFLICT, ERROR_CODES.CHAT_CLOSED);
    }

    const since = new Date(Date.now() - 60_000).toISOString();
    const { count, error: rateError } = await supabaseAdmin
      .from("order_messages")
      .select("id", { count: "exact", head: true })
      .eq("sender_id", actorId)
      .gte("created_at", since);
    if (rateError) handleSupabaseError(rateError, "Failed to check chat rate");
    if ((count ?? 0) >= CHAT_MAX_PER_MINUTE) {
      throw new AppError(`Bạn gửi quá nhanh (tối đa ${CHAT_MAX_PER_MINUTE} tin/phút). Vui lòng đợi một chút.`, HTTP_STATUS.TOO_MANY_REQUESTS, ERROR_CODES.CHAT_RATE_LIMITED);
    }

    const { data, error } = await supabaseAdmin
      .from("order_messages")
      .insert({ order_id: orderId, sender_id: actorId, sender_role: side, body })
      .select("id,order_id,sender_id,sender_role,body,read_at,created_at")
      .single();
    if (error) handleSupabaseError(error, "Failed to send chat message");

    const preview = body.length > 120 ? `${body.slice(0, 117)}...` : body;
    if (side === "customer") {
      await createNotification({
        recipientId: order.stores.owner_id,
        roleTarget: "partner",
        type: "order-chat",
        title: `Tin nhắn mới · đơn ${order.order_number}`,
        body: preview,
        relatedType: "order",
        relatedId: order.id
      });
    } else {
      await createNotification({
        recipientId: order.customer_id,
        roleTarget: "customer",
        type: "order-chat",
        title: `${order.stores.name} nhắn bạn · đơn ${order.order_number}`,
        body: preview,
        relatedType: "order",
        relatedId: order.id
      });
    }
    return data as ChatMessage;
  },

  async markRead(orderId: string, actorId: string, actorRole: UserRole): Promise<{ updated: number }> {
    if (actorRole === "admin") return { updated: 0 };
    const order = await loadChatOrder(orderId);
    const side = await resolveSide(order, actorId, actorRole);
    if (side === "admin") return { updated: 0 };
    const otherRoles = side === "customer" ? ["partner", "system"] : ["customer", "system"];
    const { data, error } = await supabaseAdmin
      .from("order_messages")
      .update({ read_at: new Date().toISOString() })
      .eq("order_id", orderId)
      .in("sender_role", otherRoles)
      .is("read_at", null)
      .select("id");
    if (error) handleSupabaseError(error, "Failed to mark chat read");
    return { updated: (data ?? []).length };
  },

  /** Số tin chưa đọc theo từng đơn của người gọi (cửa hàng dùng để hiện chấm đỏ trên danh sách đơn) */
  async unreadByOrder(actorId: string, actorRole: UserRole): Promise<Record<string, number>> {
    const field = actorRole === "partner" ? "stores!inner(owner_id)" : "";
    let query = supabaseAdmin
      .from("orders")
      .select(`id${field ? `,${field}` : ""}`)
      .in("status", ["pending", "confirmed", "ready"])
      .eq("payment_status", "paid")
      .limit(200);
    if (actorRole === "partner") query = query.eq("stores.owner_id", actorId);
    else query = query.eq("customer_id", actorId);
    const { data: orders, error } = await query;
    if (error) handleSupabaseError(error, "Failed to load orders for unread chat");
    const ids = ((orders ?? []) as unknown as Array<{ id: string }>).map((row) => row.id);
    if (ids.length === 0) return {};

    const fromRoles = actorRole === "partner" ? ["customer"] : ["partner"];
    const { data: unread, error: unreadError } = await supabaseAdmin
      .from("order_messages")
      .select("order_id")
      .in("order_id", ids)
      .in("sender_role", fromRoles)
      .is("read_at", null)
      .limit(1000);
    if (unreadError) handleSupabaseError(unreadError, "Failed to count unread chat");
    const result: Record<string, number> = {};
    for (const row of (unread ?? []) as Array<{ order_id: string }>) result[row.order_id] = (result[row.order_id] ?? 0) + 1;
    return result;
  },

  /** Tin hệ thống ("Cuộc trò chuyện được mở…"). Không bao giờ ném lỗi. */
  async postSystem(orderId: string, body: string): Promise<void> {
    try {
      const { error } = await supabaseAdmin.from("order_messages").insert({ order_id: orderId, sender_id: null, sender_role: "system", body });
      if (error) logger.warn("Không ghi được tin hệ thống của chat", { orderId, error });
    } catch (error) {
      logger.warn("Không ghi được tin hệ thống của chat", { orderId, error });
    }
  },

  /**
   * Xóa tin của đơn đã kết thúc quá 30 ngày (trừ đơn còn khiếu nại chưa xong).
   * Gọi từ tác vụ định kỳ; mỗi lần xử lý tối đa 200 đơn.
   */
  async purgeOldMessages(): Promise<number> {
    const cutoff = new Date(Date.now() - CHAT_RETENTION_DAYS * DAY_MS).toISOString();
    const { data: orders, error } = await supabaseAdmin
      .from("orders")
      .select("id")
      .in("status", ["completed", "cancelled", "no_show"])
      .lt("updated_at", cutoff)
      .limit(200);
    if (error) handleSupabaseError(error, "Failed to load old orders for chat purge");
    const ids = ((orders ?? []) as Array<{ id: string }>).map((row) => row.id);
    if (ids.length === 0) return 0;

    const { data: openComplaints } = await supabaseAdmin
      .from("complaints")
      .select("order_id")
      .in("order_id", ids)
      .in("status", ["open", "in_review"]);
    const keep = new Set(((openComplaints ?? []) as Array<{ order_id: string }>).map((row) => row.order_id));
    const deletable = ids.filter((id) => !keep.has(id));
    if (deletable.length === 0) return 0;

    const { data: deleted, error: deleteError } = await supabaseAdmin.from("order_messages").delete().in("order_id", deletable).select("id");
    if (deleteError) handleSupabaseError(deleteError, "Failed to purge old chat messages");
    return (deleted ?? []).length;
  }
};
