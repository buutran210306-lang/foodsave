/**
 * Web Push cho NGƯỜI MUA và TÌNH NGUYỆN VIÊN (đặc tả mục 9). Không làm push cho cổng cửa hàng / tổ chức từ thiện.
 * - Khóa VAPID chỉ lấy từ biến môi trường (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT). Thiếu thì push tự tắt, không lỗi.
 * - Gửi tới MỌI thiết bị của người nhận; thiết bị hết hạn (404 / 410) bị xóa khỏi push_subscriptions.
 * - Lỗi push chỉ được ghi log, KHÔNG BAO GIỜ làm hỏng nghiệp vụ gọi nó.
 */
import webpush from "web-push";
import { env } from "../config/env";
import { ERROR_CODES } from "../constants/errors";
import { HTTP_STATUS } from "../constants/http";
import { AppError } from "../utils/appError";
import { logger } from "../utils/logger";
import { allowedUsers, type NotifGroup } from "./notificationPrefs";
import { handleSupabaseError, supabaseAdmin } from "./supabaseService";

export interface PushPayload {
  title: string;
  body: string;
  /** Đường dẫn trong chính FoodSave, ví dụ /FOODSAVE_USER.html#order=<id> */
  url: string;
  /** Đường dẫn trong app người mua (FOODSAVE_APP.html); thiết bị đã đăng ký từ app dùng đường dẫn này */
  appUrl?: string | undefined;
  tag?: string | undefined;
  type?: string | undefined;
}

export interface SubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string | undefined;
  client?: "web" | "app" | undefined;
}

type Owner = { kind: "user"; id: string } | { kind: "volunteer"; id: string };
type Transport = (subscription: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string) => Promise<unknown>;

const SEND_TIMEOUT_MS = 5000;
let transportOverride: Transport | null = null;
let vapidReady = false;

/** Dùng trong kiểm thử: thay đường gửi thật bằng hàm giả */
export const setPushTransport = (transport: Transport | null): void => {
  transportOverride = transport;
};

const isConfigured = (): boolean => Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);

const defaultTransport: Transport = async (subscription, payload) => {
  if (!vapidReady) {
    webpush.setVapidDetails(env.VAPID_SUBJECT as string, env.VAPID_PUBLIC_KEY as string, env.VAPID_PRIVATE_KEY as string);
    vapidReady = true;
  }
  return webpush.sendNotification(subscription, payload, { TTL: 3600, urgency: "normal", timeout: SEND_TIMEOUT_MS });
};

const withTimeout = <T>(work: Promise<T>, ms: number): Promise<T> =>
  Promise.race([work, new Promise<T>((_, reject) => setTimeout(() => reject(new Error("push timeout")), ms))]);

const truncate = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

const ownerColumn = (owner: Owner): string => (owner.kind === "user" ? "user_id" : "volunteer_id");

interface SubscriptionRow { id: string; endpoint: string; p256dh: string; auth: string; client?: string | null }

