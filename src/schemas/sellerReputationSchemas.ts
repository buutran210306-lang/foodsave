import { z } from "zod";

export const sellerCancellationBodySchema = z.object({
  order_id: z.string().uuid()
}).strict();

export const orderSuccessBodySchema = z.object({
  is_charity_order: z.boolean()
}).strict();

export const sellerRatingAverageBodySchema = z.object({
  rating_avg: z.number().min(0).max(5)
}).strict();

export type SellerCancellationBody = z.infer<typeof sellerCancellationBodySchema>;
export type OrderSuccessBody = z.infer<typeof orderSuccessBodySchema>;
export type SellerRatingAverageBody = z.infer<typeof sellerRatingAverageBodySchema>;
