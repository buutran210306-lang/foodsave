import type { NotificationListQuery } from "../schemas/notificationSchemas";
import type { PaginatedResponse } from "../types/api";
import type { Notification, UserRole } from "../types/domain";
import { getRange, handleSupabaseError, supabaseAdmin, toPagination } from "./supabaseService";

export const notificationService = {
  async listNotifications(userId: string, role: UserRole, query: NotificationListQuery): Promise<PaginatedResponse<Notification>> {
    const { from, to } = getRange(query);
    let request = supabaseAdmin
      .from("notifications")
      .select("*", { count: "exact" })
      .or(`recipient_id.eq.${userId},role_target.eq.${role}`)
      .range(from, to)
      .order("created_at", { ascending: false });

    if (query.unread_only) request = request.is("read_at", null);

    const { data, error, count } = await request;
    if (error) handleSupabaseError(error, "Failed to load notifications");

    return {
      items: (data ?? []) as Notification[],
      pagination: toPagination(query.page, query.limit, count ?? 0)
    };
  },

  async markRead(userId: string, role: UserRole, notificationId: string): Promise<Notification> {
    const { data, error } = await supabaseAdmin
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", notificationId)
      .or(`recipient_id.eq.${userId},role_target.eq.${role}`)
      .select("*")
      .single();

    if (error) handleSupabaseError(error, "Failed to mark notification read");
    return data as Notification;
  },

  async markAllRead(userId: string, role: UserRole): Promise<void> {
    const { error } = await supabaseAdmin
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .is("read_at", null)
      .or(`recipient_id.eq.${userId},role_target.eq.${role}`);

    if (error) handleSupabaseError(error, "Failed to mark notifications read");
  }
};
