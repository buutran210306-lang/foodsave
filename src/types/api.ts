import type { ErrorCode } from "../constants/errors";

export interface SuccessResponse<T> {
  success: true;
  data: T;
}

export interface ErrorResponse {
  success: false;
  error: {
    code: ErrorCode | string;
    message: string;
    details?: unknown;
  };
}

export interface PaginatedResponse<T> {
  items: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    has_next_page: boolean;
  };
}

export interface ValidatedRequestData {
  body?: unknown;
  query?: unknown;
  params?: unknown;
}
