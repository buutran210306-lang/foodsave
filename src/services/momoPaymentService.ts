import crypto from "crypto";
import { ERROR_CODES } from "../constants/errors";
import { HTTP_STATUS } from "../constants/http";
import { env } from "../config/env";
import type { Order } from "../types/domain";
import { AppError } from "../utils/appError";
import { handleSupabaseError, supabaseAdmin } from "./supabaseService";

export interface MomoCreatePaymentResponse {
  partnerCode?: string;
  orderId?: string;
  requestId?: string;
  amount?: number;
  resultCode?: number;
  message?: string;
  payUrl?: string;
  deeplink?: string;
  qrCodeUrl?: string;
  responseTime?: number;
}

export interface MomoQueryPaymentResponse {
  partnerCode?: string;
  orderId?: string;
  requestId?: string;
  amount?: number;
  transId?: number;
  payType?: string;
  resultCode?: number;
  message?: string;
  responseTime?: number;
  paymentOption?: string;
}

const momoApiBase = env.MOMO_API_BASE_URL.replace(/\/+$/, "");

const sign = (rawSignature: string): string => {
  return crypto.createHmac("sha256", env.MOMO_SECRET_KEY).update(rawSignature).digest("hex");
};

const momoAmountFromOrder = (order: Order): number => {
  const amount = Math.round(order.total_cents / 100);
  if (amount < 1000) {
    throw new AppError("MoMo requires a minimum payment amount of 1,000 VND", HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
  }
  return amount;
};

const postMomo = async <T>(path: string, body: Record<string, unknown>): Promise<T> => {
  const response = await fetch(`${momoApiBase}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000)
  });

  const payload = await response.json().catch(() => null) as T | null;
  if (!response.ok || !payload) {
    throw new AppError("MoMo sandbox did not return a valid response", HTTP_STATUS.INTERNAL_SERVER_ERROR, ERROR_CODES.INTERNAL_SERVER_ERROR, {
      status: response.status
    });
  }
  return payload;
};

const markOrderPaid = async (orderId: string): Promise<Order> => {
  const { data, error } = await supabaseAdmin
    .from("orders")
    .update({
      payment_status: "paid"
    })
    .eq("id", orderId)
    .select("*")
    .single();

  if (error) handleSupabaseError(error, "Failed to mark MoMo order as paid");
  return data as Order;
};

const markOrderFailed = async (orderId: string): Promise<Order> => {
  const { data, error } = await supabaseAdmin
    .from("orders")
    .update({ payment_status: "failed" })
    .eq("id", orderId)
    .select("*")
    .single();

  if (error) handleSupabaseError(error, "Failed to mark MoMo order as failed");
  return data as Order;
};

export const momoPaymentService = {
  async createPayment(order: Order): Promise<MomoCreatePaymentResponse> {
    if (order.payment_method !== "momo") {
      throw new AppError("MoMo QR can only be created for MoMo orders", HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
    }

    const amount = momoAmountFromOrder(order);
    const requestType = "captureWallet";
    const requestId = `${order.order_number}-${Date.now()}`;
    const orderId = order.order_number;
    const orderInfo = `FoodSave ${order.order_number}`;
    const extraData = Buffer.from(JSON.stringify({ order_id: order.id, order_number: order.order_number })).toString("base64");
    const rawSignature = `accessKey=${env.MOMO_ACCESS_KEY}&amount=${amount}&extraData=${extraData}&ipnUrl=${env.MOMO_IPN_URL}&orderId=${orderId}&orderInfo=${orderInfo}&partnerCode=${env.MOMO_PARTNER_CODE}&redirectUrl=${env.MOMO_REDIRECT_URL}&requestId=${requestId}&requestType=${requestType}`;
    const signature = sign(rawSignature);

    const payload = await postMomo<MomoCreatePaymentResponse>("/create", {
      partnerCode: env.MOMO_PARTNER_CODE,
      partnerName: "FoodSave",
      storeId: "FoodSave",
      accessKey: env.MOMO_ACCESS_KEY,
      requestId,
      amount,
      orderId,
      orderInfo,
      redirectUrl: env.MOMO_REDIRECT_URL,
      ipnUrl: env.MOMO_IPN_URL,
      extraData,
      requestType,
      signature,
      lang: "vi"
    });

    if (payload.resultCode !== 0) {
      throw new AppError(payload.message || "MoMo QR creation failed", HTTP_STATUS.INTERNAL_SERVER_ERROR, ERROR_CODES.INTERNAL_SERVER_ERROR, payload);
    }

    return payload;
  },

  async queryPayment(order: Order): Promise<{ payment: MomoQueryPaymentResponse; order: Order }> {
    if (order.payment_method !== "momo") {
      throw new AppError("Payment polling is only available for MoMo orders", HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
    }

    const requestId = `${order.order_number}-query-${Date.now()}`;
    const rawSignature = `accessKey=${env.MOMO_ACCESS_KEY}&orderId=${order.order_number}&partnerCode=${env.MOMO_PARTNER_CODE}&requestId=${requestId}`;
    const payment = await postMomo<MomoQueryPaymentResponse>("/query", {
      partnerCode: env.MOMO_PARTNER_CODE,
      requestId,
      orderId: order.order_number,
      signature: sign(rawSignature),
      lang: "vi"
    });

    const syncedOrder = payment.resultCode === 0 ? await markOrderPaid(order.id) : order;
    return { payment, order: syncedOrder };
  },

  async applyMockWebhook(input: { order_id?: string; orderId?: string; resultCode: number }): Promise<Order> {
    let query = supabaseAdmin.from("orders").select("*");
    query = input.order_id ? query.eq("id", input.order_id) : query.eq("order_number", input.orderId ?? "");

    const { data, error } = await query.single();
    if (error) handleSupabaseError(error, "Failed to load MoMo order for webhook");
    const order = data as Order | null;
    if (!order) {
      throw new AppError("Order was not found", HTTP_STATUS.NOT_FOUND, ERROR_CODES.RESOURCE_NOT_FOUND);
    }

    if (input.resultCode === 0) return markOrderPaid(order.id);
    return markOrderFailed(order.id);
  }
};
