import { z } from "zod";

export const uuidParamSchema = z.object({
  id: z.string().uuid()
}).strict();

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20)
}).strict();

export const optionalPaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional()
}).strict();

export const nonEmptyString = z.string().trim().min(1);
export const optionalTrimmedString = z.string().trim().optional();
