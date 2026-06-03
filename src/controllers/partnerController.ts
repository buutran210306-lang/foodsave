import type { Request, Response } from "express";
import { partnerService } from "../services/partnerService";
import { getActor } from "../utils/requestContext";
import { sendSuccess } from "../utils/response";

export const partnerController = {
  async getDashboard(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const dashboard = await partnerService.getDashboard(actor.userId);
    sendSuccess(res, dashboard);
  }
};
