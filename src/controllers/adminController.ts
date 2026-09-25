import type { Request, Response } from "express";
import { HTTP_STATUS } from "../constants/http";
import { adminService } from "../services/adminService";
import { sendSuccess } from "../utils/response";

type AdminUserParams = { userId: string };
type RejectPartnerBody = { reason: string };

export const adminController = {
  async getPendingPartners(_req: Request, res: Response): Promise<void> {
    const partners = await adminService.getPendingPartners();
    sendSuccess(res, partners);
  },

  async approvePartner(req: Request, res: Response): Promise<void> {
    const params = req.validated?.params as AdminUserParams;
    const result = await adminService.approvePartner(params.userId);
    sendSuccess(res, result, HTTP_STATUS.OK);
  },

  async rejectPartner(req: Request, res: Response): Promise<void> {
    const params = req.validated?.params as AdminUserParams;
    const body = req.validated?.body as RejectPartnerBody;
    const result = await adminService.rejectPartner(params.userId, body.reason);
    sendSuccess(res, result, HTTP_STATUS.OK);
  }
};
