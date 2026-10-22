import { env } from "../config/env";
import { ERROR_CODES } from "../constants/errors";
import { HTTP_STATUS } from "../constants/http";
import type { UserRole } from "../types/domain";
import { AppError } from "../utils/appError";
import { logger } from "../utils/logger";
import { handleSupabaseError, requireRecord, supabaseAdmin } from "./supabaseService";

// Marketing Studio: viết sẵn bài đăng, đẩy thông báo cho người mua, đăng Facebook (qua n8n, dự phòng đăng trực tiếp)
// Quy tắc nội dung: KHÔNG ghi số lượng còn lại (bài đã đăng sẽ sai khi hàng bán hết).

export const MARKETING_CHANNELS = ["buyers", "facebook", "instagram", "tiktok", "zalo"] as const;
export type MarketingChannel = typeof MARKETING_CHANNELS[number];
// Kênh đăng/gửi thật. Các kênh còn lại chỉ tạo sẵn nội dung ("ready")
const REAL_CHANNELS: MarketingChannel[] = ["buyers", "facebook"];
// Thông tin bắt buộc để coi một kênh là "đã kết nối"
const REQUIRED_INFO: Record<string, string[]> = { instagram: ["username"], tiktok: ["username"], zalo: ["oa_name"] };

const PROMOTE_COOLDOWN_MINUTES = 20; // một sản phẩm chỉ được "đẩy" cho người mua mỗi 20 phút
const CENTRAL_REPOST_HOURS = 6; // kênh chung của FoodSave không đăng lại cùng một sản phẩm trong 6 tiếng
const CENTRAL_PER_RUN = 5; // mỗi lượt n8n chạy đăng tối đa 5 bài
const CENTRAL_PER_DAY = 12; // tối đa 12 bài mỗi ngày (tránh spam, tránh chạm giới hạn của Meta)
const GREEN_CAMPAIGNS_PER_DAY = 2; // hàng xanh chỉ đăng thủ công, tối đa 2 chiến dịch mỗi ngày mỗi cửa hàng
const REMINDER_MAX_HOURS = 2; // bài nhắc gửi khi còn tối đa 2 giờ...
const REMINDER_MIN_HOURS = 1; // ...và còn ít nhất 1 giờ (sau đó hệ thống ngừng nhận đặt)
const REMINDER_AFTER_MAIN_MINUTES = 30; // bài nhắc chỉ gửi khi bài chính đã đăng quá 30 phút

const conflict = (message: string): AppError => new AppError(message, HTTP_STATUS.CONFLICT, ERROR_CODES.RESOURCE_CONFLICT);
const forbidden = (message: string): AppError => new AppError(message, HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN);

interface StoreInfo {
  id: string;
  name: string;
  owner_id: string;
  address: string | null;
  district: string | null;
}

interface ProductInfo {
  id: string;
  store_id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  image_urls: string[] | null;
  emoji: string | null;
  category: string | null;
  food_group: "cooked" | "fresh" | "packaged" | null;
  price_cents: number;
  original_price_cents: number;
  label: "green" | "yellow" | "red";
  stock_quantity: number;
  is_active: boolean;
  expires_at: string;
  effective_deadline_at: string | null;
  stores: StoreInfo;
}

const PRODUCT_SELECT = "id,store_id,name,description,image_url,image_urls,emoji,category,food_group,price_cents,original_price_cents,label,stock_quantity,is_active,expires_at,effective_deadline_at,stores!inner(id,name,owner_id,address,district)";

// ───── Tiện ích định dạng (giờ Việt Nam)
const money = (value: number): string => Math.round(value).toLocaleString("vi-VN") + "đ";
const VN_TZ = "Asia/Ho_Chi_Minh";
const vnTime = (iso: string): string => new Date(iso).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", timeZone: VN_TZ });
const vnDay = (iso: string): string => new Date(iso).toLocaleDateString("en-CA", { timeZone: VN_TZ });
const vnDayMonth = (iso: string): string => new Date(iso).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", timeZone: VN_TZ });
const startOfTodayVn = (): string => new Date(new Date(vnDay(new Date().toISOString()) + "T00:00:00+07:00")).toISOString();
const hashOf = (text: string): number => Array.from(text).reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 7);
const slug = (text: string): string => text.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").replace(/[^a-zA-Z0-9]+/g, " ").trim().split(" ").filter(Boolean).map((word) => (word[0] ?? "").toUpperCase() + word.slice(1)).join("");

export interface MarketingContent {
  variant: "main" | "reminder";
  discount_percent: number;
  headline: string;
  facebook: string;
  instagram: string;
  tiktok: string;
  zalo: string;
  hashtags: string[];
  deadline_text: string;
  product_url: string;
}

const shortAddress = (store: StoreInfo): string => {
  const parts = (store.address ?? "").split(",").map((part) => part.trim()).filter(Boolean);
  const base = parts.slice(0, 2).join(", ");
  if (store.district && !base.toLowerCase().includes(store.district.toLowerCase())) return [base, store.district].filter(Boolean).join(", ");
  return base;
};

const deadlineOf = (product: ProductInfo): string => product.effective_deadline_at ?? product.expires_at;

