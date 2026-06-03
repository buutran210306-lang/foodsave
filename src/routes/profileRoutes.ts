import { Router } from "express";
import { profileController } from "../controllers/profileController";
import { asyncHandler } from "../utils/asyncHandler";
import { validateRequest } from "../middlewares/validateRequest";
import { updateProfileBodySchema } from "../schemas/profileSchemas";

export const profileRoutes = Router();

profileRoutes.get("/me", asyncHandler(profileController.getMe));
profileRoutes.patch("/me", validateRequest({ body: updateProfileBodySchema }), asyncHandler(profileController.updateMe));
