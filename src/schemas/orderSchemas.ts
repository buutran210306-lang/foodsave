import { z } from "zod";

// Đơn trả trước: không còn "cash" (trả khi nhận)
export const paymentMethodSchema = z.enum(["momo", "zalopay", "vnpay", "card", "vietqr"]);
export const orderStatusSchema = z.enum(["awaiting_payment", "pending", "confirmed", "ready", "completed", "cancelled", "no_show"]);

export const createOrderBodySchema = z.object({
  items: z.array(z.object({
    product_id: z.string().uuid(),
    quantity: z.number().int().min(1).max(99)
  }).strict()).min(1).max(50).refine((items) => new Set(items.map((item) => item.product_id)).size === items.length, {
    message: "Each product can appear only once per order"
  }),
  // Không còn chọn khung giờ: hạn lấy hàng do hệ thống tính theo nhãn. Giữ field tùy chọn để giao diện cũ không lỗi.
  pickup_slot_key: z.enum(["policy", "now", "2h", "tonight", "tomorrow"]).default("policy"),
  payment_method: paymentMethodSchema,
  voucher_code: z.string().trim().min(3).max(40).optional(),
  donation_cents: z.number().int().min(0).max(10000000).default(0),
  customer_note: z.string().trim().max(1000).optional(),
  receiver_name: z.string().trim().min(2).max(140).optional(),
  receiver_phone: z.string().trim().min(8).max(20).optional(),
  receiver_email: z.string().trim().email().max(200).optional()
}).strict();

export const confirmPaymentBodySchema = z.object({
  payment_method: paymentMethodSchema.optional()
}).strict();

export const cancelOrderBodySchema = z.object({
  reason: z.string().trim().max(300).optional()
}).strict();

export const chatMessageBodySchema = z.object({
  body: z.string().trim().min(1).max(500)
}).strict();

export const orderListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: orderStatusSchema.optional(),
  store_id: z.string().uuid().optional()
}).strict();

export const updateOrderStatusBodySchema = z.object({
  status: orderStatusSchema,
  payment_status: z.enum(["pending", "paid", "refunded", "failed"]).optional(),
  is_charity_order: z.boolean().default(false)
}).strict();

export const createReviewBodySchema = z.object({
  order_id: z.string().uuid(),
  product_id: z.string().uuid().optional(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().min(3).max(2000).optional(),
  photo_urls: z.array(z.string().url()).max(8).default([])
}).strict();

// Khiếu nại mới (Đợt 3): lý do + ít nhất 1 ảnh (ảnh tải lên qua POST /orders/complaints/upload-url)
export const createComplaintBodySchema = z.object({
  order_id: z.string().uuid(),
  reason_code: z.enum(["wrong_item", "spoiled_expired", "missing_items", "other"]),
  issue: z.string().trim().min(10).max(5000),
  image_urls: z.array(z.string().url()).min(1, "Cần ít nhất 1 ảnh minh chứng").max(8),
  product_names: z.array(z.string().trim().min(1).max(180)).min(1).max(50).optional()
}).strict();

export const respondComplaintBodySchema = z.object({
  action: z.enum(["accept", "dispute"]),
  note: z.string().trim().max(1000).optional(),
  image_urls: z.array(z.string().url()).max(8).optional()
}).strict();

export const complaintDecisionBodySchema = z.object({
  decision: z.enum(["refund_full", "refund_partial", "reject"]),
  refund_cents: z.number().int().min(1).max(1_000_000_000).optional(),
  is_false_claim: z.boolean().optional(),
  note: z.string().trim().min(3).max(1000)
}).strict();

export const complaintUploadBodySchema = z.object({
  content_type: z.enum(["image/jpeg", "image/png", "image/webp"])
}).strict();

export const complaintListQuerySchema = z.object({
  status: z.enum(["open", "in_review", "resolved", "rejected"]).optional()
}).strict();

export const updateComplaintBodySchema = z.object({
  status: z.enum(["open", "in_review", "resolved", "rejected"]),
  resolution: z.string().trim().min(3).max(3000).optional()
}).strict();

export const createMomoPaymentBodySchema = createOrderBodySchema.extend({
  payment_method: z.literal("momo")
});

export const momoWebhookMockBodySchema = z.object({
  order_id: z.string().uuid().optional(),
  orderId: z.string().trim().min(1).max(200).optional(),
  requestId: z.string().trim().max(200).optional(),
  resultCode: z.number().int().default(0),
  transId: z.union([z.string(), z.number()]).optional()
}).strict().refine((body) => Boolean(body.order_id || body.orderId), {
  message: "order_id or orderId is required"
});

export type CreateOrderBody = z.infer<typeof createOrderBodySchema>;
export type OrderListQuery = z.infer<typeof orderListQuerySchema>;
export type UpdateOrderStatusBody = z.infer<typeof updateOrderStatusBodySchema>;
export type ConfirmPaymentBody = z.infer<typeof confirmPaymentBodySchema>;
export type CreateReviewBody = z.infer<typeof createReviewBodySchema>;
export type ChatMessageBody = z.infer<typeof chatMessageBodySchema>;
export type CancelOrderBody = z.infer<typeof cancelOrderBodySchema>;
export type CreateComplaintBody = z.infer<typeof createComplaintBodySchema>;
export type RespondComplaintBody = z.infer<typeof respondComplaintBodySchema>;
export type ComplaintDecisionBody = z.infer<typeof complaintDecisionBodySchema>;
export type UpdateComplaintBody = z.infer<typeof updateComplaintBodySchema>;
export type CreateMomoPaymentBody = z.infer<typeof createMomoPaymentBodySchema>;
export type MomoWebhookMockBody = z.infer<typeof momoWebhookMockBodySchema>;
