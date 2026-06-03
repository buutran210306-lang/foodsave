import type { Request, Response } from "express";
import type { NotificationListQuery } from "../schemas/notificationSchemas";
import { notificationService } from "../services/notificationService";
import { getActor } from "../utils/requestContext";
import { sendSuccess } from "../utils/response";

type UuidParams = { id: string };

export const notificationController = {
  async listNotifications(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const query = req.validated?.query as NotificationListQuery;
    const notifications = await notificationService.listNotifications(actor.userId, actor.role, query);
    sendSuccess(res, notifications);
  },

  async markRead(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const params = req.validated?.params as UuidParams;
    const notification = await notificationService.markRead(actor.userId, actor.role, params.id);
    sendSuccess(res, notification);
  },

  async markAllRead(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    await notificationService.markAllRead(actor.userId, actor.role);
    sendSuccess(res, { updated: true });
  }
};
