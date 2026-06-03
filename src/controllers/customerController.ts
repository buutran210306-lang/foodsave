import type { Request, Response } from "express";
import { HTTP_STATUS } from "../constants/http";
import type { FavoriteProductBody, FavoriteStoreBody, RecentViewBody } from "../schemas/customerSchemas";
import { customerService } from "../services/customerService";
import { getActor } from "../utils/requestContext";
import { sendSuccess } from "../utils/response";

type UuidParams = { id: string };

export const customerController = {
  async listFavorites(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const favorites = await customerService.listFavorites(actor.userId);
    sendSuccess(res, favorites);
  },

  async addFavoriteProduct(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const body = req.validated?.body as FavoriteProductBody;
    const favorite = await customerService.addFavoriteProduct(actor.userId, body);
    sendSuccess(res, favorite, HTTP_STATUS.CREATED);
  },

  async removeFavoriteProduct(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const params = req.validated?.params as UuidParams;
    await customerService.removeFavoriteProduct(actor.userId, params.id);
    sendSuccess(res, { deleted: true });
  },

  async addFavoriteStore(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const body = req.validated?.body as FavoriteStoreBody;
    const favorite = await customerService.addFavoriteStore(actor.userId, body);
    sendSuccess(res, favorite, HTTP_STATUS.CREATED);
  },

  async removeFavoriteStore(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const params = req.validated?.params as UuidParams;
    await customerService.removeFavoriteStore(actor.userId, params.id);
    sendSuccess(res, { deleted: true });
  },

  async addRecentView(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const body = req.validated?.body as RecentViewBody;
    const view = await customerService.addRecentView(actor.userId, body);
    sendSuccess(res, view, HTTP_STATUS.CREATED);
  },

  async listRecentViews(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const views = await customerService.listRecentViews(actor.userId);
    sendSuccess(res, views);
  }
};
