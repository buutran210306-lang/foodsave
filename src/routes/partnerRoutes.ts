import { Router } from "express";
import { z } from "zod";
import { partnerController } from "../controllers/partnerController";
import { requireRoles } from "../middlewares/authMiddleware";
import { validateRequest } from "../middlewares/validateRequest";
import { asyncHandler } from "../utils/asyncHandler";

const productImageUploadBodySchema = z.object({
  content_type: z.enum(["image/jpeg", "image/png", "image/webp"])
}).strict();

const updateProfileBodySchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  address: z.string().trim().min(5).max(300).optional(),
  district: z.string().trim().max(80).optional(),
  city: z.string().trim().max(80).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  business_type: z.enum(["bakery", "restaurant", "convenience", "supermarket", "other"]).optional(),
  bank_name: z.string().trim().min(2).max(80).optional(),
  bank_account_number: z.string().trim().regex(/^[0-9 ]{6,30}$/, "Số tài khoản chỉ gồm chữ số").optional(),
  bank_account_holder: z.string().trim().min(2).max(120).optional()
}).strict().refine((body) => Object.keys(body).length > 0, { message: "Không có thông tin nào để cập nhật" });

export const partnerRoutes = Router();

partnerRoutes.use(requireRoles("partner", "admin"));
partnerRoutes.get("/dashboard", asyncHandler(partnerController.getDashboard));
partnerRoutes.patch("/profile", requireRoles("partner"), validateRequest({ body: updateProfileBodySchema }), asyncHandler(partnerController.updateProfile));
partnerRoutes.get("/products", asyncHandler(partnerController.listProducts));
partnerRoutes.post("/product-images/upload-url", validateRequest({ body: productImageUploadBodySchema }), asyncHandler(partnerController.createProductImageUploadUrl));
