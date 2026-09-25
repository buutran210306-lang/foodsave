import { Router } from "express";
import { z } from "zod";
import { adminController } from "../controllers/adminController";
import { requireRoles } from "../middlewares/authMiddleware";
import { validateRequest } from "../middlewares/validateRequest";
import { asyncHandler } from "../utils/asyncHandler";

const adminUserParamSchema = z.object({
  userId: z.string().uuid()
}).strict();

const rejectPartnerBodySchema = z.object({
  reason: z.string().trim().min(1).max(1000)
}).strict();

export const adminRoutes = Router();

adminRoutes.use(requireRoles("admin"));

adminRoutes.get("/pending-partners", asyncHandler(adminController.getPendingPartners));

adminRoutes.post(
  "/approve/:userId",
  validateRequest({ params: adminUserParamSchema }),
  asyncHandler(adminController.approvePartner)
);

adminRoutes.post(
  "/reject/:userId",
  validateRequest({ params: adminUserParamSchema, body: rejectPartnerBodySchema }),
  asyncHandler(adminController.rejectPartner)
);
