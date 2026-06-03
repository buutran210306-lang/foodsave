import { Router } from "express";
import { notificationController } from "../controllers/notificationController";
import { validateRequest } from "../middlewares/validateRequest";
import { uuidParamSchema } from "../schemas/commonSchemas";
import { notificationListQuerySchema } from "../schemas/notificationSchemas";
import { asyncHandler } from "../utils/asyncHandler";

export const notificationRoutes = Router();

notificationRoutes.get("/", validateRequest({ query: notificationListQuerySchema }), asyncHandler(notificationController.listNotifications));
notificationRoutes.patch("/read-all", asyncHandler(notificationController.markAllRead));
notificationRoutes.patch("/:id/read", validateRequest({ params: uuidParamSchema }), asyncHandler(notificationController.markRead));
