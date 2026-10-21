import type { FoodGroup, ProductLabel, UserRole } from "../types/domain";
import { computeProductLabelState, isFoodGroup } from "../utils/productExpiryLabel";
import { logger } from "../utils/logger";
import { generateCode, handleSupabaseError, supabaseAdmin } from "./supabaseService";
import { marketingService } from "./marketingService";

const MINUTE_MS = 60_000;

// Nhãn đỏ: báo ngay khi chuyển, sau đó nhắc lại mỗi 30 phút nếu còn hàng, tối đa 3 lần
export const RED_REMINDER_INTERVAL_MINUTES = 30;
export const RED_REMINDER_MAX = 3;
// Hàng đỏ chia cho tổ chức từ thiện
export const CHARITY_SHARE_RATE = 0.5;
export const CHARITY_MIN_QUANTITY = 5;
export const CHARITY_OFFER_MINUTES = 45;
// Khối lượng ước tính mỗi phần khi cửa hàng không khai estimated_weight_kg
const DEFAULT_PORTION_WEIGHT_KG = 0.3;

const PRODUCT_AUTOMATION_SELECT = [
  "id", "store_id", "name", "category", "food_group", "expires_at", "original_price_cents", "price_cents",
  "label", "stock_quantity", "estimated_weight_kg", "is_donation", "is_active", "effective_deadline_at",
  "yellow_notified_at", "red_notified_at", "red_last_notified_at", "red_reminder_count",
  "stores!inner(id,name,owner_id,status,opening_schedule,charity_transfer_enabled)"
].join(",");

interface AutomationProduct {
  id: string;
  store_id: string;
  name: string;
  category: string;
  food_group: FoodGroup | null;
  expires_at: string;
  original_price_cents: number;
  price_cents: number;
  label: ProductLabel;
  stock_quantity: number;
  estimated_weight_kg: number | null;
  is_donation: boolean;
  is_active: boolean;
  effective_deadline_at: string | null;
  yellow_notified_at: string | null;
  red_notified_at: string | null;
  red_last_notified_at: string | null;
  red_reminder_count: number;
  stores: {
    id: string;
    name: string;
    owner_id: string;
    status: string;
    opening_schedule: unknown;
    charity_transfer_enabled: boolean | null;
  };
}

export interface LabelAutomationResult {
  checked: number;
  relabeled: number;
  stopped: number;
  notifications: number;
  donations_created: number;
  offers_expired: number;
}

const formatVnd = (value: number): string => `${Math.round(value).toLocaleString("vi-VN")}đ`;

const formatVnTime = (date: Date): string => {
  return date.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ho_Chi_Minh" });
};

const notifyRoles = async (
  roles: UserRole[],
  notification: { type: string; title: string; body: string; related_type: string; related_id: string }
): Promise<number> => {
  const rows = roles.map((role) => ({ ...notification, role_target: role, recipient_id: null }));
  const { error } = await supabaseAdmin.from("notifications").insert(rows);
  if (error) {
    logger.warn("Không tạo được thông báo nhãn sản phẩm", error);
    return 0;
  }
  return rows.length;
};

