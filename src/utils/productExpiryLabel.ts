import type { ProductLabel } from "../types/domain";

export const PRODUCT_EXPIRY_LABEL_THRESHOLDS = {
  redHours: 12,
  yellowHours: 24,
  greenReferenceDays: 5
} as const;

export const hoursUntilExpiry = (expiresAt: string | Date, now = new Date()): number => {
  const expiryTime = expiresAt instanceof Date ? expiresAt.getTime() : new Date(expiresAt).getTime();
  const nowTime = now.getTime();

  if (!Number.isFinite(expiryTime) || !Number.isFinite(nowTime)) return Number.POSITIVE_INFINITY;
  return Math.max(0, (expiryTime - nowTime) / 3_600_000);
};

export const deriveProductLabel = (expiresAt: string | Date, now = new Date()): ProductLabel => {
  const remainingHours = hoursUntilExpiry(expiresAt, now);

  if (remainingHours <= PRODUCT_EXPIRY_LABEL_THRESHOLDS.redHours) return "red";
  if (remainingHours <= PRODUCT_EXPIRY_LABEL_THRESHOLDS.yellowHours) return "yellow";
  return "green";
};
