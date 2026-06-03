import { z } from "zod";

export const createCharityProfileBodySchema = z.object({
  name: z.string().trim().min(2).max(180),
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(180),
  phone: z.string().trim().min(8).max(30),
  email: z.string().email(),
  address: z.string().trim().min(4).max(240),
  district: z.string().trim().max(80).nullable().optional(),
  city: z.string().trim().min(2).max(80),
  beneficiaries_count: z.number().int().min(0).default(0)
}).strict();

export const updateCharityProfileBodySchema = createCharityProfileBodySchema.partial().extend({
  is_open: z.boolean().optional(),
  status: z.enum(["active", "pending", "suspended"]).optional()
}).strict();

export const createVolunteerBodySchema = z.object({
  charity_id: z.string().uuid(),
  full_name: z.string().trim().min(2).max(140),
  phone: z.string().trim().min(8).max(30),
  email: z.string().email(),
  role: z.string().trim().min(2).max(80).default("Tình nguyện viên"),
  vehicle: z.string().trim().min(2).max(180),
  zones: z.array(z.string().trim().min(1).max(80)).min(1).max(20),
  schedule: z.string().trim().min(2).max(240),
  status: z.enum(["new", "active", "inactive"]).default("new")
}).strict();

export const updateVolunteerBodySchema = createVolunteerBodySchema.omit({ charity_id: true }).partial().strict();

export const createBeneficiaryGroupBodySchema = z.object({
  charity_id: z.string().uuid(),
  group_name: z.string().trim().min(2).max(180),
  people_count: z.number().int().min(0),
  meals: z.string().trim().min(1).max(120),
  dietary: z.string().trim().min(1).max(500),
  last_fed_at: z.string().datetime().nullable().optional()
}).strict();

export const createImpactReportBodySchema = z.object({
  charity_id: z.string().uuid(),
  month_start: z.string().datetime(),
  meals: z.number().int().min(0),
  kg_saved: z.number().min(0),
  co2_kg: z.number().min(0),
  partners_count: z.number().int().min(0),
  donors_count: z.number().int().min(0),
  beneficiaries_count: z.number().int().min(0),
  status: z.enum(["draft", "in_progress", "published"]).default("draft")
}).strict();

export const createGalleryItemBodySchema = z.object({
  charity_id: z.string().uuid(),
  donation_id: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(2).max(180),
  image_url: z.string().url().nullable().optional(),
  emoji: z.string().trim().max(16).nullable().optional(),
  occurred_on: z.string().datetime(),
  org_name: z.string().trim().min(2).max(180),
  is_public: z.boolean().default(true)
}).strict();

export const publicGalleryQuerySchema = z.object({
  charity_id: z.string().uuid().optional()
}).strict();

export type CreateCharityProfileBody = z.infer<typeof createCharityProfileBodySchema>;
export type UpdateCharityProfileBody = z.infer<typeof updateCharityProfileBodySchema>;
export type CreateVolunteerBody = z.infer<typeof createVolunteerBodySchema>;
export type UpdateVolunteerBody = z.infer<typeof updateVolunteerBodySchema>;
export type CreateBeneficiaryGroupBody = z.infer<typeof createBeneficiaryGroupBodySchema>;
export type CreateImpactReportBody = z.infer<typeof createImpactReportBodySchema>;
export type CreateGalleryItemBody = z.infer<typeof createGalleryItemBodySchema>;
export type PublicGalleryQuery = z.infer<typeof publicGalleryQuerySchema>;
