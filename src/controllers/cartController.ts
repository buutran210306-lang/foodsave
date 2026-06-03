import type { Request, Response } from "express";
import { HTTP_STATUS } from "../constants/http";
import type { AddCartItemBody, UpdateCartItemBody } from "../schemas/cartSchemas";
import { cartService } from "../services/cartService";
import { getActor } from "../utils/requestContext";
import { sendSuccess } from "../utils/response";

type UuidParams = { id: string };

export const cartController = {
  async getCart(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const cart = await cartService.getCart(actor.userId);
    sendSuccess(res, cart);
  },

  async addItem(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const body = req.validated?.body as AddCartItemBody;
    const item = await cartService.addItem(actor.userId, body);
    sendSuccess(res, item, HTTP_STATUS.CREATED);
  },

  async updateItem(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const params = req.validated?.params as UuidParams;
    const body = req.validated?.body as UpdateCartItemBody;
    const item = await cartService.updateItem(actor.userId, params.id, body);
    sendSuccess(res, item);
  },

  async removeItem(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const params = req.validated?.params as UuidParams;
    await cartService.removeItem(actor.userId, params.id);
    sendSuccess(res, { deleted: true });
  },

  async clearCart(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    await cartService.clearCart(actor.userId);
    sendSuccess(res, { deleted: true });
  }
};
