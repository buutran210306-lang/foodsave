import { z } from "zod";

export const updateProfileBodySchema = z.object({
  full_name: z.string().trim().min(2).max(120).optional(),
  phone: z.string().trim().min(8).max(30).optional(),
  avatar_url: z.string().url().nullable().optional(),
  metadata: z.record(z.unknown()).optional()
}).strict();

export type UpdateProfileBody = z.infer<typeof updateProfileBodySchema>;