const createCharityOffer = async (product: AutomationProduct, deadline: Date, now: Date): Promise<number> => {
  const quantity = Math.floor(product.stock_quantity * CHARITY_SHARE_RATE);
  if (quantity <= 0) return 0;

  const portionWeight = Number(product.estimated_weight_kg) > 0 ? Number(product.estimated_weight_kg) : DEFAULT_PORTION_WEIGHT_KG;
  const offerExpiresAt = new Date(Math.min(now.getTime() + CHARITY_OFFER_MINUTES * MINUTE_MS, deadline.getTime()));

  const { data: donation, error } = await supabaseAdmin
    .from("donations")
    .insert({
      donation_code: generateCode("D"),
      store_id: product.store_id,
      product_id: product.id,
      quantity,
      is_auto: true,
      items: product.name,
      amount_text: `${quantity} phần`,
      weight_kg: Math.max(0.01, Math.round(portionWeight * quantity * 100) / 100),
      expires_at: deadline.toISOString(),
      pickup_start: now.toISOString(),
      pickup_end: deadline.toISOString(),
      urgency: "red",
      status: "open",
      offer_expires_at: offerExpiresAt.toISOString(),
      note: `Hàng nhãn đỏ tự chuyển từ thiện. Nhận lời trước ${formatVnTime(offerExpiresAt)}, sau đó phần này mở bán cho người mua.`
    })
    .select("id")
    .single();

  if (error) {
    // Đã có lô tự động cho sản phẩm này (unique index) thì bỏ qua
    if (error.code !== "23505") logger.warn("Không tạo được lô quyên góp tự động", error);
    return 0;
  }

  // Giữ phần của tổ chức: trừ khỏi số lượng bán cho người mua
  const { error: stockError } = await supabaseAdmin
    .from("products")
    .update({ stock_quantity: Math.max(0, product.stock_quantity - quantity) })
    .eq("id", product.id)
    .eq("stock_quantity", product.stock_quantity);

  if (stockError) logger.warn("Không trừ được số lượng dành cho từ thiện", stockError);

  await notifyRoles(["charity"], {
    type: "charity-offer",
    title: `Có ${quantity} phần miễn phí: ${product.name}`,
    body: `${product.stores.name} tặng ${quantity} phần hàng nhãn đỏ. Nhận lời trước ${formatVnTime(offerExpiresAt)}.`,
    related_type: "donation",
    related_id: (donation as { id: string }).id
  });

  return 1;
};

// Tổ chức không nhận lời đúng hạn: phần của tổ chức trả về cho người mua
const expireCharityOffers = async (now: Date): Promise<number> => {
  const { data, error } = await supabaseAdmin
    .from("donations")
    .select("id,product_id,quantity")
    .eq("status", "open")
    .lt("offer_expires_at", now.toISOString());

  if (error) handleSupabaseError(error, "Failed to load expired charity offers");

  let expired = 0;
  for (const offer of (data ?? []) as Array<{ id: string; product_id: string | null; quantity: number | null }>) {
    const { data: cancelled, error: cancelError } = await supabaseAdmin
      .from("donations")
      .update({ status: "cancelled", note: "Không có tổ chức nhận lời đúng hạn, phần này đã mở bán cho người mua." })
      .eq("id", offer.id)
      .eq("status", "open")
      .select("id");

    if (cancelError || !cancelled || cancelled.length === 0) continue;
    expired += 1;

    if (!offer.product_id || !offer.quantity) continue;
    const { data: product } = await supabaseAdmin
      .from("products")
      .select("id,stock_quantity,is_active")
      .eq("id", offer.product_id)
      .maybeSingle();

    const loaded = product as { id: string; stock_quantity: number; is_active: boolean } | null;
    if (!loaded?.is_active) continue;
    await supabaseAdmin
      .from("products")
      .update({ stock_quantity: loaded.stock_quantity + offer.quantity })
      .eq("id", loaded.id);
  }

  return expired;
};

