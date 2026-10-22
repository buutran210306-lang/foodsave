import type { Request, Response } from "express";
import { partnerService, type PartnerProfileUpdate } from "../services/partnerService";
import { getActor } from "../utils/requestContext";
import { sendSuccess } from "../utils/response";

export const partnerController = {
  async getDashboard(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const dashboard = await partnerService.getDashboard(actor.userId);
    sendSuccess(res, dashboard);
  },

  async listProducts(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    sendSuccess(res, await partnerService.listOwnProducts(actor.userId));
  },

  async updateProfile(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    sendSuccess(res, await partnerService.updateOwnProfile(actor.userId, req.validated?.body as PartnerProfileUpdate));
  },

  async createProductImageUploadUrl(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const body = req.validated?.body as { content_type: string };
    sendSuccess(res, await partnerService.createProductImageUploadUrl(actor.userId, body.content_type));
  }
};
