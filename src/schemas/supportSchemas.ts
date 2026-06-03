import { z } from "zod";

export const createContactMessageBodySchema = z.object({
  full_name: z.string().trim().min(2).max(140),
  email: z.string().email(),
  phone: z.string().trim().min(8).max(30).optional(),
  subject: z.string().trim().min(2).max(180),
  message: z.string().trim().min(10).max(5000)
}).strict();

export const createApplicationBodySchema = z.object({
  type: z.enum(["partner", "charity"]),
  org_name: z.string().trim().min(2).max(180),
  contact_name: z.string().trim().min(2).max(140),
  email: z.string().email(),
  phone: z.string().trim().min(8).max(30),
  payload: z.record(z.unknown()).default({})
}).strict();

export type CreateContactMessageBody = z.infer<typeof createContactMessageBodySchema>;
export type CreateApplicationBody = z.infer<typeof createApplicationBodySchema>;
