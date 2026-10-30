import type {
  CancelOrderBody,
  CreateMomoPaymentBody,
  CreateOrderBody,
  CreateReviewBody,
  MomoWebhookMockBody,
  OrderListQuery,
  UpdateOrderStatusBody
} from "../schemas/orderSchemas";
import { ERROR_CODES } from "../constants/errors";
import { HTTP_STATUS } from "../constants/http";
import type { Order, OrderItem, ProductLabel, UserRole } from "../types/domain";
import {
  COMPLAINT_WINDOW_COOKED_HOURS,
  COMPLAINT_WINDOW_OTHER_HOURS,
  COMPLETE_GRACE_MINUTES,
  CUSTOMER_REPUTATION,
  LABEL_POLICY,
  MIN_PICKUP_WINDOW_MINUTES,
  computePaymentTimeline,
  earliestDeadline,
  hasEnoughTimeToOrder,
  mostUrgentLabel,
  policyHoursMs,
  policyMs
} from "../constants/orderPolicy";
import { AppError } from "../utils/appError";
import { generateCode, getRange, handleSupabaseError, requireRecord, supabaseAdmin, toPagination } from "./supabaseService";
import type { PaginatedResponse } from "../types/api";
import { sellerReputationService } from "./sellerReputationService";
import { momoPaymentService } from "./momoPaymentService";
import { ecoImpactService } from "./ecoImpactService";
import { customerReputationService } from "./customerReputationService";
import { policyConfigService } from "./policyConfigService";
import { orderChatService } from "./orderChatService";
import { createNotification } from "./notificationService";
import { ledgerService } from "./ledgerService";
import { env } from "../config/env";
import { getPaymentProvider } from "./payments";
import type { PaymentInit } from "./payments";
import { logger } from "../utils/logger";

interface ProductForCheckout {
  id: string;
  store_id: string;
  name: string;
  price_cents: number;
  original_price_cents: number;
  original_unit_price_cents: number;
  stock_quantity: number;
  sold_count: number;
  is_active: boolean;
  category: string;
  label: string;
  expires_at: string;
  emoji: string | null;
  estimated_weight_kg: number | null;
  servings_count: number | null;
  effective_deadline_at: string | null;
  blocked_reason: string | null;
}

interface VoucherForCheckout {
  code: string;
  store_id: string | null;
  percent_off: number | null;
  fixed_discount_cents: number | null;
  min_order_cents: number;
  max_redemptions: number | null;
  redemption_count: number;
  starts_at: string;
  expires_at: string;
  is_active: boolean;
}


const getOwnedStoreIds = async (ownerId: string): Promise<string[]> => {
  const { data, error } = await supabaseAdmin
    .from("stores")
    .select("id")
    .eq("owner_id", ownerId);

  if (error) handleSupabaseError(error, "Failed to load stores");
  return (data ?? []).map((store) => (store as { id: string }).id);
};

const assertOrderAccess = async (orderId: string, actorId: string, actorRole: UserRole): Promise<Order> => {
  const { data, error } = await supabaseAdmin
    .from("orders")
    .select("*, stores!inner(owner_id)")
    .eq("id", orderId)
    .single();

  if (error) handleSupabaseError(error, "Failed to load order");
  const order = requireRecord(data as (Order & { stores: { owner_id: string } }) | null, "Order was not found");

  if (actorRole !== "admin" && order.customer_id !== actorId && order.stores.owner_id !== actorId) {
    throw new AppError("You do not have permission to access this order", HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN);
  }

  return order;
};

