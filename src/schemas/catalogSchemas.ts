import { z } from "zod";

export const productLabelSchema = z.enum(["green", "yellow", "red"]);

export const productListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().min(1).max(120).optional(),
  category: z.string().trim().min(1).max(80).optional(),
  label: productLabelSchema.optional(),
  store_id: z.string().uuid().optional(),
  donation: z.coerce.boolean().optional(),
  min_price_cents: z.coerce.number().int().min(0).optional(),
  max_price_cents: z.coerce.number().int().min(0).optional(),
  sort: z.enum(["nearest", "urgent", "discount", "price_low", "price_high", "rating", "newest"]).default("newest")
}).strict().refine((value) => {
  if (value.min_price_cents === undefined || value.max_price_cents === undefined) return true;
  return value.min_price_cents <= value.max_price_cents;
}, {
  message: "min_price_cents must be less than or equal to max_price_cents",
  path: ["min_price_cents"]
});

export const storeListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().min(1).max(120).optional(),
  district: z.string().trim().min(1).max(80).optional(),
  verified: z.coerce.boolean().optional(),
  open: z.coerce.boolean().optional()
}).strict();

export const voucherListQuerySchema = z.object({
  store_id: z.string().uuid().optional(),
  code: z.string().trim().min(1).max(40).optional()
}).strict();

export const createStoreBodySchema = z.object({
  name: z.string().trim().min(2).max(160),
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(180),
  logo_url: z.string().url().nullable().optional(),
  emoji: z.string().trim().max(16).nullable().optional(),
  address: z.string().trim().min(4).max(240),
  district: z.string().trim().max(80).nullable().optional(),
  city: z.string().trim().min(2).max(80),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  opening_hours: z.string().trim().max(120).nullable().optional()
}).strict();

export const updateStoreBodySchema = createStoreBodySchema.partial().extend({
  is_open: z.boolean().optional(),
  status: z.enum(["active", "pending", "suspended"]).optional()
}).strict();

export const createProductBodySchema = z.object({
  store_id: z.string().uuid(),
  name: z.string().trim().min(2).max(180),
  description: z.string().trim().min(10).max(3000),
  image_url: z.string().url().nullable().optional(),
  emoji: z.string().trim().max(16).nullable().optional(),
  category: z.string().trim().min(2).max(80),
  price_cents: z.number().int().min(0),
  original_price_cents: z.number().int().min(0),
  label: productLabelSchema,
  expires_at: z.string().datetime(),
  stock_quantity: z.number().int().min(0),
  is_donation: z.boolean().default(false),
  is_active: z.boolean().default(true)
}).strict().refine((value) => value.original_price_cents >= value.price_cents, {
  message: "original_price_cents must be greater than or equal to price_cents",
  path: ["original_price_cents"]
});

export const updateProductBodySchema = createProductBodySchema.omit({ store_id: true }).partial().strict();

export const createVoucherBodySchema = z.object({
  store_id: z.string().uuid().nullable().optional(),
  code: z.string().trim().min(3).max(40).transform((value) => value.toUpperCase()),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().min(2).max(500),
  percent_off: z.number().int().min(1).max(100).nullable().optional(),
  fixed_discount_cents: z.number().int().min(1).nullable().optional(),
  min_order_cents: z.number().int().min(0).default(0),
  starts_at: z.string().datetime(),
  expires_at: z.string().datetime(),
  max_redemptions: z.number().int().min(1).nullable().optional(),
  is_active: z.boolean().default(true)
}).strict().refine((value) => Boolean(value.percent_off) !== Boolean(value.fixed_discount_cents), {
  message: "Exactly one of percent_off or fixed_discount_cents is required",
  path: ["percent_off"]
}).refine((value) => new Date(value.expires_at).getTime() > new Date(value.starts_at).getTime(), {
  message: "expires_at must be after starts_at",
  path: ["expires_at"]
});

export type ProductListQuery = z.infer<typeof productListQuerySchema>;
export type StoreListQuery = z.infer<typeof storeListQuerySchema>;
export type VoucherListQuery = z.infer<typeof voucherListQuerySchema>;
export type CreateStoreBody = z.infer<typeof createStoreBodySchema>;
export type UpdateStoreBody = z.infer<typeof updateStoreBodySchema>;
export type CreateProductBody = z.infer<typeof createProductBodySchema>;
export type UpdateProductBody = z.infer<typeof updateProductBodySchema>;
export type CreateVoucherBody = z.infer<typeof createVoucherBodySchema>;
