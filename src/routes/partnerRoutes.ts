import { Router } from "express";
import { z } from "zod";
import { partnerController } from "../controllers/partnerController";
import { requireRoles } from "../middlewares/authMiddleware";
import { validateRequest } from "../middlewares/validateRequest";
import { asyncHandler } from "../utils/asyncHandler";
import { uuidParamSchema } from "../schemas/commonSchemas";
import { voucherBodySchema } from "./adminRoutes";

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
  // Thông tin ngân hàng KHÔNG còn sửa qua đây: dùng POST /partner/payout-account (số tài khoản được mã hóa và chờ admin xác minh)
}).strict().refine((body) => Object.keys(body).length > 0, { message: "Không có thông tin nào để cập nhật" });

// Lệnh rút chỉ gửi số tiền: tài khoản nhận là tài khoản đã được admin xác minh của cửa hàng
const createWithdrawalBodySchema = z.object({
  amount_cents: z.number().int().min(50000).max(1_000_000_000)
}).strict();

// Số tài khoản đầy đủ chỉ đi qua endpoint này (HTTPS), được mã hóa ngay ở backend và không bao giờ trả lại
const payoutAccountBodySchema = z.object({
  bank_name: z.string().trim().min(2).max(80),
  account_holder_name: z.string().trim().min(2).max(120),
  account_number: z.string().trim().regex(/^[0-9 ]{6,30}$/, "Số tài khoản chỉ gồm chữ số, từ 6 đến 30 số")
}).strict();

export const partnerRoutes = Router();

partnerRoutes.use(requireRoles("partner", "admin"));
partnerRoutes.get("/dashboard", asyncHandler(partnerController.getDashboard));
partnerRoutes.patch("/profile", requireRoles("partner"), validateRequest({ body: updateProfileBodySchema }), asyncHandler(partnerController.updateProfile));
partnerRoutes.get("/products", asyncHandler(partnerController.listProducts));
partnerRoutes.post("/product-images/upload-url", validateRequest({ body: productImageUploadBodySchema }), asyncHandler(partnerController.createProductImageUploadUrl));

partnerRoutes.get("/payout-account", requireRoles("partner"), asyncHandler(partnerController.getPayoutAccount));
partnerRoutes.post("/payout-account", requireRoles("partner"), validateRequest({ body: payoutAccountBodySchema }), asyncHandler(partnerController.submitPayoutAccount));
partnerRoutes.get("/customers", requireRoles("partner"), asyncHandler(partnerController.listCustomers));
partnerRoutes.get("/vouchers", requireRoles("partner"), asyncHandler(partnerController.listVouchers));
partnerRoutes.post("/vouchers", requireRoles("partner"), validateRequest({ body: voucherBodySchema }), asyncHandler(partnerController.createVoucher));
partnerRoutes.patch("/vouchers/:id", requireRoles("partner"), validateRequest({ params: uuidParamSchema, body: z.object({ is_active: z.boolean() }).strict() }), asyncHandler(partnerController.toggleVoucher));
partnerRoutes.get("/wallet", requireRoles("partner"), asyncHandler(partnerController.getWallet));
partnerRoutes.get("/withdrawals", requireRoles("partner"), asyncHandler(partnerController.listWithdrawals));
partnerRoutes.post("/withdrawals", requireRoles("partner"), validateRequest({ body: createWithdrawalBodySchema }), asyncHandler(partnerController.createWithdrawal));
