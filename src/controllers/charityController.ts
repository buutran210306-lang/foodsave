import type { Request, Response } from "express";
import { HTTP_STATUS } from "../constants/http";
import type {
  CreateBeneficiaryGroupBody,
  CreateCharityProfileBody,
  CreateGalleryItemBody,
  CreateImpactReportBody,
  CreateVolunteerBody,
  PublicGalleryQuery,
  UpdateCharityProfileBody,
  UpdateVolunteerBody
} from "../schemas/charitySchemas";
import { charityService } from "../services/charityService";
import { getActor } from "../utils/requestContext";
import { sendSuccess } from "../utils/response";

type UuidParams = { id: string };

export const charityController = {
  async listMyCharities(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const charities = await charityService.listMyCharities(actor.userId);
    sendSuccess(res, charities);
  },

  async createCharityProfile(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const body = req.validated?.body as CreateCharityProfileBody;
    const charity = await charityService.createCharityProfile(actor.userId, body);
    sendSuccess(res, charity, HTTP_STATUS.CREATED);
  },

  async updateCharityProfile(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const params = req.validated?.params as UuidParams;
    const body = req.validated?.body as UpdateCharityProfileBody;
    const charity = await charityService.updateCharityProfile(actor.userId, actor.role, params.id, body);
    sendSuccess(res, charity);
  },

  async listVolunteers(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const params = req.validated?.params as UuidParams;
    const volunteers = await charityService.listVolunteers(actor.userId, actor.role, params.id);
    sendSuccess(res, volunteers);
  },

  async createVolunteer(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const body = req.validated?.body as CreateVolunteerBody;
    const volunteer = await charityService.createVolunteer(actor.userId, actor.role, body);
    sendSuccess(res, volunteer, HTTP_STATUS.CREATED);
  },

  async updateVolunteer(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const params = req.validated?.params as UuidParams;
    const body = req.validated?.body as UpdateVolunteerBody;
    const volunteer = await charityService.updateVolunteer(actor.userId, actor.role, params.id, body);
    sendSuccess(res, volunteer);
  },

  async createBeneficiaryGroup(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const body = req.validated?.body as CreateBeneficiaryGroupBody;
    const group = await charityService.createBeneficiaryGroup(actor.userId, actor.role, body);
    sendSuccess(res, group, HTTP_STATUS.CREATED);
  },

  async listBeneficiaryGroups(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const params = req.validated?.params as UuidParams;
    const groups = await charityService.listBeneficiaryGroups(actor.userId, actor.role, params.id);
    sendSuccess(res, groups);
  },

  async createImpactReport(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const body = req.validated?.body as CreateImpactReportBody;
    const report = await charityService.createImpactReport(actor.userId, actor.role, body);
    sendSuccess(res, report, HTTP_STATUS.CREATED);
  },

  async listImpactReports(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const params = req.validated?.params as UuidParams;
    const reports = await charityService.listImpactReports(actor.userId, actor.role, params.id);
    sendSuccess(res, reports);
  },

  async createGalleryItem(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const body = req.validated?.body as CreateGalleryItemBody;
    const item = await charityService.createGalleryItem(actor.userId, actor.role, body);
    sendSuccess(res, item, HTTP_STATUS.CREATED);
  },

  async listPublicGalleryItems(req: Request, res: Response): Promise<void> {
    const query = req.validated?.query as PublicGalleryQuery;
    const items = await charityService.listGalleryItems(query.charity_id);
    sendSuccess(res, items);
  }
};