const processProduct = async (product: AutomationProduct, now: Date, result: LabelAutomationResult): Promise<void> => {
  const foodGroup: FoodGroup = isFoodGroup(product.food_group) ? product.food_group : "fresh";
  const state = computeProductLabelState({
    expiresAt: product.expires_at,
    originalPriceVnd: Number(product.original_price_cents) || 0,
    foodGroup,
    openingSchedule: product.stores.opening_schedule,
    now
  });

  if (state.shouldStopSelling) {
    await supabaseAdmin
      .from("products")
      .update({ is_active: false, blocked_reason: "Đã hết thời gian bán (còn dưới 1 giờ trước hạn hoặc giờ đóng cửa)" })
      .eq("id", product.id);
    result.stopped += 1;
    return;
  }

  const update: Record<string, unknown> = {};
  const deadlineIso = state.deadline.toISOString();
  if (product.effective_deadline_at !== deadlineIso) update.effective_deadline_at = deadlineIso;
  // Hàng tặng (is_donation) không bán nên giữ giá 0
  const nextPrice = product.is_donation ? 0 : state.priceVnd;
  if (product.price_cents !== nextPrice) update.price_cents = nextPrice;
  if (product.label !== state.label) {
    update.label = state.label;
    update.label_changed_at = now.toISOString();
    result.relabeled += 1;
  }

  const priceText = formatVnd(nextPrice);
  const hasStock = product.stock_quantity > 0;
  let becameRed = false;

  if (state.label === "yellow" && !product.yellow_notified_at && hasStock) {
    result.notifications += await notifyRoles(["customer", "charity"], {
      type: "label-yellow",
      title: `Giảm 50%: ${product.name}`,
      body: `${product.stores.name} · giá ${priceText}. Hạn lấy trước ${formatVnTime(state.deadline)}. Số lượng có hạn.`,
      related_type: "product",
      related_id: product.id
    });
    update.yellow_notified_at = now.toISOString();
  }

  if (state.label === "red" && hasStock) {
    if (!product.red_notified_at) {
      becameRed = true;
      result.notifications += await notifyRoles(["customer"], {
        type: "label-red",
        title: `Giảm 80%: ${product.name}`,
        body: `${product.stores.name} · giá ${priceText}. Hạn lấy trước ${formatVnTime(state.deadline)}. Số lượng có hạn.`,
        related_type: "product",
        related_id: product.id
      });
      update.red_notified_at = now.toISOString();
      update.red_last_notified_at = now.toISOString();
      update.red_reminder_count = 0;
    } else {
      const lastNotified = new Date(product.red_last_notified_at ?? product.red_notified_at).getTime();
      const dueForReminder = now.getTime() - lastNotified >= RED_REMINDER_INTERVAL_MINUTES * MINUTE_MS;
      if (product.red_reminder_count < RED_REMINDER_MAX && dueForReminder) {
        result.notifications += await notifyRoles(["customer"], {
          type: "label-red-reminder",
          title: `Sắp hết giờ: ${product.name}`,
          body: `${product.stores.name} · giá ${priceText}, lấy trước ${formatVnTime(state.deadline)}.`,
          related_type: "product",
          related_id: product.id
        });
        update.red_last_notified_at = now.toISOString();
        update.red_reminder_count = product.red_reminder_count + 1;
      }
    }
  }

  if (Object.keys(update).length > 0) {
    const { error } = await supabaseAdmin.from("products").update(update).eq("id", product.id);
    if (error) logger.warn(`Không cập nhật được nhãn sản phẩm ${product.id}`, error);
    // Auto-bot của cửa hàng: hàng vừa chuyển sang vàng/đỏ thì gửi lệnh đăng bài (lỗi không làm hỏng việc đổi nhãn)
    else if (update.label === "yellow" || update.label === "red") await marketingService.autoPostIfEnabled(product.id);
    else if (state.label === "red") await marketingService.autoReminderIfDue(product.id);
  }

  // Chuyển đỏ lần đầu: chia một phần cho tổ chức từ thiện (đủ số lượng và cửa hàng bật tùy chọn)
  if (
    becameRed &&
    !product.is_donation &&
    product.stores.charity_transfer_enabled !== false &&
    product.stock_quantity >= CHARITY_MIN_QUANTITY
  ) {
    result.donations_created += await createCharityOffer(product, state.deadline, now);
  }
};

export const labelAutomationService = {
  /**
   * Chạy định kỳ (Netlify Scheduled Function hoặc setInterval khi chạy ở máy):
   * tính lại nhãn/giá, gỡ hàng quá giờ, gửi thông báo vàng/đỏ, chia hàng đỏ cho từ thiện,
   * trả lại phần từ thiện không ai nhận.
   */
  async run(options: { now?: Date; productIds?: string[] } = {}): Promise<LabelAutomationResult> {
    const now = options.now ?? new Date();
    const result: LabelAutomationResult = {
      checked: 0,
      relabeled: 0,
      stopped: 0,
      notifications: 0,
      donations_created: 0,
      offers_expired: 0
    };

    if (!options.productIds) result.offers_expired = await expireCharityOffers(now);

    let request = supabaseAdmin
      .from("products")
      .select(PRODUCT_AUTOMATION_SELECT)
      .eq("is_active", true)
      .eq("stores.status", "active")
      .order("expires_at", { ascending: true })
      .limit(1000);

    if (options.productIds) {
      if (options.productIds.length === 0) return result;
      request = request.in("id", options.productIds);
    }

    const { data, error } = await request;
    if (error) handleSupabaseError(error, "Failed to load products for label automation");

    for (const product of (data ?? []) as unknown as AutomationProduct[]) {
      result.checked += 1;
      try {
        await processProduct(product, now, result);
      } catch (processError) {
        logger.warn(`Lỗi khi xử lý nhãn sản phẩm ${product.id}`, processError);
      }
    }

    return result;
  }
};
