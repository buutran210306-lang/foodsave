import { Router } from "express";
import { donationController } from "../controllers/donationController";
import { requireRoles } from "../middlewares/authMiddleware";
import { validateRequest } from "../middlewares/validateRequest";
import { uuidParamSchema } from "../schemas/commonSchemas";
import { acceptDonationBodySchema, assignTeamBodySchema, photoReviewBodySchema, assignDistributionBodySchema, assignVolunteerBodySchema, createDonationBodySchema, createProductDonationBodySchema, donationListQuerySchema, handoverBodySchema, proofUploadBodySchema, storeResponseBodySchema, submitProofBodySchema, updateDonationStatusBodySchema } from "../schemas/donationSchemas";
import { asyncHandler } from "../utils/asyncHandler";

export const donationRoutes = Router();

donationRoutes.get("/", validateRequest({ query: donationListQuerySchema }), asyncHandler(donationController.listDonations));
donationRoutes.post("/", requireRoles("partner", "admin"), validateRequest({ body: createDonationBodySchema }), asyncHandler(donationController.createDonation));
donationRoutes.post("/from-product", requireRoles("partner", "admin"), validateRequest({ body: createProductDonationBodySchema }), asyncHandler(donationController.createProductDonation));
donationRoutes.patch("/:id/store-response", requireRoles("partner", "admin"), validateRequest({ params: uuidParamSchema, body: storeResponseBodySchema }), asyncHandler(donationController.storeRespond));
donationRoutes.put("/:id/team", requireRoles("charity", "admin"), validateRequest({ params: uuidParamSchema, body: assignTeamBodySchema }), asyncHandler(donationController.assignTeam));
donationRoutes.get("/:id/photos", requireRoles("charity", "partner", "admin"), validateRequest({ params: uuidParamSchema }), asyncHandler(donationController.listPhotos));
donationRoutes.get("/:id/report", requireRoles("charity", "partner", "admin"), validateRequest({ params: uuidParamSchema }), asyncHandler(donationController.getReport));
donationRoutes.patch("/photos/:id/review", requireRoles("charity", "admin"), validateRequest({ params: uuidParamSchema, body: photoReviewBodySchema }), asyncHandler(donationController.reviewPhoto));
donationRoutes.patch("/:id/distribution", requireRoles("charity", "admin"), validateRequest({ params: uuidParamSchema, body: assignDistributionBodySchema }), asyncHandler(donationController.assignDistribution));
donationRoutes.patch("/:id/assign-volunteer", requireRoles("charity", "admin"), validateRequest({ params: uuidParamSchema, body: assignVolunteerBodySchema }), asyncHandler(donationController.assignVolunteer));
donationRoutes.post("/:id/proof/upload-url", requireRoles("charity", "admin"), validateRequest({ params: uuidParamSchema, body: proofUploadBodySchema }), asyncHandler(donationController.createProofUploadUrl));
donationRoutes.patch("/:id/proof", requireRoles("charity", "admin"), validateRequest({ params: uuidParamSchema, body: submitProofBodySchema }), asyncHandler(donationController.submitProof));
donationRoutes.patch("/:id/packed", requireRoles("partner", "admin"), validateRequest({ params: uuidParamSchema }), asyncHandler(donationController.markPacked));
donationRoutes.patch("/:id/handover", requireRoles("partner", "admin"), validateRequest({ params: uuidParamSchema, body: handoverBodySchema }), asyncHandler(donationController.confirmHandover));
donationRoutes.patch("/:id/accept", requireRoles("charity", "admin"), validateRequest({ params: uuidParamSchema, body: acceptDonationBodySchema }), asyncHandler(donationController.acceptDonation));
donationRoutes.patch("/:id/status", requireRoles("partner", "charity", "admin"), validateRequest({ params: uuidParamSchema, body: updateDonationStatusBodySchema }), asyncHandler(donationController.updateDonationStatus));
