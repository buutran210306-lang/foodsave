import type { Request, Response } from "express";
import type { UpdateProfileBody } from "../schemas/profileSchemas";
import { profileService } from "../services/profileService";
import { getActor } from "../utils/requestContext";
import { sendSuccess } from "../utils/response";

export const profileController = {
  async getMe(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const profile = await profileService.getProfile(actor.userId);
    sendSuccess(res, profile);
  },

  async updateMe(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const body = req.validated?.body as UpdateProfileBody;
    const profile = await profileService.updateProfile(actor.userId, body);
    sendSuccess(res, profile);
  }
};
