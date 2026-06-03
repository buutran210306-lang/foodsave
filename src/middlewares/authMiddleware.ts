import type { NextFunction, Request, RequestHandler, Response } from "express";
import { supabaseAdmin, supabaseAuth } from "../config/supabase";
import { ERROR_CODES } from "../constants/errors";
import { HTTP_STATUS } from "../constants/http";
import type { Profile, UserRole } from "../types/domain";
import { AppError } from "../utils/appError";

const extractBearerToken = (authorizationHeader: string | undefined): string => {
  if (!authorizationHeader) {
    throw new AppError("Authorization bearer token is required", HTTP_STATUS.UNAUTHORIZED, ERROR_CODES.AUTH_MISSING_TOKEN);
  }

  const [scheme, token] = authorizationHeader.split(" ");
  if (scheme !== "Bearer" || !token) {
    throw new AppError("Authorization header must use Bearer token format", HTTP_STATUS.UNAUTHORIZED, ERROR_CODES.AUTH_INVALID_TOKEN);
  }

  return token;
};

export const authMiddleware: RequestHandler = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  try {
    const token = extractBearerToken(req.headers.authorization);
    const { data, error } = await supabaseAuth.auth.getUser(token);

    if (error || !data.user) {
      throw new AppError("Invalid or expired authentication token", HTTP_STATUS.UNAUTHORIZED, ERROR_CODES.AUTH_INVALID_TOKEN);
    }

    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("*")
      .eq("id", data.user.id)
      .single();

    if (profileError || !profile) {
      throw new AppError("Authenticated user profile was not found", HTTP_STATUS.UNAUTHORIZED, ERROR_CODES.AUTH_INVALID_TOKEN);
    }

    if ((profile as Profile).status === "suspended") {
      throw new AppError("This account has been suspended", HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN);
    }

    req.user = data.user;
    req.profile = profile as Profile;
    next();
  } catch (error) {
    next(error);
  }
};

export const requireRoles = (...allowedRoles: UserRole[]): RequestHandler => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.profile) {
      next(new AppError("Authentication is required", HTTP_STATUS.UNAUTHORIZED, ERROR_CODES.AUTH_MISSING_TOKEN));
      return;
    }

    if (!allowedRoles.includes(req.profile.role)) {
      next(new AppError("You do not have permission to perform this action", HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN));
      return;
    }

    next();
  };
};
