import { env } from "../config/env";

type LogLevel = "debug" | "info" | "warn" | "error";

const levelRank: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

const shouldLog = (level: LogLevel): boolean => levelRank[level] >= levelRank[env.LOG_LEVEL];

export const logger = {
  debug(message: string, meta?: unknown): void {
    if (shouldLog("debug")) console.debug(message, meta ?? "");
  },
  info(message: string, meta?: unknown): void {
    if (shouldLog("info")) console.info(message, meta ?? "");
  },
  warn(message: string, meta?: unknown): void {
    if (shouldLog("warn")) console.warn(message, meta ?? "");
  },
  error(message: string, meta?: unknown): void {
    if (shouldLog("error")) console.error(message, meta ?? "");
  }
};
