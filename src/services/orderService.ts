import type {
  CreateComplaintBody,
  CreateMomoPaymentBody,
  CreateOrderBody,
  CreateReviewBody,
  MomoWebhookMockBody,
  OrderListQuery,
  UpdateComplaintBody,
  UpdateOrderStatusBody
} from "../schemas/orderSchemas";
import { ERROR_CODES } from "../constants/errors";
import { HTTP_STATUS } from "../constants/http";
import type { Order, OrderItem, UserRole } from "../types/domain";
import { AppError } from "../utils/appError";
import { generateCode, getRange, handleSupabaseError, requireRecord, supabaseAdmin, toPagination } from "./supabaseService";
import type { PaginatedResponse } from "../types/api";
import { sellerReputationService } from "./sellerReputationService";
import { momoPaymentService } from "./momoPaymentService";

interface ProductForCheckout {
  id: string;
  store_id: string;
  name: string;
  price_cents: number;
  original_price_cents: number;
  stock_quantity: number;
  sold_count: number;
  is_active: boolean;
  category: string;
  label: string;
  emoji: string | null;
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

const pickupWindows: Record<CreateOrderBody["pickup_slot_key"], string> = {
  now: "Trong 30 phút",
  "2h": "Trong 2 giờ",
  tonight: "Tối nay 18-22h",
  tomorrow: "Mai 9-12h"
};

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
    .select("id,store_id,name,price_cents,original_price_cents,stock_quantity,sold_count,is_active,category,label,emoji")
    .in("id", productIds);

  if (error) handleSupabaseError(error, "Failed to load checkout products");
  const products = (data ?? []) as ProductForCheckout[];

  if (products.length !== productIds.length) {
    throw new AppError("One or more products were not found", HTTP_STATUS.NOT_FOUND, ERROR_CODES.RESOURCE_NOT_FOUND);
  }

