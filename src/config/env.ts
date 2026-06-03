import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  API_BASE_PATH: z.string().min(1).default("/api/v1"),
  PASSWORD_RESET_REDIRECT_URL: z.string().url().default("http://localhost:8080/reset-password"),
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  CORS_ORIGINS: z.string().min(1),
  SOCKET_CORS_ORIGINS: z.string().min(1).default("http://localhost:3000,http://localhost:5173,http://localhost:8081,http://10.0.2.2:8081"),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(120),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  DATABASE_HOST: z.string().min(1).default("localhost"),
  DATABASE_PORT: z.coerce.number().int().min(1).max(65535).default(5432),
  DATABASE_NAME: z.string().min(1).default("foodsave"),
  DATABASE_USER: z.string().min(1).default("postgres"),
  DATABASE_PASSWORD: z.string().min(1).default("foodsave_secure_local_password"),
  DATABASE_SSL: z
    .enum(["true", "false"])
    .default("false")
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
