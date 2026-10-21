import type { Request, Response } from "express";
import { HTTP_STATUS } from "../constants/http";
import type { AcceptDonationBody, AssignTeamBody, PhotoReviewBody, AssignDistributionBody, AssignVolunteerBody, CreateDonationBody, CreateProductDonationBody, DonationListQuery, HandoverBody, ProofUploadBody, StoreResponseBody, SubmitProofBody, UpdateDonationStatusBody } from "../schemas/donationSchemas";
import { donationService } from "../services/donationService";
import { teamService } from "../services/teamService";
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

  async createProductDonation(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const body = req.validated?.body as CreateProductDonationBody;
    const donation = await donationService.createFromProduct(actor.userId, actor.role, body);
    sendSuccess(res, donation, HTTP_STATUS.CREATED);
  },

  async acceptDonation(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const params = req.validated?.params as UuidParams;
    const body = req.validated?.body as AcceptDonationBody;
    const donation = await donationService.acceptDonation(actor.userId, actor.role, params.id, body);
    sendSuccess(res, donation);
  },

  async storeRespond(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const params = req.validated?.params as UuidParams;
    const body = req.validated?.body as StoreResponseBody;
    sendSuccess(res, await donationService.storeRespond(actor.userId, actor.role, params.id, body));
  },

  async assignVolunteer(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const params = req.validated?.params as UuidParams;
    const body = req.validated?.body as AssignVolunteerBody;
    sendSuccess(res, await donationService.assignVolunteer(actor.userId, actor.role, params.id, body));
  },

  async assignTeam(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const params = req.validated?.params as UuidParams;
    const body = req.validated?.body as AssignTeamBody;
    sendSuccess(res, await teamService.assignTeam(actor.userId, actor.role, params.id, body));
  },

  async listPhotos(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const params = req.validated?.params as UuidParams;
    sendSuccess(res, { items: await teamService.listPhotos(actor.userId, actor.role, params.id) });
  },

  async reviewPhoto(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const params = req.validated?.params as UuidParams;
    const body = req.validated?.body as PhotoReviewBody;
    sendSuccess(res, await teamService.reviewPhoto(actor.userId, actor.role, params.id, body));
  },

  async getReport(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const params = req.validated?.params as UuidParams;
    sendSuccess(res, await teamService.getReport(actor.userId, actor.role, params.id));
  },

  async assignDistribution(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const params = req.validated?.params as UuidParams;
    const body = req.validated?.body as AssignDistributionBody;
    sendSuccess(res, await donationService.assignDistribution(actor.userId, actor.role, params.id, body));
  },

  async createProofUploadUrl(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const params = req.validated?.params as UuidParams;
    const body = req.validated?.body as ProofUploadBody;
    sendSuccess(res, await donationService.createProofUploadUrl(actor.userId, actor.role, params.id, body));
  },

  async submitProof(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const params = req.validated?.params as UuidParams;
    const body = req.validated?.body as SubmitProofBody;
    sendSuccess(res, await donationService.submitProof(actor.userId, actor.role, params.id, body));
  },

  async markPacked(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const params = req.validated?.params as UuidParams;
    sendSuccess(res, await donationService.markPacked(actor.userId, actor.role, params.id));
  },

  async confirmHandover(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const params = req.validated?.params as UuidParams;
    const body = req.validated?.body as HandoverBody;
    sendSuccess(res, await donationService.confirmHandover(actor.userId, actor.role, params.id, body));
  },

  async updateDonationStatus(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const params = req.validated?.params as UuidParams;
    const body = req.validated?.body as UpdateDonationStatusBody;
    const donation = await donationService.updateDonationStatus(actor.userId, actor.role, params.id, body);
    sendSuccess(res, donation);
  }
};