  const storeId = products[0]?.store_id;
  if (!storeId || products.some((product) => product.store_id !== storeId)) {
    throw new AppError("A single order can only contain products from one store", HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
  }

  for (const item of body.items) {
    const product = products.find((candidate) => candidate.id === item.product_id);
    if (!product?.is_active || product.stock_quantity < item.quantity) {
      throw new AppError(`Product ${item.product_id} does not have enough stock`, HTTP_STATUS.CONFLICT, ERROR_CODES.RESOURCE_CONFLICT);
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

export const orderService = {
  async createOrder(customerId: string, body: CreateOrderBody): Promise<{ order: Order; items: OrderItem[] }> {
    const products = await loadCheckoutProducts(body);
    const productById = new Map(products.map((product) => [product.id, product]));
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

    const { data: orderData, error: orderError } = await supabaseAdmin
      .from("orders")
      .insert({
        order_number: orderNumber,
        customer_id: customerId,
        store_id: storeId,
        status: "pending",
        pickup_slot_key: body.pickup_slot_key,
        pickup_window: pickupWindows[body.pickup_slot_key],
        payment_method: body.payment_method,
        payment_status: "pending",
        subtotal_cents: subtotalCents,
        discount_cents: discountCents,
        platform_fee_cents: platformFeeCents,
        donation_cents: body.donation_cents,
        total_cents: totalCents,
        voucher_code: voucher?.code ?? null,
        qr_code: qrCode,
        customer_note: body.customer_note ?? null
      })
      .select("*")
      .single();

    if (orderError) handleSupabaseError(orderError, "Failed to create order");
    const order = orderData as Order;

   // Dọn dẹp lại việc mapping order items
    const orderItemsPayload = body.items.map((item) => {
        const product = requireRecord(productById.get(item.product_id), "Checkout product was not found");
        
        // Kiểm tra chắc chắn order.id tồn tại trước khi dùng
        if (!order || !order.id) {
            throw new Error("Order creation failed: Order ID is missing");
        }

        return {
            order_id: order.id, // Bây giờ TypeScript sẽ hiểu order.id chắc chắn là string
            product_id: product.id,
            product_name: product.name,
            unit_price_cents: product.price_cents,
            original_unit_price_cents: product.original_unit_price_cents,
            quantity: item.quantity,
            product_metadata: {
                category: product.category,
                label: product.label,
                emoji: product.emoji
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

    const { data: storeData, error: storeError } = await supabaseAdmin
      .from("stores")
      .select("owner_id,name")
      .eq("id", storeId)
      .single();

    if (storeError) handleSupabaseError(storeError, "Failed to load store for notification");
    const store = storeData as { owner_id: string; name: string };

    await supabaseAdmin.from("notifications").insert({
      recipient_id: store.owner_id,
      role_target: "partner",
      type: "new-order",
      title: `Đơn hàng mới ${order.order_number}`,
      body: `${orderItemsPayload.length} mặt hàng từ ${store.name}`,
      related_type: "order",
      related_id: order.id
    });

    const { data: customerProfile, error: profileLoadError } = await supabaseAdmin
      .from("profiles")
      .select("points")
      .eq("id", customerId)
      .single();
    if (profileLoadError) handleSupabaseError(profileLoadError, "Failed to load customer profile");
    const currentPoints = (customerProfile as { points: number } | null)?.points ?? 0;
    const { error: pointsError } = await supabaseAdmin
      .from("profiles")
      .update({ points: currentPoints + 2 })
      .eq("id", customerId);
    if (pointsError) handleSupabaseError(pointsError, "Failed to update customer points");
    await supabaseAdmin.from("cart_items").delete().eq("user_id", customerId);

    return {
      order,
      items: (itemData ?? []) as OrderItem[]
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
      .select("*, order_items(*), stores(id,name,slug,owner_id,emoji)", { count: "exact" })
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
    if (actorRole === "admin" && query.store_id) request = request.eq("store_id", query.store_id);

    const { data, error, count } = await request;
    if (error) handleSupabaseError(error, "Failed to list orders");
    return {
      items: data ?? [],
      pagination: toPagination(query.page, query.limit, count ?? 0)
    };
  },

  async getOrder(actorId: string, actorRole: UserRole, orderId: string): Promise<unknown> {
    await assertOrderAccess(orderId, actorId, actorRole);
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
    if (actorRole === "customer" && body.status !== "cancelled") {
      throw new AppError("Customers can only cancel their own orders", HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN);
    }

    const shouldRewardSeller = order.status !== "completed" && body.status === "completed";
    const shouldPenalizeSellerCancellation = order.status !== "cancelled" && body.status === "cancelled" && actorRole !== "customer";

    const patch = {
      status: body.status,
      ...(body.payment_status ? { payment_status: body.payment_status } : {}),
      ...(body.status === "completed" ? { completed_at: new Date().toISOString() } : {}),
      ...(body.status === "cancelled" ? { cancelled_at: new Date().toISOString() } : {})
    };

    const { data, error } = await supabaseAdmin
      .from("orders")
      .update(patch)
      .eq("id", orderId)
      .select("*")
      .single();

    if (error) handleSupabaseError(error, "Failed to update order status");

    if (shouldPenalizeSellerCancellation) {
      await sellerReputationService.handleSellerCancellation(order.store_id, order.id);
    }

    if (shouldRewardSeller) {
      await sellerReputationService.handleOrderSuccess(order.store_id, body.is_charity_order);
    }

    await supabaseAdmin.from("notifications").insert({
      recipient_id: order.customer_id,
      role_target: "customer",
      type: "order-update",
      title: `Đơn ${order.order_number} đã cập nhật`,
      body: `Trạng thái: ${body.status}`,
      related_type: "order",
      related_id: order.id
    });

    return data as Order;
  },

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
  },

  async createComplaint(customerId: string, body: CreateComplaintBody): Promise<unknown> {
    const { data: order, error: orderError } = await supabaseAdmin
      .from("orders")
      .select("id,order_number,customer_id,store_id,stores!inner(owner_id)")
      .eq("id", body.order_id)
      .single();

    if (orderError) handleSupabaseError(orderError, "Failed to load order");
    const loadedOrder = requireRecord(order as { id: string; order_number: string; customer_id: string; store_id: string; stores: { owner_id: string } } | null, "Order was not found");
    if (loadedOrder.customer_id !== customerId) {
      throw new AppError("Only the order owner can submit a complaint", HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN);
    }

    const { data, error } = await supabaseAdmin
      .from("complaints")
      .insert({
        order_id: loadedOrder.id,
        customer_id: customerId,
        store_id: loadedOrder.store_id,
        product_names: body.product_names,
        issue: body.issue,
        priority: body.priority,
        status: "open",
        image_urls: body.image_urls
      })
      .select("*")
      .single();

    if (error) handleSupabaseError(error, "Failed to create complaint");

    await supabaseAdmin.from("notifications").insert({
      recipient_id: loadedOrder.stores.owner_id,
      role_target: "partner",
      type: "new-complaint",
      title: `Khiếu nại mới ${loadedOrder.order_number}`,
      body: body.issue.slice(0, 180),
      related_type: "complaint",
      related_id: (data as { id: string }).id
    });

    return data;
  },

  async listComplaints(actorId: string, actorRole: UserRole): Promise<unknown[]> {
    let request = supabaseAdmin
      .from("complaints")
      .select("*, orders(order_number), stores(id,name,owner_id)")
      .order("created_at", { ascending: false });

    if (actorRole === "customer") request = request.eq("customer_id", actorId);
    if (actorRole === "partner") {
      const storeIds = await getOwnedStoreIds(actorId);
      request = request.in("store_id", storeIds.length > 0 ? storeIds : ["00000000-0000-0000-0000-000000000000"]);
    }

    const { data, error } = await request;
    if (error) handleSupabaseError(error, "Failed to list complaints");
    return data ?? [];
  },

  async updateComplaint(actorId: string, actorRole: UserRole, complaintId: string, body: UpdateComplaintBody): Promise<unknown> {
    const { data: complaint, error: loadError } = await supabaseAdmin
      .from("complaints")
      .select("id,customer_id,store_id,stores!inner(owner_id)")
      .eq("id", complaintId)
      .single();

    if (loadError) handleSupabaseError(loadError, "Failed to load complaint");
    const loaded = requireRecord(complaint as { id: string; customer_id: string; stores: { owner_id: string } } | null, "Complaint was not found");

    if (actorRole !== "admin" && loaded.stores.owner_id !== actorId) {
      throw new AppError("Only the store owner can respond to this complaint", HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN);
    }

    const { data, error } = await supabaseAdmin
      .from("complaints")
      .update({
        status: body.status,
        resolution: body.resolution ?? null,
        resolved_at: body.status === "resolved" ? new Date().toISOString() : null
      })
      .eq("id", complaintId)
      .select("*")
      .single();

    if (error) handleSupabaseError(error, "Failed to update complaint");

    await supabaseAdmin.from("notifications").insert({
      recipient_id: loaded.customer_id,
      role_target: "customer",
      type: "complaint-update",
      title: "Khiếu nại của bạn đã được cập nhật",
      body: body.resolution ?? `Trạng thái: ${body.status}`,
      related_type: "complaint",
      related_id: complaintId
    });

    return data;
  }
};
