import { z } from "zod";

export const paymentMethodSchema = z.enum(["momo", "zalopay", "vnpay", "card", "cash"]);
export const orderStatusSchema = z.enum(["pending", "confirmed", "ready", "completed", "cancelled"]);

export const createOrderBodySchema = z.object({
  items: z.array(z.object({
    product_id: z.string().uuid(),
    quantity: z.number().int().min(1).max(99)
  }).strict()).min(1).max(50).refine((items) => new Set(items.map((item) => item.product_id)).size === items.length, {
    message: "Each product can appear only once per order"
  }),
  pickup_slot_key: z.enum(["now", "2h", "tonight", "tomorrow"]),
  payment_method: paymentMethodSchema,
  voucher_code: z.string().trim().min(3).max(40).optional(),
  donation_cents: z.number().int().min(0).max(10000000).default(0),
  customer_note: z.string().trim().max(1000).optional()
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

export const createComplaintBodySchema = z.object({
  order_id: z.string().uuid(),
  product_names: z.array(z.string().trim().min(1).max(180)).min(1).max(50),
  issue: z.string().trim().min(10).max(5000),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
  image_urls: z.array(z.string().url()).max(8).default([])
}).strict();

export const updateComplaintBodySchema = z.object({
  status: z.enum(["open", "in_review", "resolved", "rejected"]),
  resolution: z.string().trim().min(3).max(3000).optional()
}).strict();

export type CreateOrderBody = z.infer<typeof createOrderBodySchema>;
export type OrderListQuery = z.infer<typeof orderListQuerySchema>;
export type UpdateOrderStatusBody = z.infer<typeof updateOrderStatusBodySchema>;
export type CreateReviewBody = z.infer<typeof createReviewBodySchema>;
export type CreateComplaintBody = z.infer<typeof createComplaintBodySchema>;
export type UpdateComplaintBody = z.infer<typeof updateComplaintBodySchema>;
