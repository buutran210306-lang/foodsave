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
export type AcceptDonationBody = z.infer<typeof acceptDonationBodySchema>;
export type UpdateDonationStatusBody = z.infer<typeof updateDonationStatusBodySchema>;