// Nội dung bài đăng theo nhóm hàng (nấu chín / tươi sống / đóng gói) và nhãn (đỏ gấp, vàng nhẹ, xanh giới thiệu). Không ghi số lượng còn lại.
export const buildMarketingContent = (product: ProductInfo, variant: "main" | "reminder" = "main"): MarketingContent => {
  const store = product.stores;
  const group = product.food_group ?? "cooked";
  const price = money(product.price_cents);
  const original = product.original_price_cents > product.price_cents ? money(product.original_price_cents) : "";
  const computed = product.original_price_cents > 0 ? Math.round((1 - product.price_cents / product.original_price_cents) * 100) : 0;
  const discount = computed > 0 ? computed : product.label === "red" ? 80 : product.label === "yellow" ? 50 : 0;
  const deadlineIso = deadlineOf(product);
  const time = vnTime(deadlineIso);
  const today = vnDay(deadlineIso) === vnDay(new Date().toISOString());
  const dayText = today ? "hôm nay" : vnDayMonth(deadlineIso);
  const expiryDate = vnDayMonth(product.expires_at);
  const addr = shortAddress(store);
  const url = env.PUBLIC_SITE_URL + (env.PUBLIC_SITE_URL.includes("?") ? "&" : "?") + "product=" + product.id;
  const place = `🏪 ${store.name}${addr ? " · " + addr : ""}`;
  const priceLine = original ? `💸 ${original} → ${price}` : `💸 ${price}`;
  const hashtags = ["FoodSave", group === "packaged" ? "SanPhamCanHan" : "CuuThucPham", "GiamLangPhi", slug(store.name)].filter(Boolean).map((tag) => "#" + tag);
  const pickup = "📍 Tự đến cửa hàng nhận, không giao hàng";
  const label = product.label;

  let headline: string;
  let body: string[];
  if (variant === "reminder") {
    headline = `⚡ Sắp hết giờ! ${product.name} tại ${store.name} chỉ ${price}`;
    body = [headline, `Lấy trước ${time} ${dayText}.`, `👉 ${url}`];
  } else if (label === "red") {
    if (group === "cooked") {
      headline = `🔥 GIẢI CỨU GẤP: ${product.name} giảm ${discount}%`;
      body = [headline, "", place, priceLine, `⏰ Lấy trước ${time} ${dayText} · số lượng có hạn`, "", "Món vẫn mới nấu hôm nay, chỉ là sắp hết giờ bán. Ghé lấy giúp tiệm để không phải bỏ đi 💚", "", `👉 Đặt giữ phần trên FoodSave: ${url}`, pickup, "", hashtags.join(" ")];
    } else if (group === "fresh") {
      headline = `🥬 ${product.name} giảm ${discount}%, dùng tốt đến ${expiryDate}`;
      body = [headline, "", place, priceLine, `📅 Hạn dùng: ${expiryDate} · lấy trước ${time} ${dayText}`, "", "Hàng vẫn tươi, chỉ gần hạn nên giảm sâu. Mua hôm nay là tiết kiệm và cứu thêm một phần thực phẩm 💚", "", `👉 Đặt giữ trên FoodSave: ${url}`, pickup, "", hashtags.join(" ")];
    } else {
      headline = `💥 ${product.name} giảm ${discount}% · hạn đến ${expiryDate}`;
      body = [headline, "", place, priceLine, `📦 Số lượng có hạn · lấy trước ${dayText === "hôm nay" ? "hôm nay" : dayText}`, "", "Hạn dùng còn đủ để bạn dùng hoặc tặng người thân. Đặt giữ trước, đến lấy sau 💚", "", `👉 Đặt trên FoodSave: ${url}`, pickup, "", hashtags.join(" ")];
    }
  } else if (label === "yellow") {
    headline = group === "packaged" ? `⏰ Giá mềm hôm nay: ${product.name} giảm ${discount}% · hạn dùng đến ${expiryDate}` : group === "fresh" ? `⏰ Hôm nay giảm ${discount}%: ${product.name} · dùng tốt đến ${expiryDate}` : `⏰ Hôm nay giảm ${discount}%: ${product.name}`;
    const note = group === "cooked" ? "Món ngon, vẫn mới trong ngày, giá mềm hơn để bạn thưởng thức 💚" : group === "fresh" ? "Hàng vẫn tươi ngon, giá mềm hơn khi gần đến hạn 💚" : "Hạn dùng còn dài, giá mềm hơn bình thường 💚";
    body = [headline, "", place, priceLine, `🕒 Lấy trước ${time} ${dayText}`, "", note, "", `👉 Đặt trên FoodSave: ${url}`, pickup, "", hashtags.join(" ")];
  } else {
    headline = `🌱 ${product.name} tại ${store.name}`;
    body = [headline, "", place, priceLine, "", "Món ngon, đặt giữ trước trên FoodSave rồi ghé lấy theo giờ hẹn 💚", "", `👉 ${url}`, pickup, "", hashtags.join(" ")];
  }

  const facebook = body.join("\n");
  const instagram = [headline, place, priceLine, `Lấy trước ${time} ${dayText} · số lượng có hạn`, "Link đặt giữ ở bio 💚", "", hashtags.join(" ")].join("\n");
  const tiktok = [
    `${headline} ${hashtags.slice(0, 3).join(" ")}`,
    "",
    "Gợi ý kịch bản video 15 giây:",
    `1) 0-3s: Cầm ${product.name} lên hình, nói "Giảm tới ${discount}% chỉ hôm nay!"`,
    `2) 3-10s: Quay cận cảnh món, giá ${price}`,
    `3) 10-15s: "Lấy trước ${time} tại ${store.name}. Đặt giữ qua FoodSave nhé!"`
  ].join("\n");
  const zalo = [headline, place, priceLine, `Lấy trước ${time} ${dayText}`, `👉 ${url}`].join("\n");

  return { variant, discount_percent: discount, headline, facebook, instagram, tiktok, zalo, hashtags, deadline_text: `${time} ${dayText}`, product_url: url };
};

const imageOf = (product: ProductInfo): string | null => product.image_url ?? product.image_urls?.[0] ?? null;

const loadProduct = async (productId: string): Promise<ProductInfo> => {
  const { data, error } = await supabaseAdmin.from("products").select(PRODUCT_SELECT).eq("id", productId).maybeSingle();
  if (error) handleSupabaseError(error, "Failed to load product");
  return requireRecord(data as unknown as ProductInfo | null, "Không tìm thấy sản phẩm");
};

const assertStoreAccess = async (store: StoreInfo, actorId: string, actorRole: UserRole): Promise<void> => {
  if (actorRole === "admin") return;
  if (actorRole !== "partner" || store.owner_id !== actorId) throw forbidden("Bạn không phải chủ cửa hàng này");
};

// ───── Cài đặt kênh của cửa hàng
interface ChannelState { enabled: boolean; connected: boolean; info: Record<string, string> }
interface StoreMarketing {
  marketing_auto: boolean;
  facebook_page_id: string | null;
  facebook_page_name: string | null;
  channels: Record<MarketingChannel, ChannelState>;
}

