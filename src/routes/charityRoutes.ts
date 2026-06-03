import { Router } from "express";
import { charityController } from "../controllers/charityController";
import { authMiddleware, requireRoles } from "../middlewares/authMiddleware";
import { validateRequest } from "../middlewares/validateRequest";
import {
  createBeneficiaryGroupBodySchema,
  createCharityProfileBodySchema,
  createGalleryItemBodySchema,
  createImpactReportBodySchema,
  createVolunteerBodySchema,
  publicGalleryQuerySchema,
  updateCharityProfileBodySchema,
  updateVolunteerBodySchema
} from "../schemas/charitySchemas";
import { uuidParamSchema } from "../schemas/commonSchemas";
import { asyncHandler } from "../utils/asyncHandler";

export const charityRoutes = Router();

charityRoutes.get("/gallery", validateRequest({ query: publicGalleryQuerySchema }), asyncHandler(charityController.listPublicGalleryItems));

charityRoutes.use(authMiddleware);
charityRoutes.use(requireRoles("charity", "admin"));
charityRoutes.get("/profiles", asyncHandler(charityController.listMyCharities));
charityRoutes.post("/profiles", validateRequest({ body: createCharityProfileBodySchema }), asyncHandler(charityController.createCharityProfile));
charityRoutes.patch("/profiles/:id", validateRequest({ params: uuidParamSchema, body: updateCharityProfileBodySchema }), asyncHandler(charityController.updateCharityProfile));
charityRoutes.get("/profiles/:id/volunteers", validateRequest({ params: uuidParamSchema }), asyncHandler(charityController.listVolunteers));
charityRoutes.post("/volunteers", validateRequest({ body: createVolunteerBodySchema }), asyncHandler(charityController.createVolunteer));
charityRoutes.patch("/volunteers/:id", validateRequest({ params: uuidParamSchema, body: updateVolunteerBodySchema }), asyncHandler(charityController.updateVolunteer));
charityRoutes.get("/profiles/:id/beneficiaries", validateRequest({ params: uuidParamSchema }), asyncHandler(charityController.listBeneficiaryGroups));
charityRoutes.post("/beneficiaries", validateRequest({ body: createBeneficiaryGroupBodySchema }), asyncHandler(charityController.createBeneficiaryGroup));
charityRoutes.get("/profiles/:id/reports", validateRequest({ params: uuidParamSchema }), asyncHandler(charityController.listImpactReports));
charityRoutes.post("/reports", validateRequest({ body: createImpactReportBodySchema }), asyncHandler(charityController.createImpactReport));
charityRoutes.post("/gallery", validateRequest({ body: createGalleryItemBodySchema }), asyncHandler(charityController.createGalleryItem));
