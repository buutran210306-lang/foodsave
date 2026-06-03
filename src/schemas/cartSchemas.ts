import { z } from "zod";

export const addCartItemBodySchema = z.object({
  product_id: z.string().uuid(),
  quantity: z.number().int().min(1).max(99)
}).strict();

export const updateCartItemBodySchema = z.object({
  quantity: z.number().int().min(1).max(99)
}).strict();

export type AddCartItemBody = z.infer<typeof addCartItemBodySchema>;
export type UpdateCartItemBody = z.infer<typeof updateCartItemBodySchema>;
