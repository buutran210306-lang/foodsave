import { z } from "zod";

export const donationStatusSchema = z.enum(["open", "accepted", "in_route", "completed", "rejected", "cancelled"]);

export const donationListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: donationStatusSchema.optional(),
  urgency: z.enum(["green", "yellow", "red"]).optional(),
  store_id: z.string().uuid().optional(),
  charity_id: z.string().uuid().optional()
}).strict();

export const createDonationBodySchema = z.object({
  store_id: z.string().uuid(),
  items: z.string().trim().min(2).max(1000),
  amount_text: z.string().trim().min(1).max(120),
  weight_kg: z.number().positive().max(100000),
  expires_at: z.string().datetime(),
  pickup_start: z.string().trim().min(1).max(80),
  pickup_end: z.string().trim().min(1).max(80),
  urgency: z.enum(["green", "yellow", "red"]),
  note: z.string().trim().max(2000).optional(),
  distance_text: z.string().trim().max(60).optional()
}).strict();

export const createProductDonationBodySchema = z.object({
  store_id: z.string().uuid(),
  product_id: z.string().uuid(),
  quantity: z.number().int().min(1).max(100000),
  note: z.string().trim().max(2000).optional()
}).strict();

export const storeResponseBodySchema = z.object({
  accept: z.boolean()
}).strict();

export const assignVolunteerBodySchema = z.object({
  volunteer_id: z.string().uuid(),
  // Giao luôn giai đoạn phát cho một người (mặc định là cùng người lấy hàng)
  distribute_volunteer_id: z.string().uuid().optional(),
  portions: z.number().int().min(1).max(100000).optional()
}).strict();

const teamMemberSchema = z.object({
  volunteer_id: z.string().uuid(),
  share: z.number().int().min(1).max(100000)
}).strict();

const distinctMembers = (members: Array<{ volunteer_id: string }> | undefined): boolean => !members || new Set(members.map((member) => member.volunteer_id)).size === members.length;

// Đội TNV của một lô: mỗi người một phần (số sản phẩm khi lấy hàng, số suất khi phát hàng)
export const assignTeamBodySchema = z.object({
  pickup: z.array(teamMemberSchema).min(1).max(20).optional(),
  distribute: z.array(teamMemberSchema).min(1).max(20).optional()
}).strict().refine((body) => Boolean(body.pickup || body.distribute), { message: "Chọn ít nhất một người cho lấy hàng hoặc phát hàng" })
  .refine((body) => distinctMembers(body.pickup) && distinctMembers(body.distribute), { message: "Mỗi TNV chỉ xuất hiện một lần trong mỗi giai đoạn" });

export const photoReviewBodySchema = z.object({
  action: z.enum(["approve", "retake"]),
  note: z.string().trim().max(500).optional()
}).strict();

export const assignDistributionBodySchema = z.object({
  volunteer_id: z.string().uuid(),
  portions: z.number().int().min(1).max(100000)
}).strict();

export const handoverBodySchema = z.object({
  code: z.string().trim().min(4).max(20)
}).strict();

export const proofUploadBodySchema = z.object({
  content_type: z.enum(["image/jpeg", "image/png", "image/webp"])
}).strict();

export const submitProofBodySchema = z.object({
  photo_urls: z.array(z.string().url().max(600)).min(3).max(10),
  note: z.string().trim().max(1000).optional()
}).strict();

export const acceptDonationBodySchema = z.object({
  charity_id: z.string().uuid(),
  assigned_volunteer_id: z.string().uuid().optional()
}).strict();

export const updateDonationStatusBodySchema = z.object({
  status: donationStatusSchema,
  assigned_volunteer_id: z.string().uuid().nullable().optional(),
  note: z.string().trim().max(2000).optional()
}).strict();

export type DonationListQuery = z.infer<typeof donationListQuerySchema>;
export type CreateDonationBody = z.infer<typeof createDonationBodySchema>;
export type CreateProductDonationBody = z.infer<typeof createProductDonationBodySchema>;
export type StoreResponseBody = z.infer<typeof storeResponseBodySchema>;
export type AssignTeamBody = z.infer<typeof assignTeamBodySchema>;
export type PhotoReviewBody = z.infer<typeof photoReviewBodySchema>;
export type AssignDistributionBody = z.infer<typeof assignDistributionBodySchema>;
export type AssignVolunteerBody = z.infer<typeof assignVolunteerBodySchema>;
export type HandoverBody = z.infer<typeof handoverBodySchema>;
export type ProofUploadBody = z.infer<typeof proofUploadBodySchema>;
export type SubmitProofBody = z.infer<typeof submitProofBodySchema>;
export type AcceptDonationBody = z.infer<typeof acceptDonationBodySchema>;
export type UpdateDonationStatusBody = z.infer<typeof updateDonationStatusBodySchema>;
