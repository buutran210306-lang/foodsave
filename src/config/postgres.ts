import { Pool, type PoolConfig } from "pg";
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
