import { Router } from "express";
import { z } from "zod";
import { partnerController } from "../controllers/partnerController";
import { requireRoles } from "../middlewares/authMiddleware";
import { validateRequest } from "../middlewares/validateRequest";
import { asyncHandler } from "../utils/asyncHandler";

const productImageUploadBodySchema = z.object({
  content_type: z.enum(["image/jpeg", "image/png", "image/webp"])
}).strict();

export const partnerRoutes = Router();

partnerRoutes.use(requireRoles("partner", "admin"));
partnerRoutes.get("/dashboard", asyncHandler(partnerController.getDashboard));
partnerRoutes.get("/products", asyncHandler(partnerController.listProducts));
partnerRoutes.post("/product-images/upload-url", validateRequest({ body: productImageUploadBodySchema }), asyncHandler(partnerController.createProductImageUploadUrl));
