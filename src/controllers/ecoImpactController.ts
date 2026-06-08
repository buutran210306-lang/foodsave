import type { Request, Response } from "express";
import type {
  CharityEcoImpactQuery,
  EcoImpactLeaderboardQuery,
  EcoImpactSummaryQuery,
  PartnerEcoImpactQuery
} from "../schemas/ecoImpactSchemas";
import { ecoImpactService } from "../services/ecoImpactService";
import { getActor } from "../utils/requestContext";
import { sendSuccess } from "../utils/response";

export const ecoImpactController = {
  async getMyImpact(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const query = req.validated?.query as EcoImpactSummaryQuery;
    const summary = await ecoImpactService.getMyImpact(actor.userId, query);
    sendSuccess(res, summary);
  },

  async getPartnerImpact(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const query = req.validated?.query as PartnerEcoImpactQuery;
    const summary = await ecoImpactService.getPartnerImpact(actor.userId, actor.role, query);
    sendSuccess(res, summary);
  },

  async getCharityImpact(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const query = req.validated?.query as CharityEcoImpactQuery;
    const summary = await ecoImpactService.getCharityImpact(actor.userId, actor.role, query);
    sendSuccess(res, summary);
  },

  async getPlatformImpact(req: Request, res: Response): Promise<void> {
    const query = req.validated?.query as EcoImpactSummaryQuery;
    const summary = await ecoImpactService.getPlatformImpact(query);
    sendSuccess(res, summary);
  },

  async getLeaderboard(req: Request, res: Response): Promise<void> {
    const query = req.validated?.query as EcoImpactLeaderboardQuery;
    const leaderboard = await ecoImpactService.getLeaderboard(query);
    sendSuccess(res, leaderboard);
  }
};