const loadCheckoutProducts = async (body: CreateOrderBody): Promise<ProductForCheckout[]> => {
  const productIds = body.items.map((item) => item.product_id);
  const { data, error } = await supabaseAdmin
    .from("products")
    .select("id,store_id,name,price_cents,original_price_cents,stock_quantity,sold_count,is_active,category,label,expires_at,emoji,estimated_weight_kg,servings_count,effective_deadline_at,blocked_reason")
    .in("id", productIds);

  if (error) handleSupabaseError(error, "Failed to load checkout products");
  const products = (data ?? []).map((product) => {
    const checkoutProduct = product as ProductForCheckout;
    return {
      ...checkoutProduct,
      original_unit_price_cents: checkoutProduct.original_price_cents
    };
  });

  if (products.length !== productIds.length) {
    throw new AppError("One or more products were not found", HTTP_STATUS.NOT_FOUND, ERROR_CODES.RESOURCE_NOT_FOUND);
  }

  const storeId = products[0]?.store_id;
  if (!storeId || products.some((product) => product.store_id !== storeId)) {
    throw new AppError("A single order can only contain products from one store", HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
  }

  const now = Date.now();
  for (const item of body.items) {
    const product = products.find((candidate) => candidate.id === item.product_id);
    if (!product?.is_active || product.stock_quantity < item.quantity) {
      throw new AppError(`Product ${item.product_id} does not have enough stock`, HTTP_STATUS.CONFLICT, ERROR_CODES.RESOURCE_CONFLICT);
    }
    const expiryTime = new Date(product.expires_at).getTime();
    if (!Number.isFinite(expiryTime) || expiryTime <= now) {
      throw new AppError(`Product ${item.product_id} is expired`, HTTP_STATUS.CONFLICT, ERROR_CODES.RESOURCE_CONFLICT);
    }
  }

  return products;
};

const calculateDiscount = async (voucherCode: string | undefined, storeId: string, subtotalCents: number): Promise<{ discountCents: number; voucher: VoucherForCheckout | null }> => {
  if (!voucherCode) return { discountCents: 0, voucher: null };

  const { data, error } = await supabaseAdmin
    .from("vouchers")
    .select("code,store_id,percent_off,fixed_discount_cents,min_order_cents,max_redemptions,redemption_count,starts_at,expires_at,is_active")
    .eq("code", voucherCode.toUpperCase())
    .single();

  if (error) handleSupabaseError(error, "Failed to validate voucher");
  const voucher = data as VoucherForCheckout | null;
  const now = Date.now();

  if (!voucher?.is_active || new Date(voucher.starts_at).getTime() > now || new Date(voucher.expires_at).getTime() < now) {
    throw new AppError("Voucher is inactive or expired", HTTP_STATUS.CONFLICT, ERROR_CODES.RESOURCE_CONFLICT);
  }
  if (voucher.store_id && voucher.store_id !== storeId) {
    throw new AppError("Voucher is not valid for this store", HTTP_STATUS.CONFLICT, ERROR_CODES.RESOURCE_CONFLICT);
  }
  if (subtotalCents < voucher.min_order_cents) {
    throw new AppError("Order does not meet the voucher minimum value", HTTP_STATUS.CONFLICT, ERROR_CODES.RESOURCE_CONFLICT);
  }
  if (voucher.max_redemptions !== null && voucher.redemption_count >= voucher.max_redemptions) {
    throw new AppError("Voucher redemption limit has been reached", HTTP_STATUS.CONFLICT, ERROR_CODES.RESOURCE_CONFLICT);
  }

  const percentDiscount = voucher.percent_off ? Math.round(subtotalCents * (voucher.percent_off / 100)) : 0;
  const fixedDiscount = voucher.fixed_discount_cents ?? 0;
  return {
    discountCents: Math.min(subtotalCents, Math.max(percentDiscount, fixedDiscount)),
    voucher
  };
};

const MIN_RESTOCK_WINDOW_MS = (): number => policyMs(MIN_PICKUP_WINDOW_MINUTES);

const formatVnTime = (iso: string | Date): string =>
  new Date(iso).toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit" });

const formatMoney = (value: number): string => `${Math.round(value).toLocaleString("vi-VN")}đ`;

// Nhật ký đơn (order_events). Không bao giờ ném lỗi.
const logOrderEvent = async (orderId: string, eventType: string, detail: Record<string, unknown>): Promise<void> => {
  try {
    const { error } = await supabaseAdmin.from("order_events").insert({ order_id: orderId, event_type: eventType, detail });
    if (error) logger.warn("Không ghi được nhật ký đơn", { orderId, eventType, error });
  } catch (error) {
    logger.warn("Không ghi được nhật ký đơn", { orderId, eventType, error });
  }
};

/**
 * Trả số lượng đã giữ về kho bán (và giảm số đã bán).
 * - "always": đơn hủy/hoàn tiền/quá hạn trả: luôn trả.
 * - "if_sellable": hủy muộn / no-show (cửa hàng đã nhận tiền): chỉ trả nếu sản phẩm còn đủ hạn
 *   (còn >= 15 phút tới hạn hiệu lực), đang bán và không bị chặn; nếu không thì ghi nhật ký đơn.
 * Chỉ chạy MỘT lần cho mỗi đơn nhờ cột stock_restored_at.
 */
const restoreOrderStock = async (orderId: string, mode: "always" | "if_sellable", reason: string): Promise<void> => {
  const { data: claimed, error: claimError } = await supabaseAdmin
    .from("orders")
    .update({ stock_restored_at: new Date().toISOString() })
    .eq("id", orderId)
    .is("stock_restored_at", null)
    .select("id");
  if (claimError) {
    logger.warn("Không đánh dấu được trả hàng về kho", { orderId, error: claimError });
    return;
  }
  if (!claimed || claimed.length === 0) return;

  const { data, error } = await supabaseAdmin.from("order_items").select("product_id,quantity").eq("order_id", orderId);
  if (error) {
    logger.warn("Không đọc được chi tiết đơn để trả hàng về kho", { orderId, error });
    return;
  }

  const skipped: Array<{ product_id: string; why: string }> = [];
  const restored: string[] = [];
  const now = Date.now();
  for (const item of (data ?? []) as Array<{ product_id: string; quantity: number }>) {
    const { data: product } = await supabaseAdmin
      .from("products")
      .select("id,stock_quantity,sold_count,is_active,blocked_reason,expires_at,effective_deadline_at")
      .eq("id", item.product_id)
      .maybeSingle();
    const loaded = product as {
      id: string; stock_quantity: number; sold_count: number; is_active: boolean;
      blocked_reason: string | null; expires_at: string; effective_deadline_at: string | null;
    } | null;
    if (!loaded) continue;

    if (mode === "if_sellable") {
      const deadline = new Date(loaded.effective_deadline_at ?? loaded.expires_at).getTime();
      if (!loaded.is_active || loaded.blocked_reason) {
        skipped.push({ product_id: loaded.id, why: "san_pham_bi_chan_hoac_ngung_ban" });
        continue;
      }
      if (!Number.isFinite(deadline) || deadline - now < MIN_RESTOCK_WINDOW_MS()) {
        skipped.push({ product_id: loaded.id, why: "con_duoi_15_phut_toi_han" });
        continue;
      }
    }

    await supabaseAdmin
      .from("products")
      .update({
        stock_quantity: loaded.stock_quantity + item.quantity,
        sold_count: Math.max(0, loaded.sold_count - item.quantity)
      })
      .eq("id", loaded.id);
    restored.push(loaded.id);
  }

  if (skipped.length > 0) {
    await logOrderEvent(orderId, "stock_not_restored", { reason, mode, restored, skipped });
  }
};

// Hạn khiếu nại = completed_at + 12 giờ (có món nấu chín) hoặc + 24 giờ; lấy hạn ngắn nhất
export const complaintDeadlineFor = async (orderId: string, completedAt: Date): Promise<Date> => {
  const { data } = await supabaseAdmin.from("order_items").select("product_id").eq("order_id", orderId);
  const ids = ((data ?? []) as Array<{ product_id: string }>).map((row) => row.product_id);
  let hasCooked = false;
  if (ids.length > 0) {
    const { data: products } = await supabaseAdmin.from("products").select("food_group").in("id", ids);
    hasCooked = ((products ?? []) as Array<{ food_group: string | null }>).some((row) => row.food_group === "cooked");
  }
  const hours = hasCooked ? COMPLAINT_WINDOW_COOKED_HOURS : COMPLAINT_WINDOW_OTHER_HOURS;
  return new Date(completedAt.getTime() + policyHoursMs(hours));
};

const loadStoreOwner = async (storeId: string): Promise<{ owner_id: string; name: string } | null> => {
  const { data } = await supabaseAdmin.from("stores").select("owner_id,name").eq("id", storeId).maybeSingle();
  return (data as { owner_id: string; name: string } | null) ?? null;
};

const notifyStore = async (order: Pick<Order, "id" | "store_id">, type: string, title: string, body: string): Promise<void> => {
  const store = await loadStoreOwner(order.store_id);
  if (!store) return;
  await createNotification({ recipientId: store.owner_id, roleTarget: "partner", type, title, body, relatedType: "order", relatedId: order.id });
};

const notifyCustomer = async (order: Pick<Order, "id" | "customer_id">, type: string, title: string, body: string): Promise<void> => {
  await createNotification({ recipientId: order.customer_id, roleTarget: "customer", type, title, body, relatedType: "order", relatedId: order.id });
};

const ENDED_CHAT_MESSAGE = "Đơn đã kết thúc. Cuộc trò chuyện chỉ còn xem lại.";

// Cho phép đổi trạng thái (cửa hàng/admin). Trạng thái cuối (completed, cancelled, no_show) không đi tiếp.
const STATUS_TRANSITIONS: Record<string, string[]> = {
  awaiting_payment: ["cancelled"],
  pending: ["confirmed", "ready", "completed", "cancelled", "no_show"],
  confirmed: ["ready", "completed", "cancelled", "no_show"],
  ready: ["completed", "cancelled", "no_show"]
};

/** Hủy miễn phí hay không: chưa thanh toán, hoặc còn trong cancel_free_until. Dùng chung cho xem trước và hủy thật. */
const cancelOutcome = (order: Order): { paid: boolean; free: boolean } => {
  const paid = order.payment_status === "paid";
  const free = !paid || !order.cancel_free_until || Date.now() <= new Date(order.cancel_free_until).getTime();
  return { paid, free };
};

const statusConflict = (message: string, code: string = ERROR_CODES.RESOURCE_CONFLICT): AppError =>
  new AppError(message, HTTP_STATUS.CONFLICT, code);

/**
 * Trả tiền thật cho khách qua nhà cung cấp thanh toán (mô phỏng: chỉ ghi nhận). Không bao giờ ném lỗi và không chặn sổ cái:
 * kết quả (thành công hay thất bại) được ghi vào nhật ký đơn để admin xử lý tay nếu cần.
 */
export const refundViaProvider = async (order: Order, amount: number, reason: string): Promise<void> => {
  try {
    const provider = getPaymentProvider(order.payment_provider ?? env.PAYMENT_PROVIDER);
    const result = await provider.refund(order.payment_ref ?? null, amount, { orderNumber: order.order_number, reason });
    await logOrderEvent(order.id, result.ok ? "provider_refund" : "provider_refund_failed", { provider: provider.name, amount, refund_ref: result.refundRef, reason });
  } catch (error) {
    logger.warn("Hoàn tiền qua nhà cung cấp thất bại", { orderId: order.id, error });
    await logOrderEvent(order.id, "provider_refund_failed", { amount, reason, error: error instanceof Error ? error.message : String(error) });
  }
};

/** Đánh dấu vắng mặt (quá hạn lấy hàng). Tiền không hoàn; hàng chỉ về kho nếu còn đủ hạn. Trả null nếu đơn đã đổi trạng thái. */
export const markOrderNoShow = async (order: Order): Promise<Order | null> => {
  const { data, error } = await supabaseAdmin
    .from("orders")
    .update({
      status: "no_show",
      no_show_at: new Date().toISOString(),
      settlement_status: "forfeited",
      cancel_reason: "no_show"
    })
    .eq("id", order.id)
    .in("status", ["pending", "confirmed", "ready"])
    .select("*")
    .maybeSingle();
  if (error) handleSupabaseError(error, "Failed to mark order as no-show");
  if (!data) return null;

  await ledgerService.syncOrderSafe(data as Order);
  await restoreOrderStock(order.id, "if_sellable", "no_show");
  try {
    await customerReputationService.recordNoShow(order.customer_id, order.id);
  } catch (reputationError) {
    logger.warn("Không ghi nhận được no-show cho người mua", { orderId: order.id, error: reputationError });
  }
  await notifyCustomer(
    order,
    "order-no-show",
    `Đơn ${order.order_number} đã quá hạn lấy hàng`,
    `Bạn không đến nhận hàng đúng hạn nên đơn không được hoàn tiền và bị trừ ${Math.abs(CUSTOMER_REPUTATION.noShowDelta)} điểm uy tín.`
  );
  await notifyStore(
    order,
    "order-no-show",
    `Khách không đến nhận đơn ${order.order_number}`,
    `Đơn đã chuyển sang Vắng mặt. Tiền đơn (trừ phí ${formatMoney(order.platform_fee_cents)}) thuộc về cửa hàng.`
  );
  await orderChatService.postSystem(order.id, ENDED_CHAT_MESSAGE);
  return data as Order;
};

/** Đơn quá hạn thanh toán: hủy do hệ thống, trả hàng về kho, KHÔNG tính lỗi người mua. Trả null nếu đơn đã đổi trạng thái. */
export const cancelOrderForPaymentTimeout = async (order: Order): Promise<Order | null> => {
  const { data, error } = await supabaseAdmin
    .from("orders")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      cancel_reason: "payment_timeout",
      cancelled_by: "system"
    })
    .eq("id", order.id)
    .eq("status", "awaiting_payment")
    .select("*")
    .maybeSingle();
  if (error) handleSupabaseError(error, "Failed to cancel unpaid order");
  if (!data) return null;

  await restoreOrderStock(order.id, "always", "payment_timeout");
  await notifyCustomer(
    order,
    "order-payment-timeout",
    `Đơn ${order.order_number} đã hết hạn thanh toán`,
    "Hàng đã được trả về kho. Bạn không bị tính lỗi, có thể đặt lại nếu sản phẩm còn."
  );
  return data as Order;
};

