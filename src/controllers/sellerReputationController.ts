import type { Request, Response } from "express";
import { HTTP_STATUS } from "../constants/http";
import type {
  OrderSuccessBody,
  SellerCancellationBody,
  SellerRatingAverageBody
} from "../schemas/sellerReputationSchemas";
import { sellerReputationService } from "../services/sellerReputationService";
import { getActor } from "../utils/requestContext";
import { sendSuccess } from "../utils/response";

type UuidParams = { id: string };

export const sellerReputationController = {
  async getSellerReputation(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const params = req.validated?.params as UuidParams;
    const reputation = await sellerReputationService.getSellerReputationForActor(params.id, actor.userId, actor.role);
    sendSuccess(res, reputation);
  },

  async handleSellerCancellation(req: Request, res: Response): Promise<void> {
    const params = req.validated?.params as UuidParams;
    const body = req.validated?.body as SellerCancellationBody;
    const reputation = await sellerReputationService.handleSellerCancellation(params.id, body.order_id);
    sendSuccess(res, reputation, HTTP_STATUS.OK);
  },

  async handleOrderSuccess(req: Request, res: Response): Promise<void> {
    const params = req.validated?.params as UuidParams;
    const body = req.validated?.body as OrderSuccessBody;
    const reputation = await sellerReputationService.handleOrderSuccess(params.id, body.is_charity_order);
    sendSuccess(res, reputation, HTTP_STATUS.OK);
  },

  async updateSellerRatingAverage(req: Request, res: Response): Promise<void> {
    const params = req.validated?.params as UuidParams;
    const body = req.validated?.body as SellerRatingAverageBody;
    const reputation = await sellerReputationService.updateSellerRatingAverage(params.id, body.rating_avg);
    sendSuccess(res, reputation, HTTP_STATUS.OK);
  }
};
