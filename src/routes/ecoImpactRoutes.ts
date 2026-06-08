import { Router } from "express";
import { ecoImpactController } from "../controllers/ecoImpactController";
import { requireRoles } from "../middlewares/authMiddleware";
import { validateRequest } from "../middlewares/validateRequest";
import {
  charityEcoImpactQuerySchema,
  ecoImpactLeaderboardQuerySchema,
  ecoImpactSummaryQuerySchema,
  partnerEcoImpactQuerySchema
} from "../schemas/ecoImpactSchemas";
import { asyncHandler } from "../utils/asyncHandler";

export const ecoImpactRoutes = Router();

ecoImpactRoutes.get("/me", validateRequest({ query: ecoImpactSummaryQuerySchema }), asyncHandler(ecoImpactController.getMyImpact));
ecoImpactRoutes.get("/partner", requireRoles("partner", "admin"), validateRequest({ query: partnerEcoImpactQuerySchema }), asyncHandler(ecoImpactController.getPartnerImpact));
ecoImpactRoutes.get("/charity", requireRoles("charity", "admin"), validateRequest({ query: charityEcoImpactQuerySchema }), asyncHandler(ecoImpactController.getCharityImpact));
ecoImpactRoutes.get("/platform", requireRoles("admin"), validateRequest({ query: ecoImpactSummaryQuerySchema }), asyncHandler(ecoImpactController.getPlatformImpact));
ecoImpactRoutes.get("/leaderboard", validateRequest({ query: ecoImpactLeaderboardQuerySchema }), asyncHandler(ecoImpactController.getLeaderboard));