/** Cửa hàng/admin hủy, từ chối, hết hàng: hoàn 100% nếu đã trả, trừ điểm cửa hàng như cũ, hàng luôn về kho */
const storeCancelOrder = async (order: Order, actorRole: UserRole): Promise<Order> => {
  const paid = order.payment_status === "paid";
  const { data, error } = await supabaseAdmin
    .from("orders")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      cancel_reason: actorRole === "admin" ? "admin_cancelled" : "store_cancelled",
      cancelled_by: actorRole === "admin" ? "admin" : "store",
      ...(paid ? { payment_status: "refunded", settlement_status: "refunded" } : {})
    })
    .eq("id", order.id)
    .eq("status", order.status)
    .select("*")
    .maybeSingle();
  if (error) handleSupabaseError(error, "Failed to cancel order");
  if (!data) throw statusConflict("Đơn vừa được cập nhật ở nơi khác, hãy tải lại");

  await ledgerService.syncOrderSafe(data as Order);
  if (paid) await refundViaProvider(data as Order, Number(order.total_cents), "store_cancel");
  await restoreOrderStock(order.id, "always", "store_cancel");
  // Chỉ phạt cửa hàng khi chính cửa hàng hủy, hoặc đơn đã thanh toán; admin hủy đơn chưa trả thì không phạt cửa hàng
  if (actorRole === "partner" || paid) {
    try {
      await sellerReputationService.handleSellerCancellation(order.store_id, order.id);
    } catch (penaltyError) {
      logger.warn("Không trừ được điểm uy tín khi hủy đơn", { orderId: order.id, error: penaltyError });
    }
  }
  await notifyCustomer(
    order,
    "order-update",
    `Đơn ${order.order_number} đã bị hủy`,
    paid ? `Cửa hàng đã hủy đơn. Bạn được hoàn ${formatMoney(order.total_cents)} (100%) và hàng được trả về kho.` : "Đơn hàng đã được hủy và số lượng được hoàn về kho."
  );
  if (paid) await orderChatService.postSystem(order.id, ENDED_CHAT_MESSAGE);
  return data as Order;
};

