import { z } from "zod";

export const ecoImpactSourceTypeSchema = z.enum(["order", "donation", "manual_adjustment"]);
export const ecoImpactPeriodSchema = z.enum(["month", "year", "all"]).default("month");

const dateRangeIsValid = (value: { date_from?: string; date_to?: string }): boolean => {
  if (!value.date_from || !value.date_to) return true;
  return new Date(value.date_from).getTime() <= new Date(value.date_to).getTime();
};

const dateRangeRefine = {
  message: "date_from must be before or equal to date_to",
  path: ["date_from"]
};

const ecoImpactSummaryQueryBaseSchema = z.object({
  period: ecoImpactPeriodSchema,
  months: z.coerce.number().int().min(1).max(24).default(6),
  date_from: z.string().datetime().optional(),
  date_to: z.string().datetime().optional()
}).strict();

export const ecoImpactSummaryQuerySchema = ecoImpactSummaryQueryBaseSchema.refine(dateRangeIsValid, dateRangeRefine);

export const partnerEcoImpactQuerySchema = ecoImpactSummaryQueryBaseSchema.extend({
  store_id: z.string().uuid().optional()
}).strict().refine(dateRangeIsValid, dateRangeRefine);

export const charityEcoImpactQuerySchema = ecoImpactSummaryQueryBaseSchema.extend({
  charity_id: z.string().uuid().optional()
}).strict().refine(dateRangeIsValid, dateRangeRefine);

export const ecoImpactLeaderboardQuerySchema = z.object({
  period: z.enum(["week", "month", "all"]).default("month"),
  limit: z.coerce.number().int().min(1).max(50).default(10)
}).strict();

export type EcoImpactSourceType = z.infer<typeof ecoImpactSourceTypeSchema>;
export type EcoImpactSummaryQuery = z.infer<typeof ecoImpactSummaryQuerySchema>;
export type PartnerEcoImpactQuery = z.infer<typeof partnerEcoImpactQuerySchema>;
export type CharityEcoImpactQuery = z.infer<typeof charityEcoImpactQuerySchema>;
export type EcoImpactLeaderboardQuery = z.infer<typeof ecoImpactLeaderboardQuerySchema>;
