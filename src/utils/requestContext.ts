import type { Request } from "express";
import { ERROR_CODES } from "../constants/errors";
import { HTTP_STATUS } from "../constants/http";
import type { Profile, UserRole } from "../types/domain";
import { AppError } from "./appError";

export interface ActorContext {
  userId: string;
  role: UserRole;
  profile: Profile;
}

export const getActor = (req: Request): ActorContext => {
  if (!req.user || !req.profile) {
    throw new AppError("Authentication is required", HTTP_STATUS.UNAUTHORIZED, ERROR_CODES.AUTH_MISSING_TOKEN);
  }

  return {
    userId: req.user.id,
    role: req.profile.role,
    profile: req.profile
  };
};
