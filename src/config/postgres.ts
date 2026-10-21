import { Pool, type PoolConfig } from "pg";
import { logger } from "../utils/logger";
import { env } from "./env";

const sharedPoolConfig = {
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  ssl: env.DATABASE_SSL ? { rejectUnauthorized: env.DATABASE_SSL_REJECT_UNAUTHORIZED } : false
} satisfies PoolConfig;

const poolConfig: PoolConfig = env.DATABASE_URL
  ? {
      ...sharedPoolConfig,
      connectionString: env.DATABASE_URL
    }
  : {
      ...sharedPoolConfig,
      host: env.DATABASE_HOST,
      port: env.DATABASE_PORT,
      database: env.DATABASE_NAME,
      user: env.DATABASE_USER,
      password: env.DATABASE_PASSWORD
    };

export const postgresPool = new Pool(poolConfig);

// Kết nối lỗi ở client rảnh không được làm sập máy chủ
postgresPool.on("error", (error) => {
  logger.warn("Lỗi kết nối PostgreSQL (client rảnh)", error);
});

// Điểm uy tín cửa hàng dùng kết nối PostgreSQL trực tiếp (DATABASE_URL). Máy chưa cấu hình thì kết nối bị từ chối sau ~4.5 giây,
// làm chậm và làm hỏng cả luồng đơn hàng. Kiểm tra nhanh và nhớ kết quả: chưa có thì bỏ qua phần điểm uy tín.
let availability: { ok: boolean; at: number } | null = null;
export const isPostgresAvailable = async (): Promise<boolean> => {
  if (availability && Date.now() - availability.at < (availability.ok ? 300_000 : 120_000)) return availability.ok;
  try {
    await Promise.race([
      postgresPool.query("select 1"),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 1500))
    ]);
    availability = { ok: true, at: Date.now() };
  } catch (error) {
    availability = { ok: false, at: Date.now() };
    logger.warn("Không kết nối được PostgreSQL trực tiếp, bỏ qua tính điểm uy tín cửa hàng. Hãy đặt DATABASE_URL trong .env nếu cần.", error instanceof Error ? error.message : error);
  }
  return availability.ok;
};