const sendToOwner = async (owner: Owner, payload: PushPayload): Promise<{ sent: number; removed: number }> => {
  const transport = transportOverride ?? (isConfigured() ? defaultTransport : null);
  if (!transport) return { sent: 0, removed: 0 };

  let data: SubscriptionRow[] | null = null;
  let error: unknown = null;
  const first = await supabaseAdmin.from("push_subscriptions").select("id,endpoint,p256dh,auth,client").eq(ownerColumn(owner), owner.id).limit(20);
  data = first.data as SubscriptionRow[] | null; error = first.error;
  if (error) {   // chưa chạy SQL 037 (chưa có cột client): đọc bản cũ, mọi thiết bị coi là web
    const retry = await supabaseAdmin.from("push_subscriptions").select("id,endpoint,p256dh,auth").eq(ownerColumn(owner), owner.id).limit(20);
    data = retry.data as SubscriptionRow[] | null; error = retry.error;
  }
  if (error) {
    logger.warn("Không đọc được push_subscriptions (đã chạy SQL 032 chưa?)", error);
    return { sent: 0, removed: 0 };
  }
  const rows = (data ?? []) as SubscriptionRow[];
  if (rows.length === 0) return { sent: 0, removed: 0 };

  const bodyFor = (row: SubscriptionRow): string => JSON.stringify({
    title: truncate(payload.title, 80), body: truncate(payload.body, 180),
    url: row.client === "app" && payload.appUrl ? payload.appUrl : payload.url, tag: payload.tag, type: payload.type
  });
  let sent = 0;
  const gone: string[] = [];
  const okIds: string[] = [];
  await Promise.all(rows.map(async (row) => {
    try {
      await withTimeout(transport({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, bodyFor(row)), SEND_TIMEOUT_MS + 1000);
      sent += 1;
      okIds.push(row.id);
    } catch (sendError) {
      const status = (sendError as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) gone.push(row.id);   // thiết bị đã gỡ / hết hạn: dọn luôn
      else logger.warn("Gửi push thất bại", { status, message: sendError instanceof Error ? sendError.message : String(sendError) });
    }
  }));
  if (gone.length > 0) await supabaseAdmin.from("push_subscriptions").delete().in("id", gone);
  if (okIds.length > 0) await supabaseAdmin.from("push_subscriptions").update({ last_used_at: new Date().toISOString() }).in("id", okIds);
  return { sent, removed: gone.length };
};

export const pushService = {
  /** Khóa công khai cho trình duyệt đăng ký; null nếu chưa cấu hình (giao diện ẩn nút bật thông báo) */
  publicKey(): { public_key: string | null; enabled: boolean } {
    return { public_key: env.VAPID_PUBLIC_KEY ?? null, enabled: isConfigured() };
  },

  /** Lưu thiết bị (upsert theo endpoint). Cùng thiết bị đổi người dùng thì chuyển chủ sở hữu. */
  async subscribe(owner: Owner, input: SubscriptionInput): Promise<{ subscribed: true }> {
    if (!/^https:\/\//i.test(input.endpoint)) {
      throw new AppError("Địa chỉ đăng ký thông báo không hợp lệ", HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
    }
    const row = {
      endpoint: input.endpoint,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      user_id: owner.kind === "user" ? owner.id : null,
      volunteer_id: owner.kind === "volunteer" ? owner.id : null,
      role: owner.kind === "user" ? "customer" : "volunteer",
      user_agent: input.userAgent ? input.userAgent.slice(0, 300) : null
    };
    let { error } = await supabaseAdmin.from("push_subscriptions").upsert({ ...row, client: input.client ?? "web" }, { onConflict: "endpoint" });
    if (error) ({ error } = await supabaseAdmin.from("push_subscriptions").upsert(row, { onConflict: "endpoint" }));   // chưa chạy SQL 037
    if (error) handleSupabaseError(error, "Failed to save push subscription");
    return { subscribed: true };
  },

  /** Chỉ xóa thiết bị của chính người gọi */
  async unsubscribe(owner: Owner, endpoint: string): Promise<{ unsubscribed: true }> {
    const { error } = await supabaseAdmin.from("push_subscriptions").delete().eq("endpoint", endpoint).eq(ownerColumn(owner), owner.id);
    if (error) handleSupabaseError(error, "Failed to remove push subscription");
    return { unsubscribed: true };
  },

  async sendToUser(userId: string, payload: PushPayload): Promise<{ sent: number; removed: number }> {
    try {
      return await sendToOwner({ kind: "user", id: userId }, payload);
    } catch (error) {
      logger.warn("Push tới người mua thất bại", error instanceof Error ? error.message : error);
      return { sent: 0, removed: 0 };
    }
  },

  /** Gửi cho mọi người mua đã bật thông báo (trừ ai đã tắt nhóm này). Mỗi người một lần. */
  async sendToAllCustomers(payload: PushPayload, group: NotifGroup): Promise<{ users: number; sent: number }> {
    try {
      const { data, error } = await supabaseAdmin.from("push_subscriptions").select("user_id").eq("role", "customer").not("user_id", "is", null).limit(5000);
      if (error) { logger.warn("Không đọc được push_subscriptions", error); return { users: 0, sent: 0 }; }
      const ids = [...new Set(((data ?? []) as Array<{ user_id: string }>).map((row) => row.user_id))];
      const allowed = [...(await allowedUsers(ids, group))];
      let sent = 0;
      for (let i = 0; i < allowed.length; i += 10) {
        const results = await Promise.all(allowed.slice(i, i + 10).map((id) => sendToOwner({ kind: "user", id }, payload).catch(() => ({ sent: 0, removed: 0 }))));
        sent += results.reduce((a, r) => a + r.sent, 0);
      }
      return { users: allowed.length, sent };
    } catch (error) {
      logger.warn("Push hàng loạt thất bại", error instanceof Error ? error.message : error);
      return { users: 0, sent: 0 };
    }
  },

  async sendToVolunteer(volunteerId: string, payload: PushPayload): Promise<{ sent: number; removed: number }> {
    try {
      return await sendToOwner({ kind: "volunteer", id: volunteerId }, payload);
    } catch (error) {
      logger.warn("Push tới tình nguyện viên thất bại", error instanceof Error ? error.message : error);
      return { sent: 0, removed: 0 };
    }
  }
};
