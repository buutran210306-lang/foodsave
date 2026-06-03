import { z } from "zod";

export const authRoleSchema = z.enum(["customer", "partner", "charity", "admin"]);

const passwordSchema = z.string()
  .min(8)
  .max(128)
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/[a-z]/, "Password must contain at least one lowercase letter")
  .regex(/[0-9]/, "Password must contain at least one number");

const emailSchema = z.string().trim().email().transform((value) => value.toLowerCase());
const phoneSchema = z.string().trim().min(8).max(32);
const shortTextSchema = z.string().trim().min(1).max(180);
const optionalShortTextSchema = z.string().trim().min(1).max(180).optional();
const addressSchema = z.string().trim().min(3).max(500);

export const loginBodySchema = z.object({
  identifier: z.string().trim().min(3).max(180),
  password: z.string().min(1).max(128),
  expected_role: authRoleSchema.optional()
}).strict();

export const refreshTokenBodySchema = z.object({
  refresh_token: z.string().trim().min(20)
}).strict();

export const passwordResetBodySchema = z.object({
  identifier: z.string().trim().min(3).max(180)
}).strict();

export const googleOAuthStartBodySchema = z.object({
  redirect_to: z.string().trim().url().optional()
}).strict();

export const facebookOAuthStartBodySchema = googleOAuthStartBodySchema;

export const facebookOAuthCallbackBodySchema = z.object({
  access_token: z.string().trim().min(20),
  refresh_token: z.string().trim().min(20),
  expires_at: z.number().int().positive().nullable().optional(),
  token_type: z.string().trim().min(1).default("bearer"),
  expected_role: authRoleSchema.optional()
}).strict();

export const googleOtpRequestBodySchema = z.object({
  access_token: z.string().trim().min(20),
  expected_role: authRoleSchema.optional()
}).strict();

export const googleOtpVerifyBodySchema = z.object({
  challenge_id: z.string().uuid(),
  otp: z.string().trim().regex(/^\d{6}$/, "OTP must contain 6 digits"),
  expected_role: authRoleSchema.optional()
}).strict();

export const phoneOtpRequestBodySchema = z.object({
  phone: phoneSchema,
  expected_role: authRoleSchema.optional()
}).strict();

export const phoneOtpVerifyBodySchema = z.object({
  phone: phoneSchema,
  otp: z.string().trim().regex(/^\d{6}$/, "OTP must contain 6 digits"),
  expected_role: authRoleSchema.optional()
}).strict();

export const registerCustomerBodySchema = z.object({
  full_name: shortTextSchema,
  email: emailSchema,
  phone: phoneSchema,
  password: passwordSchema,
  date_of_birth: z.string().trim().max(20).optional(),
  gender: z.string().trim().max(40).optional(),
  referral_code: z.string().trim().max(80).optional(),
  marketing_opt_in: z.boolean().default(false),
  terms_accepted: z.literal(true)
}).strict();

export const registerPartnerBodySchema = z.object({
  store_name: shortTextSchema,
  email: emailSchema,
  phone: phoneSchema,
  password: passwordSchema,
  address: addressSchema,
  district: optionalShortTextSchema,
  city: shortTextSchema.default("TP.HCM"),
  business_type: z.enum(["bakery", "restaurant", "convenience", "supermarket", "cafe", "other"]),
  representative_name: shortTextSchema,
  business_license_number: optionalShortTextSchema,
  tax_code: optionalShortTextSchema,
  bank_name: optionalShortTextSchema,
  bank_account_number: optionalShortTextSchema,
  bank_account_holder: optionalShortTextSchema,
  terms_accepted: z.literal(true)
}).strict();

export const registerCharityBodySchema = z.object({
  organization_name: shortTextSchema,
  email: emailSchema,
  phone: phoneSchema,
  password: passwordSchema,
  address: addressSchema,
  district: optionalShortTextSchema,
  city: shortTextSchema.default("TP.HCM"),
  organization_type: z.enum(["orphan", "kitchen", "shelter", "elderly", "disabled", "religious", "other"]),
  representative_name: shortTextSchema,
  representative_title: optionalShortTextSchema,
  beneficiaries_count: z.number().int().min(0).max(100000).default(0),
  meals_per_day: z.number().int().min(0).max(100000).default(0),
  volunteer_count: z.number().int().min(0).max(10000).default(0),
  service_radius_km: z.number().min(0).max(1000).default(5),
  terms_accepted: z.literal(true)
}).strict();

export type LoginBody = z.infer<typeof loginBodySchema>;
export type RefreshTokenBody = z.infer<typeof refreshTokenBodySchema>;
export type PasswordResetBody = z.infer<typeof passwordResetBodySchema>;
export type GoogleOAuthStartBody = z.infer<typeof googleOAuthStartBodySchema>;
export type GoogleOtpRequestBody = z.infer<typeof googleOtpRequestBodySchema>;
export type GoogleOtpVerifyBody = z.infer<typeof googleOtpVerifyBodySchema>;
export type FacebookOAuthStartBody = z.infer<typeof facebookOAuthStartBodySchema>;
export type FacebookOAuthCallbackBody = z.infer<typeof facebookOAuthCallbackBodySchema>;
export type PhoneOtpRequestBody = z.infer<typeof phoneOtpRequestBodySchema>;
export type PhoneOtpVerifyBody = z.infer<typeof phoneOtpVerifyBodySchema>;
export type RegisterCustomerBody = z.infer<typeof registerCustomerBodySchema>;
export type RegisterPartnerBody = z.infer<typeof registerPartnerBodySchema>;
export type RegisterCharityBody = z.infer<typeof registerCharityBodySchema>;
