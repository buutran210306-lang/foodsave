import { Router } from "express";
import { partnerController } from "../controllers/partnerController";
import { requireRoles } from "../middlewares/authMiddleware";
import { asyncHandler } from "../utils/asyncHandler";

export const partnerRoutes = Router();

partnerRoutes.use(requireRoles("partner", "admin"));
partnerRoutes.get("/dashboard", asyncHandler(partnerController.getDashboard));
