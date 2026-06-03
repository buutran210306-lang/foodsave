import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { ERROR_CODES } from "../constants/errors";
import { HTTP_STATUS } from "../constants/http";
import { env } from "../config/env";
import { AppError } from "../utils/appError";
import { logger } from "../utils/logger";

const formatZodIssues = (error: ZodError): Array<{ path: string; message: string }> => {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message
  }));
};

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof AppError) {
    if (error.statusCode >= HTTP_STATUS.INTERNAL_SERVER_ERROR) {
      logger.error(error.message, error.details);
    }

    res.status(error.statusCode).json({
      success: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error.details !== undefined && env.NODE_ENV !== "production" ? { details: error.details } : {})
      }
    });
    return;
  }

  if (error instanceof ZodError) {
    res.status(HTTP_STATUS.UNPROCESSABLE_ENTITY).json({
      success: false,
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: "Request validation failed",
        details: formatZodIssues(error)
      }
    });
    return;
  }

  logger.error("Unhandled server error", error);

  res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
    success: false,
    error: {
      code: ERROR_CODES.INTERNAL_SERVER_ERROR,
      message: env.NODE_ENV === "production" ? "Internal server error" : error instanceof Error ? error.message : "Internal server error"
    }
  });
};