const normalizeChannels = (raw: unknown, pageId: string | null, pageName: string | null): Record<MarketingChannel, ChannelState> => {
  const stored = (raw && typeof raw === "object" ? raw : {}) as Record<string, { enabled?: boolean; info?: Record<string, string> } | undefined>;
  const result = {} as Record<MarketingChannel, ChannelState>;
  for (const key of MARKETING_CHANNELS) {
    const entry = stored[key] ?? {};
    const info: Record<string, string> = { ...(entry.info ?? {}) };
    if (key === "facebook") { info.page_id = pageId ?? ""; info.page_name = pageName ?? ""; }
    const connected = key === "buyers" ? true : key === "facebook" ? Boolean(pageId) : (REQUIRED_INFO[key] ?? []).every((field) => String(info[field] ?? "").trim() !== "");
    const defaultOn = key === "buyers" ? true : connected;
    result[key] = { enabled: key === "buyers" ? true : connected && (entry.enabled ?? defaultOn), connected, info };
  }
  return result;
};

// Cột mới có thể chưa tồn tại nếu chưa chạy SQL 024/025: đọc riêng và bỏ qua lỗi
const loadStoreMarketing = async (storeId: string): Promise<StoreMarketing> => {
  const empty = normalizeChannels({}, null, null);
  const { data, error } = await supabaseAdmin.from("stores").select("marketing_auto,facebook_page_id,facebook_page_name,marketing_channels").eq("id", storeId).maybeSingle();
  if (error) {
    const { data: basic, error: basicError } = await supabaseAdmin.from("stores").select("marketing_auto,facebook_page_id,facebook_page_name").eq("id", storeId).maybeSingle();
    if (basicError) return { marketing_auto: false, facebook_page_id: null, facebook_page_name: null, channels: empty };
    const row = basic as { marketing_auto: boolean | null; facebook_page_id: string | null; facebook_page_name: string | null } | null;
    return { marketing_auto: Boolean(row?.marketing_auto), facebook_page_id: row?.facebook_page_id ?? null, facebook_page_name: row?.facebook_page_name ?? null, channels: normalizeChannels({}, row?.facebook_page_id ?? null, row?.facebook_page_name ?? null) };
  }
  const row = data as { marketing_auto: boolean | null; facebook_page_id: string | null; facebook_page_name: string | null; marketing_channels: unknown } | null;
  return { marketing_auto: Boolean(row?.marketing_auto), facebook_page_id: row?.facebook_page_id ?? null, facebook_page_name: row?.facebook_page_name ?? null, channels: normalizeChannels(row?.marketing_channels, row?.facebook_page_id ?? null, row?.facebook_page_name ?? null) };
};

type PostRow = {
  store_id: string | null;
  product_id: string | null;
  channel: MarketingChannel;
  kind: "manual" | "auto" | "central";
  variant?: "main" | "reminder";
  content?: string | null;
  image_url?: string | null;
  status: "queued" | "sent" | "failed" | "posted" | "ready";
  external_id?: string | null;
  external_url?: string | null;
  error?: string | null;
  tier?: "ai" | "template" | "direct" | null;
  meta?: Record<string, unknown>;
};

// Ghi nhật ký. Cột tier/meta nằm trong SQL 026: nếu chưa chạy thì ghi lại không có hai cột này để không mất nhật ký.
const logPost = async (row: PostRow): Promise<string | null> => {
  const insert = async (payload: Record<string, unknown>) => supabaseAdmin.from("marketing_posts").insert({ variant: "main", ...payload }).select("id").maybeSingle();
  let { data, error } = await insert({ ...row });
  if (error && (error.code === "42703" || error.code === "PGRST204")) {
    const { tier: _tier, meta: _meta, ...rest } = row;
    ({ data, error } = await insert({ ...rest }));
  }
  if (error) {
    logger.warn("Không ghi được nhật ký marketing", error);
    return null;
  }
  return (data as { id: string } | null)?.id ?? null;
};

const updatePost = async (id: string | null, patch: Record<string, unknown>): Promise<void> => {
  if (!id) return;
  let { error } = await supabaseAdmin.from("marketing_posts").update(patch).eq("id", id);
  if (error && (error.code === "42703" || error.code === "PGRST204")) {
    const { tier: _tier, meta: _meta, ...rest } = patch;
    ({ error } = await supabaseAdmin.from("marketing_posts").update(rest).eq("id", id));
  }
  if (error) logger.warn("Không cập nhật được nhật ký marketing", error);
};

// ───── Cài đặt chung của hệ thống (bảng app_settings trong SQL 026). Chưa có bảng thì dùng giá trị mặc định.
const getAppSetting = async <T>(key: string, fallback: T): Promise<T> => {
  const { data, error } = await supabaseAdmin.from("app_settings").select("value").eq("key", key).maybeSingle();
  if (error || !data) return fallback;
  return ((data as { value: T }).value ?? fallback) as T;
};
const setAppSetting = async (key: string, value: unknown): Promise<void> => {
  const { error } = await supabaseAdmin.from("app_settings").upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new AppError("Không lưu được cài đặt. Hãy chạy file SQL 026 trên Supabase.", HTTP_STATUS.INTERNAL_SERVER_ERROR, ERROR_CODES.INTERNAL_SERVER_ERROR);
};
// Công tắc "AI Agent": bật thì n8n được dùng AI viết caption và tạo ảnh; tắt thì n8n dùng ngay caption mẫu
const aiEnabled = async (): Promise<boolean> => (await getAppSetting<{ enabled?: boolean; auto?: boolean }>("ai_agent", {})).enabled !== false;
// Công tắc "Bật AI Agent tự đăng bài" của Fanpage trung tâm (Admin). Tắt thì n8n không kéo bài tổng hợp nữa; "Chạy thử ngay" vẫn dùng được.
const centralAutoEnabled = async (): Promise<boolean> => (await getAppSetting<{ enabled?: boolean; auto?: boolean }>("ai_agent", {})).auto !== false;

// ───── Đăng Facebook: n8n trước, nếu n8n không gọi được thì đăng trực tiếp (nếu có token Fanpage trong .env)
const sendToN8n = async (url: string | undefined, payload: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> => {
  if (!url) return { ok: false, error: "Chưa cấu hình n8n (N8N_WEBHOOK_URL)" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(env.N8N_SECRET ? { "x-n8n-secret": env.N8N_SECRET } : {}) },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    if (!response.ok) return { ok: false, error: "n8n trả về lỗi " + response.status };
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Không gọi được n8n" };
  } finally {
    clearTimeout(timer);
  }
};

