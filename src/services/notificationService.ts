import type { NotificationListQuery } from "../schemas/notificationSchemas";
import type { PaginatedResponse } from "../types/api";
import type { Notification, UserRole } from "../types/domain";
import { getRange, handleSupabaseError, requireRecord, supabaseAdmin, toPagination } from "./supabaseService";

// Thông báo gửi riêng (recipient_id) dùng cột read_at.
// Thông báo gửi theo vai trò (role_target) dùng bảng notification_reads để mỗi người có trạng thái đọc riêng.
const visibleTo = (userId: string, role: UserRole): string => `recipient_id.eq.${userId},and(recipient_id.is.null,role_target.eq.${role})`;

const loadReadIds = async (userId: string, notificationIds: string[]): Promise<Set<string>> => {
  if (notificationIds.length === 0) return new Set();
  const { data, error } = await supabaseAdmin
    .from("notification_reads")
    .select("notification_id")
    .eq("user_id", userId)
    .in("notification_id", notificationIds);

  if (error) handleSupabaseError(error, "Failed to load notification read state");
  return new Set((data ?? []).map((row) => (row as { notification_id: string }).notification_id));
};

const withPersonalReadState = async (userId: string, notifications: Notification[]): Promise<Notification[]> => {
  const broadcastIds = notifications.filter((item) => !item.recipient_id).map((item) => item.id);
  const readIds = await loadReadIds(userId, broadcastIds);
  return notifications.map((item) => {
    if (item.recipient_id) return item;
    return { ...item, read_at: readIds.has(item.id) ? item.read_at ?? item.created_at : null };
  });
};

export const notificationService = {
  async listNotifications(userId: string, role: UserRole, query: NotificationListQuery): Promise<PaginatedResponse<Notification>> {
    const { from, to } = getRange(query);
    const { data, error, count } = await supabaseAdmin
      .from("notifications")
      .select("*", { count: "exact" })
      .or(visibleTo(userId, role))
      .range(from, to)
      .order("created_at", { ascending: false });

    if (error) handleSupabaseError(error, "Failed to load notifications");
    let items = await withPersonalReadState(userId, (data ?? []) as Notification[]);
    if (query.unread_only) items = items.filter((item) => !item.read_at);

    return {
      items,
      pagination: toPagination(query.page, query.limit, count ?? 0)
    };
  },

  async markRead(userId: string, role: UserRole, notificationId: string): Promise<Notification> {
    const { data, error } = await supabaseAdmin
      .from("notifications")
      .select("*")
      .eq("id", notificationId)
      .or(visibleTo(userId, role))
      .maybeSingle();

    if (error) handleSupabaseError(error, "Failed to load notification");
    const notification = requireRecord(data as Notification | null, "Notification was not found");
    const readAt = new Date().toISOString();

    if (notification.recipient_id) {
      const { data: updated, error: updateError } = await supabaseAdmin
        .from("notifications")
        .update({ read_at: readAt })
        .eq("id", notificationId)
        .select("*")
        .single();

      if (updateError) handleSupabaseError(updateError, "Failed to mark notification read");
      return updated as Notification;
    }

    const { error: readError } = await supabaseAdmin
      .from("notification_reads")
      .upsert({ notification_id: notificationId, user_id: userId, read_at: readAt }, { onConflict: "notification_id,user_id" });

    if (readError) handleSupabaseError(readError, "Failed to mark notification read");
    return { ...notification, read_at: readAt };
  },

  async markAllRead(userId: string, role: UserRole): Promise<void> {
    const readAt = new Date().toISOString();
    const { error } = await supabaseAdmin
      .from("notifications")
      .update({ read_at: readAt })
      .is("read_at", null)
      .eq("recipient_id", userId);

    if (error) handleSupabaseError(error, "Failed to mark notifications read");

    const { data: broadcasts, error: broadcastError } = await supabaseAdmin
      .from("notifications")
      .select("id")
      .is("recipient_id", null)
      .eq("role_target", role)
      .order("created_at", { ascending: false })
      .limit(500);

    if (broadcastError) handleSupabaseError(broadcastError, "Failed to load notifications");
    const rows = (broadcasts ?? []).map((row) => ({ notification_id: (row as { id: string }).id, user_id: userId, read_at: readAt }));
    if (rows.length === 0) return;

    const { error: readError } = await supabaseAdmin
      .from("notification_reads")
      .upsert(rows, { onConflict: "notification_id,user_id", ignoreDuplicates: true });

    if (readError) handleSupabaseError(readError, "Failed to mark notifications read");
  }
};
