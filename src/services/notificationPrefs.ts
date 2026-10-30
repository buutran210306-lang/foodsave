/**
 * Cài đặt thông báo đẩy của người mua (Cá nhân → Thông báo). Lưu ở profiles.metadata.notification_prefs
 * = { orders?: boolean, chat?: boolean, promo?: boolean } (không có = bật). Chỉ ảnh hưởng thông báo ĐẨY (push):
 * thông báo trong app (chuông) luôn được ghi.
 */
import { supabaseAdmin } from "./supabaseService";

export type NotifGroup = "orders" | "chat" | "promo";

const GROUPS: Record<string, NotifGroup> = {
  "order-paid": "orders", "order-update": "orders", "order-ready": "orders", "order-reminder-mid": "orders", "order-reminder-final": "orders",
  "order-no-show": "orders", "no-show-warning": "orders", "red-label-banned": "orders",
  "order-chat": "chat", "complaint-update": "chat", "complaint-decision": "chat",
  "voucher-new": "promo", "flash-deal": "promo"
};

export const groupOf = (type: string): NotifGroup | null => GROUPS[type] ?? null;

/** Trong danh sách người nhận, những ai KHÔNG tắt nhóm này */
export const allowedUsers = async (userIds: string[], group: NotifGroup): Promise<Set<string>> => {
  const allowed = new Set<string>();
  const unique = [...new Set(userIds)];
  for (let i = 0; i < unique.length; i += 200) {
    const chunk = unique.slice(i, i + 200);
    const { data, error } = await supabaseAdmin.from("profiles").select("id,metadata").in("id", chunk);
    if (error) { chunk.forEach((id) => allowed.add(id)); continue; }   // không đọc được cài đặt thì mặc định cho gửi
    const off = new Set<string>();
    for (const row of (data ?? []) as Array<{ id: string; metadata: { notification_prefs?: Record<string, unknown> } | null }>) {
      if (row.metadata?.notification_prefs?.[group] === false) off.add(row.id);
    }
    chunk.forEach((id) => { if (!off.has(id)) allowed.add(id); });
  }
  return allowed;
};
