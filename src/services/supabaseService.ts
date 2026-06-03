import type { PostgrestError } from "@supabase/supabase-js";
import { supabaseAdmin } from "../config/supabase";
import { ERROR_CODES } from "../constants/errors";
import { HTTP_STATUS } from "../constants/http";
import type { UserRole } from "../types/domain";
import { AppError } from "../utils/appError";

export { supabaseAdmin };

export interface PaginationInput {
  page: number;
  limit: number;
}

export const getRange = ({ page, limit }: PaginationInput): { from: number; to: number } => {
  const from = (page - 1) * limit;
  return {
    from,
    to: from + limit - 1
  };
};

export const toPagination = (page: number, limit: number, total: number) => ({
  page,
  limit,
  total,
  has_next_page: page * limit < total
});

export const handleSupabaseError = (error: PostgrestError, fallbackMessage = "Database operation failed"): never => {
  if (error.code === "PGRST116") {
    throw new AppError("Resource was not found", HTTP_STATUS.NOT_FOUND, ERROR_CODES.RESOURCE_NOT_FOUND);
  }

  if (error.code === "23505") {
    throw new AppError("Resource already exists", HTTP_STATUS.CONFLICT, ERROR_CODES.RESOURCE_CONFLICT);
  }

  throw new AppError(fallbackMessage, HTTP_STATUS.INTERNAL_SERVER_ERROR, ERROR_CODES.SUPABASE_ERROR, {
    code: error.code,
    hint: error.hint,
    details: error.details
  });
};

export const requireRecord = <T>(value: T | null | undefined, message = "Resource was not found"): T => {
  if (!value) {
    throw new AppError(message, HTTP_STATUS.NOT_FOUND, ERROR_CODES.RESOURCE_NOT_FOUND);
  }

  return value;
};

export const assertOwnerOrAdmin = (ownerId: string, actorId: string, actorRole: UserRole, message = "You do not have permission to access this resource"): void => {
  if (actorRole !== "admin" && ownerId !== actorId) {
    throw new AppError(message, HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN);
  }
};

export const generateCode = (prefix: string): string => {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `${prefix}-${timestamp}-${random}`;
};