const pageTokens = (): Record<string, string> => {
  if (!env.FACEBOOK_PAGE_TOKENS) return {};
  try {
    const parsed = JSON.parse(env.FACEBOOK_PAGE_TOKENS) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => typeof value === "string" && value)) as Record<string, string>;
  } catch {
    logger.warn("FACEBOOK_PAGE_TOKENS không phải JSON hợp lệ");
    return {};
  }
};

const postToFacebookDirect = async (pageId: string, message: string, imageUrl: string | null, link: string): Promise<{ ok: boolean; error?: string }> => {
  const token = pageTokens()[pageId];
  if (!token) return { ok: false, error: "Chưa có token Fanpage " + pageId + " trong FACEBOOK_PAGE_TOKENS" };
  const graph = "https://graph.facebook.com/v21.0/" + encodeURIComponent(pageId);
  try {
    const body = imageUrl ? { url: imageUrl, caption: message, access_token: token } : { message, access_token: token, ...(link.startsWith("https:") ? { link } : {}) };
    const response = await fetch(graph + (imageUrl ? "/photos" : "/feed"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return { ok: false, error: "Facebook trả về lỗi " + response.status + (text ? ": " + text.slice(0, 160) : "") };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Không gọi được Facebook" };
  }
};

const payloadFor = (product: ProductInfo, content: MarketingContent, settings: StoreMarketing, kind: string, postLogId: string | null, ai: boolean): Record<string, unknown> => ({
  event: "product.promote",
  kind,
  variant: content.variant,
  post_log_id: postLogId,
  ai: { enabled: ai },
  store: { id: product.stores.id, name: product.stores.name, address: shortAddress(product.stores), facebook_page_id: settings.facebook_page_id, facebook_page_name: settings.facebook_page_name },
  product: {
    id: product.id, name: product.name, label: product.label, food_group: product.food_group ?? "cooked", category: product.category,
    price_vnd: product.price_cents, original_price_vnd: product.original_price_cents, discount_percent: content.discount_percent,
    deadline_text: content.deadline_text, image_url: imageOf(product), emoji: product.emoji, url: content.product_url
  },
  content: { headline: content.headline, facebook: content.facebook, instagram: content.instagram, tiktok: content.tiktok, zalo: content.zalo, hashtags: content.hashtags }
});

// Gửi bài Facebook: n8n (tầng 1-2: AI hoặc mẫu, do n8n quyết định), lỗi thì tầng 3: backend đăng trực tiếp
const publishFacebook = async (product: ProductInfo, content: MarketingContent, settings: StoreMarketing, kind: string, postLogId: string | null, ai: boolean): Promise<{ ok: boolean; via?: "n8n" | "direct"; error?: string }> => {
  const viaN8n = await sendToN8n(env.N8N_WEBHOOK_URL, payloadFor(product, content, settings, kind, postLogId, ai));
  if (viaN8n.ok) return { ok: true, via: "n8n" };
  const pageId = settings.facebook_page_id;
  if (pageId && pageTokens()[pageId]) {
    const direct = await postToFacebookDirect(pageId, content.facebook, imageOf(product), content.product_url);
    if (direct.ok) return { ok: true, via: "direct" };
    return { ok: false, error: `${viaN8n.error ?? "n8n lỗi"}; dự phòng: ${direct.error ?? "lỗi"}` };
  }
  return { ok: false, ...(viaN8n.error ? { error: viaN8n.error } : {}) };
};

// Ghi nhật ký TRƯỚC (để n8n báo kết quả về đúng dòng), rồi gửi, rồi cập nhật trạng thái
const publishAndLog = async (product: ProductInfo, content: MarketingContent, settings: StoreMarketing, text: string, kind: "manual" | "auto", variant: "main" | "reminder"): Promise<{ ok: boolean; via?: "n8n" | "direct"; error?: string }> => {
  const ai = await aiEnabled();
  const id = await logPost({ store_id: product.store_id, product_id: product.id, channel: "facebook", kind, variant, content: text, image_url: imageOf(product), status: "queued" });
  const sent = await publishFacebook(product, { ...content, facebook: text }, settings, kind, id, ai);
  await updatePost(id, { status: sent.ok ? "sent" : "failed", error: sent.error ?? null, ...(sent.via === "direct" ? { tier: "direct" } : {}) });
  return sent;
};

// ───── Bài tổng hợp của FoodSave (Fanpage trung tâm): gom tối đa 3 món nhãn đỏ/vàng từ nhiều cửa hàng vào một bài
const BUNDLE_SIZE = 3;

export interface BundleItem {
  product_id: string;
  name: string;
  emoji: string | null;
  store_name: string;
  label: "red" | "yellow";
  food_group: string;
  discount_percent: number;
  price_vnd: number;
  original_price_vnd: number;
  deadline_text: string;
  hours_left: number;
  image_url: string | null;
}

export interface Bundle {
  items: BundleItem[];
  more_count: number;
  message: string;
  link: string;
  hero_image_url: string | null;
  labels: { red: number; yellow: number };
}

const centralPage = (): { id: string | null; name: string } => ({ id: env.CENTRAL_PAGE_ID ?? null, name: env.CENTRAL_PAGE_NAME ?? "Fanpage FoodSave" });

const toBundleItem = (product: ProductInfo): BundleItem => {
  const content = buildMarketingContent(product);
  return {
    product_id: product.id,
    name: product.name,
    emoji: product.emoji,
    store_name: product.stores.name,
    label: product.label === "red" ? "red" : "yellow",
    food_group: product.food_group ?? "cooked",
    discount_percent: content.discount_percent,
    price_vnd: product.price_cents,
    original_price_vnd: product.original_price_cents,
    deadline_text: content.deadline_text,
    hours_left: Math.max(0, (new Date(deadlineOf(product)).getTime() - Date.now()) / 3600_000),
    image_url: imageOf(product)
  };
};

// Caption mẫu của bài tổng hợp: không nhắc số lượng tồn kho
const buildBundle = (products: ProductInfo[], totalWaiting: number): Bundle => {
  const items = products.map(toBundleItem);
  const more = Math.max(0, totalWaiting - items.length);
  const link = env.PUBLIC_SITE_URL;
  const lines = [
    `🌿 Hôm nay trên FoodSave có ${totalWaiting} món nhãn đỏ/vàng đang chờ bạn!`,
    "",
    ...items.map((item) => `${item.label === "red" ? "🔥" : "⏰"} ${item.name} · ${item.store_name} · giảm ${item.discount_percent}% · chỉ ${money(item.price_vnd)} · lấy trước ${item.deadline_text}`),
    ...(more > 0 ? [`…và ${more} món khác trên sàn`] : []),
    "",
    "Mua sớm để không lãng phí, nhận hàng trước giờ hết hạn nhé 💚",
    `👉 Đặt giữ trên FoodSave: ${link}`,
    "📍 Tự đến cửa hàng nhận, không giao hàng",
    "",
    "#FoodSave #CuuThucPham #GiamLangPhi"
  ];
  return {
    items,
    more_count: more,
    message: lines.join("\n"),
    link,
    hero_image_url: items.find((item) => item.image_url)?.image_url ?? null,
    labels: { red: items.filter((item) => item.label === "red").length, yellow: items.filter((item) => item.label === "yellow").length }
  };
};

interface CentralRow { id: string; status: string; tier: string | null; content: string | null; error: string | null; external_url: string | null; created_at: string; meta: { product_ids?: string[]; items?: BundleItem[] } | null }

// Hàng nhãn đỏ/vàng còn bán được, đỏ trước, còn ít thời gian nhất lên đầu
const loadCandidates = async (): Promise<ProductInfo[]> => {
  const { data, error } = await supabaseAdmin
    .from("products")
    .select(PRODUCT_SELECT)
    .in("label", ["red", "yellow"])
    .eq("is_active", true)
    .gt("stock_quantity", 0)
    .limit(200);
  if (error) handleSupabaseError(error, "Failed to load marketing candidates");
  const now = Date.now();
  const alive = ((data ?? []) as unknown as ProductInfo[]).filter((product) => new Date(deadlineOf(product)).getTime() > now);
  alive.sort((a, b) => (a.label === b.label ? new Date(deadlineOf(a)).getTime() - new Date(deadlineOf(b)).getTime() : a.label === "red" ? -1 : 1));
  return alive;
};

const loadCentralRows = async (sinceIso: string): Promise<CentralRow[]> => {
  const { data, error } = await supabaseAdmin
    .from("marketing_posts")
    .select("id,status,tier,content,error,external_url,created_at,meta")
    .eq("kind", "central")
    .eq("channel", "facebook")
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) {
    // chưa chạy SQL 026 (thiếu cột tier/meta): đọc bản rút gọn
    const { data: basic } = await supabaseAdmin.from("marketing_posts").select("id,status,content,error,external_url,created_at").eq("kind", "central").eq("channel", "facebook").gte("created_at", sinceIso).order("created_at", { ascending: false }).limit(300);
    return ((basic ?? []) as unknown as CentralRow[]).map((row) => ({ ...row, tier: null, meta: null }));
  }
  return (data ?? []) as unknown as CentralRow[];
};

// Sản phẩm đã nằm trong bài tổng hợp gần đây thì tạm không đưa vào nữa (6 tiếng; bài lỗi được thử lại sau 30 phút)
const recentlyIncluded = (rows: CentralRow[]): Set<string> => {
  const now = Date.now();
  const skip = new Set<string>();
  for (const row of rows) {
    const age = now - new Date(row.created_at).getTime();
    const limit = row.status === "failed" ? 30 * 60_000 : CENTRAL_REPOST_HOURS * 3600_000;
    if (age < limit) (row.meta?.product_ids ?? []).forEach((id) => skip.add(id));
  }
  return skip;
};

const sendCentralToN8n = (payload: Record<string, unknown>) => sendToN8n(centralWebhookUrl(), payload);
const centralWebhookUrl = (): string | undefined => env.N8N_CENTRAL_WEBHOOK_URL ?? (env.N8N_WEBHOOK_URL ? env.N8N_WEBHOOK_URL.replace(/foodsave-promote\/?$/, "foodsave-central") : undefined);

export type ChannelResult = { status: "sent" | "ready" | "failed" | "skipped"; reason?: string; via?: string };

export const marketingService = {
  async getContent(actorId: string, actorRole: UserRole, productId: string): Promise<unknown> {
    const product = await loadProduct(productId);
    await assertStoreAccess(product.stores, actorId, actorRole);
    const settings = await loadStoreMarketing(product.store_id);
    return {
      product: { id: product.id, name: product.name, label: product.label, price_vnd: product.price_cents, original_price_vnd: product.original_price_cents, stock: product.stock_quantity, image_url: imageOf(product), emoji: product.emoji, deadline_text: buildMarketingContent(product).deadline_text },
      store: { name: product.stores.name, ...settings, n8n_configured: Boolean(env.N8N_WEBHOOK_URL), fallback_configured: Object.keys(pageTokens()).length > 0 },
      content: buildMarketingContent(product)
    };
  },

  // Cửa hàng phát hành chiến dịch tới các kênh. Kênh tắt / chưa kết nối bị bỏ qua.
  async promote(actorId: string, actorRole: UserRole, productId: string, channels: MarketingChannel[], facebookText?: string): Promise<{ results: Partial<Record<MarketingChannel, ChannelResult>> }> {
    const product = await loadProduct(productId);
    await assertStoreAccess(product.stores, actorId, actorRole);
    if (!product.is_active || product.stock_quantity <= 0) throw conflict("Sản phẩm đã hết hàng hoặc ngừng bán nên không quảng bá được");

    // Hàng xanh chỉ đăng thủ công, tối đa 2 chiến dịch mỗi ngày mỗi cửa hàng
    if (product.label === "green") {
      const { count } = await supabaseAdmin.from("marketing_posts").select("id", { count: "exact", head: true }).eq("store_id", product.store_id).eq("kind", "manual").eq("channel", "buyers").gte("created_at", startOfTodayVn());
      const { count: fb } = await supabaseAdmin.from("marketing_posts").select("id", { count: "exact", head: true }).eq("store_id", product.store_id).eq("kind", "manual").eq("channel", "facebook").gte("created_at", startOfTodayVn());
      if (Math.max(count ?? 0, fb ?? 0) >= GREEN_CAMPAIGNS_PER_DAY) throw conflict("Hàng nhãn xanh chỉ quảng bá tối đa " + GREEN_CAMPAIGNS_PER_DAY + " chiến dịch mỗi ngày. Hãy ưu tiên hàng vàng và đỏ.");
    }

    const settings = await loadStoreMarketing(product.store_id);
    const content = buildMarketingContent(product);
    const results: Partial<Record<MarketingChannel, ChannelResult>> = {};

    for (const channel of Array.from(new Set(channels))) {
      const state = settings.channels[channel];
      if (!state.enabled) {
        results[channel] = { status: "skipped", reason: state.connected ? "Kênh đang tắt" : "Kênh chưa được kết nối" };
        continue;
      }

      if (channel === "buyers") {
        const since = new Date(Date.now() - PROMOTE_COOLDOWN_MINUTES * 60_000).toISOString();
        const { data: recent } = await supabaseAdmin.from("marketing_posts").select("id").eq("product_id", productId).eq("channel", "buyers").gte("created_at", since).limit(1);
        if ((recent ?? []).length > 0) { results.buyers = { status: "skipped", reason: "Bạn vừa nhắc người mua về sản phẩm này. Hãy chờ " + PROMOTE_COOLDOWN_MINUTES + " phút." }; continue; }
        const { error } = await supabaseAdmin.from("notifications").insert({
          recipient_id: null,
          role_target: "customer",
          type: "promo-push",
          title: `${product.label === "red" ? "🔥" : "⏰"} ${product.name} giảm ${content.discount_percent}%`,
          body: `${product.stores.name} · giá ${money(product.price_cents)}. Lấy trước ${content.deadline_text}. Số lượng có hạn.`,
          related_type: "product",
          related_id: product.id
        });
        if (error) handleSupabaseError(error, "Failed to push notification");
        await logPost({ store_id: product.store_id, product_id: product.id, channel: "buyers", kind: "manual", content: content.headline, status: "sent" });
        results.buyers = { status: "sent" };
        continue;
      }

      if (channel === "facebook") {
        const text = facebookText?.trim() || content.facebook;
        const sent = await publishAndLog(product, content, settings, text, "manual", "main");
        results.facebook = sent.ok ? { status: "sent", ...(sent.via ? { via: sent.via } : {}) } : { status: "failed", reason: sent.error ?? "Không đăng được" };
        continue;
      }

      // Instagram, TikTok, Zalo: tạo sẵn nội dung, chưa tự đăng
      await logPost({ store_id: product.store_id, product_id: product.id, channel, kind: "manual", content: content[channel], image_url: imageOf(product), status: "ready" });
      results[channel] = { status: "ready" };
    }
    return { results };
  },

  // Auto-bot: hàng vừa chuyển sang vàng/đỏ thì đăng bài chính. Lỗi không làm hỏng tác vụ đổi nhãn.
  async autoPostIfEnabled(productId: string): Promise<void> {
    try {
      const product = await loadProduct(productId);
      if (product.label === "green" || product.stock_quantity <= 0 || !product.is_active) return;
      const settings = await loadStoreMarketing(product.store_id);
      if (!settings.marketing_auto) return;
      const since = new Date(Date.now() - CENTRAL_REPOST_HOURS * 3600_000).toISOString();
      const { data: recent } = await supabaseAdmin.from("marketing_posts").select("id").eq("product_id", productId).eq("kind", "auto").eq("variant", "main").gte("created_at", since).limit(1);
      if ((recent ?? []).length > 0) return;
      const content = buildMarketingContent(product);
      for (const channel of MARKETING_CHANNELS) {
        if (channel === "buyers" || !settings.channels[channel].enabled) continue;
        if (channel === "facebook") {
          await publishAndLog(product, content, settings, content.facebook, "auto", "main");
        } else {
          await logPost({ store_id: product.store_id, product_id: product.id, channel, kind: "auto", content: content[channel], image_url: imageOf(product), status: "ready" });
        }
      }
    } catch (error) {
      logger.warn("Auto-bot marketing bị lỗi", error);
    }
  },

  // Bài nhắc 2 giờ cuối cho hàng đỏ (mỗi sản phẩm một lần), sau bài chính ít nhất 30 phút
  async autoReminderIfDue(productId: string): Promise<void> {
    try {
      const product = await loadProduct(productId);
      if (product.label !== "red" || product.stock_quantity <= 0 || !product.is_active) return;
      const hoursLeft = (new Date(deadlineOf(product)).getTime() - Date.now()) / 3600_000;
      if (hoursLeft > REMINDER_MAX_HOURS || hoursLeft <= REMINDER_MIN_HOURS) return;
      const settings = await loadStoreMarketing(product.store_id);
      if (!settings.marketing_auto || !settings.channels.facebook.enabled) return;
      const { data: posts } = await supabaseAdmin.from("marketing_posts").select("variant,created_at").eq("product_id", productId).eq("kind", "auto").eq("channel", "facebook").gte("created_at", new Date(Date.now() - 24 * 3600_000).toISOString());
      const rows = (posts ?? []) as Array<{ variant: string; created_at: string }>;
      if (rows.some((row) => row.variant === "reminder")) return;
      const main = rows.find((row) => row.variant === "main");
      if (!main || Date.now() - new Date(main.created_at).getTime() < REMINDER_AFTER_MAIN_MINUTES * 60_000) return;
      const content = buildMarketingContent(product, "reminder");
      await publishAndLog(product, content, settings, content.facebook, "auto", "reminder");
    } catch (error) {
      logger.warn("Bài nhắc Auto-bot bị lỗi", error);
    }
  },

  async getSettings(actorId: string, actorRole: UserRole): Promise<unknown> {
    let request = supabaseAdmin.from("stores").select("id,name").order("created_at", { ascending: true });
    if (actorRole !== "admin") request = request.eq("owner_id", actorId);
    const { data, error } = await request.limit(1);
    if (error) handleSupabaseError(error, "Failed to load store");
    const store = ((data ?? []) as Array<{ id: string; name: string }>)[0];
    if (!store) throw conflict("Bạn chưa có cửa hàng");
    const settings = await loadStoreMarketing(store.id);
    return { store_id: store.id, store_name: store.name, ...settings, n8n_configured: Boolean(env.N8N_WEBHOOK_URL), fallback_configured: Object.keys(pageTokens()).length > 0 };
  },

  async updateSettings(actorId: string, actorRole: UserRole, body: {
    marketing_auto?: boolean | undefined;
    facebook_page_id?: string | undefined;
    facebook_page_name?: string | undefined;
    channels?: Partial<Record<MarketingChannel, { enabled?: boolean | undefined; info?: Record<string, string> | undefined }>> | undefined;
  }): Promise<unknown> {
    const current = (await marketingService.getSettings(actorId, actorRole)) as { store_id: string; channels: Record<MarketingChannel, ChannelState> };
    const update: Record<string, unknown> = {};
    if (body.marketing_auto !== undefined) update.marketing_auto = body.marketing_auto;
    if (body.facebook_page_id !== undefined) update.facebook_page_id = body.facebook_page_id || null;
    if (body.facebook_page_name !== undefined) update.facebook_page_name = body.facebook_page_name || null;
    if (body.channels) {
      const stored: Record<string, { enabled: boolean; info: Record<string, string> }> = {};
      for (const key of MARKETING_CHANNELS) {
        const old = current.channels[key];
        const patch = body.channels[key];
        const info = { ...old.info, ...(patch?.info ?? {}) };
        if (key === "facebook") { delete info.page_id; delete info.page_name; }
        stored[key] = { enabled: patch?.enabled ?? old.enabled, info };
      }
      update.marketing_channels = stored;
      // Thông tin Fanpage nằm ở cột riêng để n8n dùng
      const fbInfo = body.channels.facebook?.info;
      if (fbInfo?.page_id !== undefined) update.facebook_page_id = fbInfo.page_id || null;
      if (fbInfo?.page_name !== undefined) update.facebook_page_name = fbInfo.page_name || null;
    }
    if (Object.keys(update).length > 0) {
      const { error } = await supabaseAdmin.from("stores").update(update).eq("id", current.store_id);
      if (error) handleSupabaseError(error, "Failed to update marketing settings (đã chạy SQL 025 chưa?)");
    }
    return marketingService.getSettings(actorId, actorRole);
  },

  async listPosts(actorId: string, actorRole: UserRole): Promise<unknown[]> {
    let storeIds: string[] | null = null;
    if (actorRole !== "admin") {
      const { data } = await supabaseAdmin.from("stores").select("id").eq("owner_id", actorId);
      storeIds = ((data ?? []) as Array<{ id: string }>).map((row) => row.id);
      if (storeIds.length === 0) return [];
    }
    let request = supabaseAdmin.from("marketing_posts").select("id,channel,kind,variant,status,content,error,created_at,external_url,products(name,label),stores(name)").order("created_at", { ascending: false }).limit(100);
    if (storeIds) request = request.in("store_id", storeIds);
    const { data, error } = await request;
    if (error) handleSupabaseError(error, "Failed to load marketing posts");
    return data ?? [];
  },

  // ───── Cho n8n (Fanpage trung tâm): bài tổng hợp, đỏ trước, vàng sau, còn ít thời gian nhất lên đầu
  assertSecret(provided: string | undefined): void {
    if (!env.N8N_SECRET || provided !== env.N8N_SECRET) throw new AppError("Sai mật khẩu n8n", HTTP_STATUS.UNAUTHORIZED, ERROR_CODES.AUTH_INVALID_TOKEN);
  },

  async centralFeed(): Promise<{ items: unknown[]; ai_enabled: boolean; page_id: string | null }> {
    const ai = await aiEnabled();
    const page = centralPage();
    if (!(await centralAutoEnabled())) return { items: [], ai_enabled: ai, page_id: page.id };
    const rowsToday = await loadCentralRows(startOfTodayVn());
    const usedToday = rowsToday.filter((row) => row.status !== "failed").length;
    const room = Math.min(CENTRAL_PER_RUN, CENTRAL_PER_DAY - usedToday);
    if (room <= 0) return { items: [], ai_enabled: ai, page_id: page.id };

    const skip = recentlyIncluded(await loadCentralRows(new Date(Date.now() - CENTRAL_REPOST_HOURS * 3600_000).toISOString()));
    const waiting = (await loadCandidates()).filter((product) => !skip.has(product.id));
    const items: unknown[] = [];
    for (let start = 0; start < waiting.length && items.length < room; start += BUNDLE_SIZE) {
      const chunk = waiting.slice(start, start + BUNDLE_SIZE);
      const bundle = buildBundle(chunk, waiting.length);
      const id = await logPost({ store_id: null, product_id: null, channel: "facebook", kind: "central", content: bundle.message, image_url: bundle.hero_image_url, status: "queued", meta: { product_ids: chunk.map((p) => p.id), items: bundle.items, labels: bundle.labels } });
      items.push({ post_log_id: id, ...bundle });
    }
    return { items, ai_enabled: ai, page_id: page.id };
  },

  // n8n báo kết quả đăng về cho FoodSave (cả bài của cửa hàng lẫn bài tổng hợp)
  async reportResult(body: { post_log_id: string; status: "posted" | "failed"; tier?: "ai" | "template" | "direct" | undefined; external_id?: string | undefined; external_url?: string | undefined; error?: string | undefined }): Promise<void> {
    await updatePost(body.post_log_id, {
      status: body.status,
      ...(body.tier ? { tier: body.tier } : {}),
      external_id: body.external_id ?? null,
      external_url: body.external_url ?? null,
      error: body.error ?? null
    });
  },

  // ───── Trang Admin: AI Agent đăng bài (chỉ bài tổng hợp của FoodSave, không đăng thay từng cửa hàng)
  async adminOverview(): Promise<unknown> {
    const page = centralPage();
    const ai = await aiEnabled();
    const rows = await loadCentralRows(new Date(Date.now() - 7 * 24 * 3600_000).toISOString());
    const skip = recentlyIncluded(rows);
    const waiting = await loadCandidates();
    const today = startOfTodayVn();
    const todayRows = rows.filter((row) => row.created_at >= today);
    const tried = rows.filter((row) => row.status !== "queued");
    const okRows = tried.filter((row) => row.status === "sent" || row.status === "posted");
    const days = Array.from({ length: 7 }, (_, index) => {
      const day = new Date(Date.now() - (6 - index) * 24 * 3600_000);
      const key = vnDay(day.toISOString());
      const dayRows = rows.filter((row) => vnDay(row.created_at) === key && row.status !== "failed");
      const count = (label: string) => dayRows.reduce((sum, row) => sum + (row.meta?.items ?? []).filter((item) => item.label === label).length, 0);
      return { date: key, label: day.toLocaleDateString("vi-VN", { weekday: "short", timeZone: VN_TZ }), red: count("red"), yellow: count("yellow") };
    });
    const storeCount = new Map<string, number>();
    for (const row of rows.filter((item) => item.status !== "failed")) for (const item of row.meta?.items ?? []) storeCount.set(item.store_name, (storeCount.get(item.store_name) ?? 0) + 1);
    // Bài đã đăng/gửi 7 ngày qua theo nền tảng (gồm cả bài của từng cửa hàng và bài tổng hợp)
    const platforms: Record<string, number> = { facebook: 0, instagram: 0, tiktok: 0, zalo: 0, buyers: 0 };
    const { data: platformRows } = await supabaseAdmin.from("marketing_posts").select("channel").in("status", ["sent", "posted"]).gte("created_at", new Date(Date.now() - 7 * 24 * 3600_000).toISOString()).limit(5000);
    for (const row of platformRows ?? []) {
      const channel = String((row as { channel?: string }).channel ?? "");
      if (channel in platforms) platforms[channel] = (platforms[channel] ?? 0) + 1;
    }
    const tokens = pageTokens();
    const n8nOn = Boolean(env.N8N_WEBHOOK_URL);
    const mode = !ai ? (n8nOn ? "template" : page.id && tokens[page.id] ? "direct" : "none") : n8nOn ? "ai" : page.id && tokens[page.id] ? "direct" : "none";
    return {
      central: page,
      integrations: { n8n_configured: n8nOn, n8n_central_configured: Boolean(centralWebhookUrl()), ai_enabled: ai, direct_fallback: Boolean(page.id && tokens[page.id]) },
      mode,
      auto_enabled: await centralAutoEnabled(),
      limits: { per_run: CENTRAL_PER_RUN, per_day: CENTRAL_PER_DAY },
      kpi: {
        today: todayRows.filter((row) => row.status !== "failed").length,
        success_rate: tried.length ? Math.round((okRows.length / tried.length) * 100) : null,
        tried_7d: tried.length,
        ok_7d: okRows.length,
        failed_7d: tried.length - okRows.length,
        ai_7d: okRows.filter((row) => row.tier === "ai").length,
        template_7d: okRows.filter((row) => row.tier === "template").length,
        direct_7d: okRows.filter((row) => row.tier === "direct").length,
        fallback_7d: okRows.filter((row) => row.tier === "template" || row.tier === "direct").length,
        platforms_7d: platforms
      },
      days,
      top_stores: Array.from(storeCount.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => ({ name, count })),
      queue: waiting.map((product) => ({ ...toBundleItem(product), recently_posted: skip.has(product.id) })),
      posts: rows.slice(0, 100).map((row) => ({ id: row.id, created_at: row.created_at, status: row.status, tier: row.tier, content: row.content, error: row.error, external_url: row.external_url, items: row.meta?.items ?? [], labels: row.meta?.items ? { red: row.meta.items.filter((item) => item.label === "red").length, yellow: row.meta.items.filter((item) => item.label === "yellow").length } : null }))
    };
  },

  async adminSetSettings(patch: { ai_enabled?: boolean | undefined; auto_enabled?: boolean | undefined }): Promise<{ ai_enabled: boolean; auto_enabled: boolean }> {
    const current = await getAppSetting<{ enabled?: boolean; auto?: boolean }>("ai_agent", {});
    const next = { enabled: patch.ai_enabled ?? current.enabled !== false, auto: patch.auto_enabled ?? current.auto !== false };
    await setAppSetting("ai_agent", next);
    return { ai_enabled: next.enabled, auto_enabled: next.auto };
  },

  async adminBuildBundle(productIds?: string[]): Promise<Bundle> {
    const waiting = await loadCandidates();
    const picked = productIds && productIds.length ? productIds.map((id) => waiting.find((product) => product.id === id)).filter((product): product is ProductInfo => Boolean(product)) : waiting.slice(0, BUNDLE_SIZE);
    if (picked.length === 0) throw conflict("Chưa có hàng nhãn đỏ/vàng nào còn bán để đăng");
    return buildBundle(picked.slice(0, BUNDLE_SIZE), waiting.length);
  },

  // "Chạy thử ngay": cùng logic Auto-bot trung tâm. n8n (AI hoặc mẫu), lỗi thì backend tự đăng trực tiếp.
  async adminRun(productIds?: string[]): Promise<{ status: "sent" | "failed"; via?: string; tier?: string; error?: string; post_log_id: string | null }> {
    const bundle = await marketingService.adminBuildBundle(productIds);
    const ai = await aiEnabled();
    const page = centralPage();
    const id = await logPost({ store_id: null, product_id: null, channel: "facebook", kind: "central", content: bundle.message, image_url: bundle.hero_image_url, status: "queued", meta: { product_ids: bundle.items.map((item) => item.product_id), items: bundle.items, labels: bundle.labels, source: "admin-run" } });
    const viaN8n = await sendCentralToN8n({ event: "central.bundle", post_log_id: id, ai: { enabled: ai }, page_id: page.id, bundle });
    if (viaN8n.ok) {
      await updatePost(id, { status: "sent" });
      return { status: "sent", via: "n8n", post_log_id: id };
    }
    if (page.id && pageTokens()[page.id]) {
      const direct = await postToFacebookDirect(page.id, bundle.message, bundle.hero_image_url, bundle.link);
      if (direct.ok) {
        await updatePost(id, { status: "sent", tier: "direct", error: null });
        return { status: "sent", via: "direct", tier: "direct", post_log_id: id };
      }
      await updatePost(id, { status: "failed", error: `${viaN8n.error ?? "n8n lỗi"}; dự phòng: ${direct.error ?? "lỗi"}` });
      return { status: "failed", error: direct.error ?? "Không đăng được", post_log_id: id };
    }
    await updatePost(id, { status: "failed", error: viaN8n.error ?? "n8n không phản hồi" });
    return { status: "failed", error: viaN8n.error ?? "n8n không phản hồi và chưa có token đăng trực tiếp", post_log_id: id };
  }
};

// Chỉ dùng cho kiểm thử tự động (n8n/test-tiers.js), không dùng trong luồng chạy thật
export const __internals = { publishFacebook, postToFacebookDirect, sendToN8n, buildBundle, buildMarketingContent, centralWebhookUrl };