export const orderService = {
  async createOrder(customerId: string, body: CreateOrderBody): Promise<{ order: Order; items: OrderItem[]; payment: PaymentInit | null }> {
    await policyConfigService.ensureFresh();
    const products = await loadCheckoutProducts(body);
    const productById = new Map(products.map((product) => [product.id, product]));
    const orderLabel = mostUrgentLabel(products.map((product) => product.label));
    await customerReputationService.assertCanOrder(customerId, products.some((product) => product.label === "red"));
    const productDeadlineMs = earliestDeadline(products.map((product) => product.effective_deadline_at ?? product.expires_at));
    if (!hasEnoughTimeToOrder(orderLabel, Date.now(), productDeadlineMs)) {
      throw new AppError(
        "Sản phẩm sắp hết hạn, không đủ thời gian để thanh toán và đến lấy hàng. Vui lòng chọn sản phẩm khác.",
        HTTP_STATUS.CONFLICT,
        ERROR_CODES.RESOURCE_CONFLICT
      );
    }
    const labelPolicy = LABEL_POLICY[orderLabel];
    const payDeadline = new Date(Date.now() + policyMs(labelPolicy.payMinutes));
    const subtotalCents = body.items.reduce((sum, item) => {
      const product = productById.get(item.product_id);
      return sum + (product?.price_cents ?? 0) * item.quantity;
    }, 0);
    const storeId = requireRecord(products[0], "Checkout product was not found").store_id;
    const { discountCents, voucher } = await calculateDiscount(body.voucher_code, storeId, subtotalCents);
    const platformFeeCents = 2000;
    const totalCents = Math.max(0, subtotalCents - discountCents + platformFeeCents + body.donation_cents);
    const orderNumber = generateCode("FS");
    const qrCode = generateCode(orderNumber.replace("FS-", "QR-"));

    const baseOrderRow = {
        order_number: orderNumber,
        customer_id: customerId,
        store_id: storeId,
        status: "awaiting_payment",
        pickup_slot_key: body.pickup_slot_key,
        pickup_window: `Trong ${labelPolicy.pickupMinutes} phút sau khi thanh toán`,
        payment_method: body.payment_method,
        payment_status: "pending",
        pay_deadline: payDeadline.toISOString(),
        policy_label: orderLabel,
        subtotal_cents: subtotalCents,
        discount_cents: discountCents,
        platform_fee_cents: platformFeeCents,
        donation_cents: body.donation_cents,
        total_cents: totalCents,
        voucher_code: voucher?.code ?? null,
        qr_code: qrCode,
        customer_note: body.customer_note ?? null
    };
    const receiverFields: Record<string, string> = {};
    if (body.receiver_name) receiverFields.receiver_name = body.receiver_name;
    if (body.receiver_phone) receiverFields.receiver_phone = body.receiver_phone;
    if (body.receiver_email) receiverFields.receiver_email = body.receiver_email;

    let { data: orderData, error: orderError } = await supabaseAdmin
      .from("orders")
      .insert({ ...baseOrderRow, ...receiverFields })
      .select("*")
      .single();

    // Cột người nhận chưa có (chưa chạy SQL 020): vẫn tạo đơn như cũ
    if (orderError && Object.keys(receiverFields).length > 0 && (orderError.code === "42703" || orderError.code === "PGRST204")) {
      ({ data: orderData, error: orderError } = await supabaseAdmin.from("orders").insert(baseOrderRow).select("*").single());
    }

    if (orderError) handleSupabaseError(orderError, "Failed to create order");
    const order = orderData as Order;
    const orderId = order.id;
    if (!orderId) {
      throw new Error("Order creation failed: Order ID is missing");
    }

   // Dọn dẹp lại việc mapping order items
    const orderItemsPayload = body.items.map((item) => {
        const product = requireRecord(productById.get(item.product_id), "Checkout product was not found");

        return {
            order_id: orderId,
            product_id: product.id,
            product_name: product.name,
            unit_price_cents: product.price_cents,
            original_unit_price_cents: product.original_unit_price_cents,
            quantity: item.quantity,
            product_metadata: {
                category: product.category,
                label: product.label,
                expires_at: product.expires_at,
                emoji: product.emoji,
                estimated_weight_kg: product.estimated_weight_kg,
                servings_count: product.servings_count
            }
        };
    });

    const { data: itemData, error: itemError } = await supabaseAdmin
      .from("order_items")
      .insert(orderItemsPayload)
      .select("*");

    if (itemError) handleSupabaseError(itemError, "Failed to create order items");

    for (const item of body.items) {
      const product = requireRecord(productById.get(item.product_id), "Checkout product was not found");
      const { error: stockError } = await supabaseAdmin
        .from("products")
        .update({ stock_quantity: product.stock_quantity - item.quantity, sold_count: product.sold_count + item.quantity })
        .eq("id", item.product_id);

      if (stockError) handleSupabaseError(stockError, "Failed to update product stock");
    }

    if (voucher) {
      const { error: voucherError } = await supabaseAdmin
        .from("vouchers")
        .update({ redemption_count: voucher.redemption_count + 1 })
        .eq("code", voucher.code);
      if (voucherError) handleSupabaseError(voucherError, "Failed to update voucher");
    }

    // Cửa hàng chỉ được báo khi người mua THANH TOÁN (xem markPaid), không báo ở bước tạo đơn

    // Nhờ nhà cung cấp thanh toán chuẩn bị giao dịch (mô phỏng: nút "Đã thanh toán"; cổng thật: link / QR).
    // Lỗi (ví dụ cổng chưa cấu hình) thì hủy đơn và trả hàng về kho, không để đơn treo.
    let payment: PaymentInit | null = null;
    try {
      payment = await getPaymentProvider().createPayment(order);
    } catch (providerError) {
      await supabaseAdmin.from("orders").update({ status: "cancelled", cancelled_at: new Date().toISOString(), cancel_reason: "payment_provider_error", cancelled_by: "system" }).eq("id", order.id);
      await restoreOrderStock(order.id, "always", "payment_provider_error");
      throw providerError;
    }
    if (payment) {
      const { error: refError } = await supabaseAdmin.from("orders").update({ payment_provider: payment.provider, payment_ref: payment.paymentRef }).eq("id", order.id);
      if (refError) logger.warn("Chưa lưu được mã tham chiếu thanh toán (đã chạy SQL 034 chưa?)", { orderId: order.id, error: refError });
      else Object.assign(order, { payment_provider: payment.provider, payment_ref: payment.paymentRef });
    }

    await supabaseAdmin.from("cart_items").delete().eq("user_id", customerId);

    return {
      order,
      items: (itemData ?? []) as OrderItem[],
      payment
    };
  },

  async createMomoPayment(customerId: string, body: CreateMomoPaymentBody): Promise<{ order: Order; items: OrderItem[]; payment: unknown }> {
    const created = await orderService.createOrder(customerId, {
      ...body,
      payment_method: "momo"
    });
    const payment = await momoPaymentService.createPayment(created.order);
    return {
      ...created,
      payment
    };
  },

  async refreshMomoPayment(actorId: string, actorRole: UserRole, orderId: string): Promise<{ order: Order; payment: unknown }> {
    const order = await assertOrderAccess(orderId, actorId, actorRole);
    const payment = await momoPaymentService.createPayment(order);
    return { order, payment };
  },

  async pollMomoPayment(actorId: string, actorRole: UserRole, orderId: string): Promise<{ order: Order; payment: unknown }> {
    const order = await assertOrderAccess(orderId, actorId, actorRole);
    return momoPaymentService.queryPayment(order);
  },

  async applyMomoWebhookMock(body: MomoWebhookMockBody): Promise<Order> {
        const result = await momoPaymentService.applyMockWebhook(body);
        
        if (!result) {
            throw new Error("Không tìm thấy đơn hàng sau khi xử lý webhook");
        }
        
        return result as Order;
    },

  async listOrders(actorId: string, actorRole: UserRole, query: OrderListQuery): Promise<PaginatedResponse<unknown>> {
    const { from, to } = getRange(query);
    let request = supabaseAdmin
      .from("orders")
      .select("*, order_items(*), stores(id,name,slug,owner_id,emoji), customer:profiles!customer_id(full_name,phone)", { count: "exact" })
      .range(from, to)
      .order("created_at", { ascending: false });

    if (actorRole === "customer") request = request.eq("customer_id", actorId);
    if (actorRole === "partner") {
      const storeIds = await getOwnedStoreIds(actorId);
      if (query.store_id && storeIds.includes(query.store_id)) {
        request = request.eq("store_id", query.store_id);
      } else if (query.store_id) {
        request = request.eq("store_id", "00000000-0000-0000-0000-000000000000");
      } else {
        request = request.in("store_id", storeIds.length > 0 ? storeIds : ["00000000-0000-0000-0000-000000000000"]);
      }
    }
    if (query.status) request = request.eq("status", query.status);
    if (actorRole === "partner") {
      request = request.neq("status", "awaiting_payment").or("cancel_reason.is.null,cancel_reason.neq.payment_timeout");
    }
    if (actorRole === "admin" && query.store_id) request = request.eq("store_id", query.store_id);

    const { data, error, count } = await request;
    if (error) handleSupabaseError(error, "Failed to list orders");
    return {
      items: data ?? [],
      pagination: toPagination(query.page, query.limit, count ?? 0)
    };
  },

  async getOrder(actorId: string, actorRole: UserRole, orderId: string): Promise<unknown> {
    const accessed = await assertOrderAccess(orderId, actorId, actorRole);
    if (actorRole === "partner" && (accessed.status === "awaiting_payment" || accessed.cancel_reason === "payment_timeout")) {
      throw new AppError("Order was not found", HTTP_STATUS.NOT_FOUND, ERROR_CODES.RESOURCE_NOT_FOUND);
    }
    const { data, error } = await supabaseAdmin
      .from("orders")
      .select("*, order_items(*), stores(id,name,slug,owner_id,emoji,address), reviews(*), complaints(*)")
      .eq("id", orderId)
      .single();

    if (error) handleSupabaseError(error, "Failed to load order details");
    return data;
  },

  async updateOrderStatus(actorId: string, actorRole: UserRole, orderId: string, body: UpdateOrderStatusBody): Promise<Order> {
    const order = await assertOrderAccess(orderId, actorId, actorRole);
    if (actorRole === "customer") {
      throw new AppError("Người mua hủy đơn bằng POST /orders/:id/cancel", HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN);
    }
    // Cửa hàng không thấy đơn chưa thanh toán
    if (actorRole === "partner" && (order.status === "awaiting_payment" || order.cancel_reason === "payment_timeout")) {
      throw new AppError("Order was not found", HTTP_STATUS.NOT_FOUND, ERROR_CODES.RESOURCE_NOT_FOUND);
    }
    // Bấm lặp lại cùng một trạng thái: trả nguyên đơn, không xử lý lần hai (không cộng điểm/hoàn tiền trùng)
    if (order.status === body.status) return order;

    const allowed = STATUS_TRANSITIONS[order.status] ?? [];
    if (!allowed.includes(body.status)) {
      throw statusConflict(`Đơn đang ở trạng thái "${order.status}", không thể chuyển sang "${body.status}"`);
    }

    if (body.status === "no_show") {
      // Cùng mốc với tác vụ định kỳ: hạn lấy + thời gian châm chước (khi đó cửa hàng cũng hết quyền xác nhận hoàn tất)
      const deadline = order.pickup_deadline ? new Date(order.pickup_deadline).getTime() + policyMs(COMPLETE_GRACE_MINUTES) : null;
      if (actorRole !== "admin" && (deadline === null || Date.now() < deadline)) {
        throw statusConflict("Chưa quá hạn lấy hàng (kể cả 5 phút châm chước) nên chưa thể đánh dấu khách vắng mặt");
      }
      const updated = await markOrderNoShow(order);
      if (!updated) throw statusConflict("Đơn vừa được cập nhật ở nơi khác, hãy tải lại");
      return updated;
    }

    if (body.status === "cancelled") return storeCancelOrder(order, actorRole);

    if (body.status === "completed") {
      if (order.payment_status !== "paid") throw statusConflict("Đơn chưa thanh toán nên chưa thể hoàn tất");
      if (order.pickup_deadline && Date.now() > new Date(order.pickup_deadline).getTime() + policyMs(COMPLETE_GRACE_MINUTES)) {
        throw statusConflict("Đã quá hạn lấy hàng, không thể xác nhận khách nhận hàng", ERROR_CODES.PICKUP_EXPIRED);
      }
      const completedAt = new Date();
      const complaintDeadline = await complaintDeadlineFor(order.id, completedAt);
      const { data, error } = await supabaseAdmin
        .from("orders")
        .update({
          status: "completed",
          completed_at: completedAt.toISOString(),
          complaint_deadline_at: complaintDeadline.toISOString(),
          ...(order.settlement_status === "held" ? { settlement_status: "released" } : {})
        })
        .eq("id", orderId)
        .eq("status", order.status)
        .select("*")
        .maybeSingle();
      if (error) handleSupabaseError(error, "Failed to complete order");
      if (!data) throw statusConflict("Đơn vừa được cập nhật ở nơi khác, hãy tải lại");

      await ledgerService.syncOrderSafe(data as Order);
      try {
        await sellerReputationService.handleOrderSuccess(order.store_id, body.is_charity_order);
      } catch (error) {
        logger.warn("Không cộng được điểm uy tín cửa hàng", { orderId: order.id, error });
      }
      try {
        await customerReputationService.applyDelta(order.customer_id, CUSTOMER_REPUTATION.pickupSuccessDelta, "pickup_completed");
      } catch (error) {
        logger.warn("Không cộng được điểm uy tín người mua", { orderId: order.id, error });
      }
      try {
        await ecoImpactService.recordOrderImpact(order.id);
      } catch (error) {
        logger.warn("Failed to record eco impact for completed order", { orderId: order.id, error });
      }
      await notifyCustomer(order, "order-update", "Nhận hàng thành công", `Đơn ${order.order_number} đã hoàn tất. Cảm ơn bạn đã cứu thực phẩm cùng FoodSave!`);
      await orderChatService.postSystem(order.id, ENDED_CHAT_MESSAGE);
      return data as Order;
    }

    // confirmed | ready
    const { data, error } = await supabaseAdmin
      .from("orders")
      .update({ status: body.status })
      .eq("id", orderId)
      .eq("status", order.status)
      .select("*")
      .maybeSingle();
    if (error) handleSupabaseError(error, "Failed to update order status");
    if (!data) throw statusConflict("Đơn vừa được cập nhật ở nơi khác, hãy tải lại");

    if (body.status === "confirmed") {
      await notifyCustomer(order, "order-update", `Cửa hàng đã nhận đơn ${order.order_number}`, "Cửa hàng đang chuẩn bị hàng cho bạn.");
    } else {
      const owner = await loadStoreOwner(order.store_id);
      const until = (data as Order).pickup_deadline ?? order.pickup_deadline;
      await notifyCustomer(
        order,
        "order-ready",
        `Cửa hàng ${owner?.name ?? ""} đã chuẩn bị xong đơn`.replace("  ", " "),
        until ? `Đơn ${order.order_number}: đến nhận trước ${formatVnTime(new Date(until))}. Mang mã QR cho cửa hàng.` : `Đơn ${order.order_number}: hãy mang mã QR đến cửa hàng để nhận hàng.`
      );
      await orderChatService.postSystem(order.id, "Đơn đã sẵn sàng, mời bạn đến nhận hàng.");
    }
    return data as Order;
  },

  /**
   * Thanh toán thành công (mô phỏng; sau này webhook MoMo thật cũng gọi vào markPaid).
   * Chỉ người mua của đơn (hoặc admin) được xác nhận; mọi kiểm tra hạn nằm ở markPaid.
   */
  async confirmPayment(actorId: string, actorRole: UserRole, orderId: string, paymentMethod?: Order["payment_method"]): Promise<Order> {
    const order = await assertOrderAccess(orderId, actorId, actorRole);
    if (actorRole === "customer" && order.customer_id !== actorId) {
      throw new AppError("You can only confirm payment for your own order", HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN);
    }
    // Chỉ nhà cung cấp mô phỏng cho người mua tự bấm "Đã thanh toán". Cổng thật: chỉ webhook đã kiểm tra chữ ký mới xác nhận.
    if (actorRole === "customer" && !getPaymentProvider().allowsManualConfirm) {
      throw new AppError("Đơn hàng này được xác nhận thanh toán tự động bởi cổng thanh toán, không thể tự bấm xác nhận", HTTP_STATUS.FORBIDDEN, ERROR_CODES.PAYMENT_REQUIRES_PROVIDER);
    }
    return orderService.markPaid(order, paymentMethod);
  },

  /** Dành cho webhook cổng thanh toán (không có người dùng đăng nhập) */
  async markPaidBySystem(orderId: string, paymentMethod?: Order["payment_method"], reference?: { provider: string; ref: string }): Promise<Order> {
    const { data, error } = await supabaseAdmin.from("orders").select("*").eq("id", orderId).single();
    if (error) handleSupabaseError(error, "Failed to load order for payment");
    return orderService.markPaid(requireRecord(data as Order | null, "Order was not found"), paymentMethod, reference);
  },

  async markPaid(order: Order, paymentMethod?: Order["payment_method"], reference?: { provider: string; ref: string }): Promise<Order> {
    await policyConfigService.ensureFresh();
    if (order.payment_status === "paid") return order;
    if (order.cancel_reason === "payment_timeout") {
      throw statusConflict("Đơn đã hết hạn thanh toán, hàng đã được trả về kho.", ERROR_CODES.PAYMENT_EXPIRED);
    }
    if (order.status === "cancelled" || order.status === "no_show" || order.status === "completed") {
      throw statusConflict("Đơn hàng đã bị hủy hoặc đã kết thúc");
    }

    // Đơn tạo trước khi có quy trình trả trước (không có pay_deadline): giữ cách cũ, chỉ đổi trạng thái thanh toán
    if (order.status !== "awaiting_payment") {
      const { data, error } = await supabaseAdmin
        .from("orders")
        .update({ payment_status: "paid", ...(paymentMethod ? { payment_method: paymentMethod } : {}) })
        .eq("id", order.id)
        .select("*")
        .single();
      if (error) handleSupabaseError(error, "Failed to confirm order payment");
      await notifyStore(order, "order-paid", `Đơn ${order.order_number} đã thanh toán`, "Khách đã thanh toán, hãy nhận đơn và chuẩn bị hàng.");
      return data as Order;
    }

    if (order.pay_deadline && Date.now() > new Date(order.pay_deadline).getTime()) {
      await cancelOrderForPaymentTimeout(order);
      throw statusConflict("Đơn đã hết hạn thanh toán, hàng đã được trả về kho.", ERROR_CODES.PAYMENT_EXPIRED);
    }

    const paidAt = new Date();
    const label: ProductLabel = order.policy_label ?? "green";
    const { data: itemRows } = await supabaseAdmin.from("order_items").select("product_id").eq("order_id", order.id);
    const productIds = ((itemRows ?? []) as Array<{ product_id: string }>).map((row) => row.product_id);
    let productDeadlineMs: number | null = null;
    if (productIds.length > 0) {
      const { data: productRows } = await supabaseAdmin.from("products").select("effective_deadline_at,expires_at").in("id", productIds);
      productDeadlineMs = earliestDeadline(
        ((productRows ?? []) as Array<{ effective_deadline_at: string | null; expires_at: string }>).map((row) => row.effective_deadline_at ?? row.expires_at)
      );
    }
    const timeline = computePaymentTimeline(label, paidAt, productDeadlineMs);

    const { data, error } = await supabaseAdmin
      .from("orders")
      .update({
        status: "pending",
        payment_status: "paid",
        paid_at: paidAt.toISOString(),
        pickup_deadline: timeline.pickupDeadline.toISOString(),
        cancel_free_until: timeline.cancelFreeUntil.toISOString(),
        settlement_status: "held",
        ...(paymentMethod ? { payment_method: paymentMethod } : {}),
        ...(reference ? { payment_provider: reference.provider, payment_ref: reference.ref } : {})
      })
      .eq("id", order.id)
      .eq("status", "awaiting_payment")
      .select("*")
      .maybeSingle();
    if (error) handleSupabaseError(error, "Failed to confirm order payment");
    if (!data) {
      // Bấm hai lần / đơn vừa đổi trạng thái: trả trạng thái hiện tại thay vì ghi trùng
      const { data: current } = await supabaseAdmin.from("orders").select("*").eq("id", order.id).single();
      return (current as Order | null) ?? order;
    }

    await ledgerService.syncOrderSafe(data as Order);
    await notifyCustomer(
      order,
      "order-paid",
      "Thanh toán thành công",
      `Đơn ${order.order_number}: hãy đến lấy hàng trước ${formatVnTime(timeline.pickupDeadline)}. Hủy miễn phí đến ${formatVnTime(timeline.cancelFreeUntil)}, sau đó không được hoàn tiền.`
    );
    await notifyStore(order, "order-paid", `Đơn ${order.order_number} đã thanh toán`, "Khách đã thanh toán, hãy nhận đơn và chuẩn bị hàng.");
    await orderChatService.postSystem(order.id, "Cuộc trò chuyện được mở sau khi bạn thanh toán. Cửa hàng và bạn có thể trao đổi về đơn này.");
    return data as Order;
  },

  /**
   * Người mua hủy đơn. awaiting_payment: hủy, không có tiền. Đã trả: trong hạn miễn phí hoàn 100%;
   * sau đó không hoàn (tiền thuộc cửa hàng), người mua -5 điểm. Hàng luôn được xem xét trả về kho.
   */
  /** Xem trước kết quả hủy (không ghi gì): cùng quy tắc với cancelByCustomer, số liệu do máy chủ tính */
  async previewCancel(customerId: string, orderId: string): Promise<{
    can_cancel: boolean; paid: boolean; free: boolean; refund_cents: number; penalty_points: number;
    cancel_free_until: string | null; message: string;
  }> {
    await policyConfigService.ensureFresh();
    const { data, error } = await supabaseAdmin.from("orders").select("*").eq("id", orderId).single();
    if (error) handleSupabaseError(error, "Failed to load order");
    const order = requireRecord(data as Order | null, "Order was not found");
    if (order.customer_id !== customerId) {
      throw new AppError("Only the order owner can cancel this order", HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN);
    }
    if (!["awaiting_payment", "pending", "confirmed", "ready"].includes(order.status)) {
      return { can_cancel: false, paid: order.payment_status === "paid", free: false, refund_cents: 0, penalty_points: 0, cancel_free_until: order.cancel_free_until ?? null, message: "Đơn này không còn hủy được" };
    }
    const { paid, free } = cancelOutcome(order);
    const refund = paid && free ? Number(order.total_cents) : 0;
    const penalty = paid && !free ? Math.abs(CUSTOMER_REPUTATION.lateCancelDelta) : 0;
    const message = !paid
      ? "Đơn chưa thanh toán, hủy không mất phí."
      : free
        ? "Còn trong thời gian hủy miễn phí: hoàn 100% tiền đơn."
        : "Đã quá thời gian hủy miễn phí: không hoàn tiền và bị trừ điểm uy tín.";
    return { can_cancel: true, paid, free, refund_cents: refund, penalty_points: penalty, cancel_free_until: order.cancel_free_until ?? null, message };
  },

  async cancelByCustomer(customerId: string, orderId: string, body: CancelOrderBody): Promise<{ order: Order; refunded: boolean; refund_cents: number }> {
    await policyConfigService.ensureFresh();
    const { data, error } = await supabaseAdmin.from("orders").select("*").eq("id", orderId).single();
    if (error) handleSupabaseError(error, "Failed to load order");
    const order = requireRecord(data as Order | null, "Order was not found");
    if (order.customer_id !== customerId) {
      throw new AppError("Only the order owner can cancel this order", HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN);
    }
    if (!["awaiting_payment", "pending", "confirmed", "ready"].includes(order.status)) {
      throw statusConflict("Đơn này không còn hủy được");
    }

    const nowIso = new Date().toISOString();
    const { paid, free } = cancelOutcome(order);
    const patch: Record<string, unknown> = { status: "cancelled", cancelled_at: nowIso, cancelled_by: "customer" };
    if (!paid) {
      patch.cancel_reason = "customer_cancelled_unpaid";
    } else if (free) {
      Object.assign(patch, { cancel_reason: "customer_free_cancel", payment_status: "refunded", settlement_status: "refunded" });
    } else {
      Object.assign(patch, { cancel_reason: "late_cancel", settlement_status: "forfeited" });
    }

    const { data: updatedRow, error: updateError } = await supabaseAdmin
      .from("orders")
      .update(patch)
      .eq("id", orderId)
      .eq("status", order.status)
      .select("*")
      .maybeSingle();
    if (updateError) handleSupabaseError(updateError, "Failed to cancel order");
    if (!updatedRow) throw statusConflict("Đơn vừa được cập nhật ở nơi khác, hãy tải lại");

    await ledgerService.syncOrderSafe(updatedRow as Order);
    if (paid && free) await refundViaProvider(updatedRow as Order, Number(order.total_cents), "customer_free_cancel");
    await restoreOrderStock(order.id, paid && !free ? "if_sellable" : "always", paid && !free ? "late_cancel" : "customer_cancel");
    await logOrderEvent(order.id, "customer_cancel", { paid, free, reason: body.reason ?? null });

    if (paid && !free) {
      try {
        await customerReputationService.applyDelta(customerId, CUSTOMER_REPUTATION.lateCancelDelta, "late_cancel");
      } catch (reputationError) {
        logger.warn("Không trừ được điểm khi hủy muộn", { orderId, error: reputationError });
      }
    }

    if (paid) {
      await notifyStore(
        order,
        "order-cancelled",
        `Khách đã hủy đơn ${order.order_number}`,
        free ? "Khách hủy trong thời gian miễn phí, đơn đã hoàn tiền cho khách." : "Khách hủy muộn, không hoàn tiền: tiền đơn (trừ phí) thuộc về cửa hàng."
      );
      await orderChatService.postSystem(order.id, ENDED_CHAT_MESSAGE);
    }
    await notifyCustomer(
      order,
      "order-update",
      `Đơn ${order.order_number} đã hủy`,
      !paid ? "Đơn chưa thanh toán đã được hủy." : free ? `Đã hoàn ${formatMoney(order.total_cents)} (100%).` : "Bạn hủy sau thời gian miễn phí nên không được hoàn tiền và bị trừ 5 điểm uy tín."
    );

    return { order: updatedRow as Order, refunded: paid && free, refund_cents: paid && free ? Number(order.total_cents) : 0 };
  },

  /** Cho tác vụ định kỳ: hủy đơn quá hạn thanh toán */
  cancelExpiredPayment: cancelOrderForPaymentTimeout,
  /** Cho tác vụ định kỳ: đánh dấu vắng mặt */
  markNoShow: markOrderNoShow,
  restoreStock: restoreOrderStock,

  async createReview(customerId: string, body: CreateReviewBody): Promise<unknown> {
    const { data: order, error: orderError } = await supabaseAdmin
      .from("orders")
      .select("id,store_id,customer_id,status")
      .eq("id", body.order_id)
      .single();

    if (orderError) handleSupabaseError(orderError, "Failed to load order");
    const loadedOrder = requireRecord(order as { id: string; store_id: string; customer_id: string; status: string } | null, "Order was not found");
    if (loadedOrder.customer_id !== customerId || loadedOrder.status !== "completed") {
      throw new AppError("Only completed orders owned by the customer can be reviewed", HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN);
    }

    const { data, error } = await supabaseAdmin
      .from("reviews")
      .insert({
        order_id: loadedOrder.id,
        customer_id: customerId,
        store_id: loadedOrder.store_id,
        product_id: body.product_id ?? null,
        rating: body.rating,
        comment: body.comment ?? null,
        photo_urls: body.photo_urls
      })
      .select("*")
      .single();

    if (error) handleSupabaseError(error, "Failed to create review");
    return data;
  }
};
