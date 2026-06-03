import type { Request, Response } from "express";
import { HTTP_STATUS } from "../constants/http";
import type { AcceptDonationBody, CreateDonationBody, DonationListQuery, UpdateDonationStatusBody } from "../schemas/donationSchemas";
import { donationService } from "../services/donationService";
import { getActor } from "../utils/requestContext";
import { sendSuccess } from "../utils/response";

type UuidParams = { id: string };

export const donationController = {
  async listDonations(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const query = req.validated?.query as DonationListQuery;
    const donations = await donationService.listDonations(actor.userId, actor.role, query);
    sendSuccess(res, donations);
  },

  async createDonation(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const body = req.validated?.body as CreateDonationBody;
    const donation = await donationService.createDonation(actor.userId, actor.role, body);
    sendSuccess(res, donation, HTTP_STATUS.CREATED);
  },

  async acceptDonation(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const params = req.validated?.params as UuidParams;
    const body = req.validated?.body as AcceptDonationBody;
    const donation = await donationService.acceptDonation(actor.userId, actor.role, params.id, body);
    sendSuccess(res, donation);
  },

  async updateDonationStatus(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const params = req.validated?.params as UuidParams;
    const body = req.validated?.body as UpdateDonationStatusBody;
    const donation = await donationService.updateDonationStatus(actor.userId, actor.role, params.id, body);
    sendSuccess(res, donation);
  }
};
