import { z } from "zod";

export const favoriteProductBodySchema = z.object({
  product_id: z.string().uuid()
}).strict();

export const favoriteStoreBodySchema = z.object({
  store_id: z.string().uuid()
}).strict();

export const recentViewBodySchema = z.object({
  product_id: z.string().uuid()
}).strict();

export type FavoriteProductBody = z.infer<typeof favoriteProductBodySchema>;
export type FavoriteStoreBody = z.infer<typeof favoriteStoreBodySchema>;
export type RecentViewBody = z.infer<typeof recentViewBodySchema>;
