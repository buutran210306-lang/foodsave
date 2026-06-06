import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const optionalNonEmptyString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().min(1).optional()
);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  API_BASE_PATH: z.string().min(1).default("/api/v1"),
  PASSWORD_RESET_REDIRECT_URL: z.string().url().default("http://localhost:8080/reset-password"),
  GOOGLE_OAUTH_REDIRECT_URL: optionalNonEmptyString,
  FACEBOOK_OAUTH_REDIRECT_URL: optionalNonEmptyString,
  GOOGLE_OTP_EXPIRES_SECONDS: z.coerce.number().int().min(60).max(1800).default(600),
  PHONE_OTP_EXPIRES_SECONDS: z.coerce.number().int().min(60).max(1800).default(600),
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  CORS_ORIGINS: z.string().min(1),
  SOCKET_CORS_ORIGINS: z.string().min(1).default("http://localhost:3000,http://localhost:5173,http://localhost:8081,http://10.0.2.2:8081"),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(120),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  MOMO_API_BASE_URL: z.string().url().default("https://test-payment.momo.vn/v2/gateway/api"),
  MOMO_PARTNER_CODE: z.string().min(1).default("MOMO"),
  MOMO_ACCESS_KEY: z.string().min(1).default("F8BBA842ECF85"),
  MOMO_SECRET_KEY: z.string().min(1).default("K951B6PE1waDMi640xX08PD3vg6EkVlz"),
  MOMO_REDIRECT_URL: z.string().url().default("http://localhost:8080/api/v1/orders/payments/momo/return"),
  MOMO_IPN_URL: z.string().url().default("http://localhost:8080/api/v1/orders/payments/momo/webhook/mock"),
  DATABASE_URL: optionalNonEmptyString,
  DATABASE_HOST: z.string().min(1).default("localhost"),
  DATABASE_PORT: z.coerce.number().int().min(1).max(65535).default(5432),
  DATABASE_NAME: z.string().min(1).default("foodsave"),
  DATABASE_USER: z.string().min(1).default("postgres"),
  DATABASE_PASSWORD: z.string().min(1).default("foodsave_secure_local_password"),
  DATABASE_SSL: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  DATABASE_SSL_REJECT_UNAUTHORIZED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true")
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  const message = parsedEnv.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
  throw new Error(`Invalid environment configuration: ${message}`);
}

export const env = {
  ...parsedEnv.data,
  CORS_ORIGINS: parsedEnv.data.CORS_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean),
  SOCKET_CORS_ORIGINS: parsedEnv.data.SOCKET_CORS_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean)
} as const;
