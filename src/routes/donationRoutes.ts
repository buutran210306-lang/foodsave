import { Router } from "express";
import { donationController } from "../controllers/donationController";
import { requireRoles } from "../middlewares/authMiddleware";
import { validateRequest } from "../middlewares/validateRequest";
import { uuidParamSchema } from "../schemas/commonSchemas";
import { acceptDonationBodySchema, createDonationBodySchema, donationListQuerySchema, updateDonationStatusBodySchema } from "../schemas/donationSchemas";
import { asyncHandler } from "../utils/asyncHandler";

export const donationRoutes = Router();

donationRoutes.get("/", validateRequest({ query: donationListQuerySchema }), asyncHandler(donationController.listDonations));
donationRoutes.post("/", requireRoles("partner", "admin"), validateRequest({ body: createDonationBodySchema }), asyncHandler(donationController.createDonation));
donationRoutes.patch("/:id/accept", requireRoles("charity", "admin"), validateRequest({ params: uuidParamSchema, body: acceptDonationBodySchema }), asyncHandler(donationController.acceptDonation));
donationRoutes.patch("/:id/status", requireRoles("partner", "charity", "admin"), validateRequest({ params: uuidParamSchema, body: updateDonationStatusBodySchema }), asyncHandler(donationController.updateDonationStatus));
