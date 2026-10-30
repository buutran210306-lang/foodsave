/**
 * Mã hóa số tài khoản nhận tiền: AES-256-GCM, khóa lấy từ biến môi trường PAYOUT_ENCRYPTION_KEY (không bao giờ nằm trong code/repo).
 * Định dạng lưu: v1:<iv base64>:<authTag base64>:<ciphertext base64>. Tiền tố "v1" cho phép đổi khóa/thuật toán sau này.
 * Đóng cửa an toàn: thiếu hoặc sai khóa thì từ chối mã hóa và giải mã (ném lỗi), không bao giờ lưu rõ.
 */
import crypto from "crypto";
import { env } from "../config/env";
import { ERROR_CODES } from "../constants/errors";
import { HTTP_STATUS } from "../constants/http";
import { AppError } from "./appError";

const loadKey = (override?: string): Buffer => {
  const raw = (override ?? env.PAYOUT_ENCRYPTION_KEY ?? "").trim();
  if (!raw) {
    throw new AppError("Chưa cấu hình PAYOUT_ENCRYPTION_KEY nên chưa thể lưu hoặc đọc số tài khoản nhận tiền", HTTP_STATUS.SERVICE_UNAVAILABLE, ERROR_CODES.PROVIDER_NOT_CONFIGURED);
  }
  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new AppError("PAYOUT_ENCRYPTION_KEY phải là 32 byte (base64 hoặc 64 ký tự hex)", HTTP_STATUS.SERVICE_UNAVAILABLE, ERROR_CODES.PROVIDER_NOT_CONFIGURED);
  }
  return key;
};

export const isPayoutKeyConfigured = (): boolean => {
  try { loadKey(); return true; } catch { return false; }
};

export const encryptAccountNumber = (plain: string, keyOverride?: string): string => {
  const key = loadKey(keyOverride);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `v1:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${encrypted.toString("base64")}`;
};

export const decryptAccountNumber = (stored: string, keyOverride?: string): string => {
  const [version, iv, tag, data] = stored.split(":");
  if (version !== "v1" || !iv || !tag || !data) {
    throw new AppError("Dữ liệu số tài khoản không đúng định dạng", HTTP_STATUS.INTERNAL_SERVER_ERROR, ERROR_CODES.INTERNAL_SERVER_ERROR);
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", loadKey(keyOverride), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  try {
    return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
  } catch {
    throw new AppError("Không giải mã được số tài khoản (sai khóa hoặc dữ liệu bị sửa)", HTTP_STATUS.INTERNAL_SERVER_ERROR, ERROR_CODES.INTERNAL_SERVER_ERROR);
  }
};

/** Chỉ giữ chữ số; không đủ 6-30 chữ số thì trả null */
export const normalizeAccountNumber = (value: string): string | null => {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length >= 6 && digits.length <= 30 ? digits : null;
};

export const last4Of = (digits: string): string => digits.slice(-4);

/** Che số tài khoản để hiển thị/lưu ở chỗ khác: chỉ còn 4 số cuối */
export const maskAccountNumber = (digits: string): string => `${"•".repeat(Math.max(0, digits.length - 4))}${last4Of(digits)}`;
