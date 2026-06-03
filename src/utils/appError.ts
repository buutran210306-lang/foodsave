import type { ErrorCode } from "../constants/errors";
import type { HttpStatus } from "../constants/http";
import { ERROR_CODES } from "../constants/errors";
import { HTTP_STATUS } from "../constants/http";

export class AppError extends Error {
  public readonly statusCode: HttpStatus;
  public readonly code: ErrorCode | string;
  public readonly details?: unknown;

  public constructor(message: string, statusCode: HttpStatus = HTTP_STATUS.INTERNAL_SERVER_ERROR, code: ErrorCode | string = ERROR_CODES.INTERNAL_SERVER_ERROR, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}
