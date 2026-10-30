import { Router } from "express";
import { catalogController } from "../controllers/catalogController";
import { authMiddleware, requireRoles } from "../middlewares/authMiddleware";
import { validateRequest } from "../middlewares/validateRequest";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import { policyConfigService } from "../services/policyConfigService";
import {
  COMPLAINT_STORE_RESPONSE_HOURS,
  COMPLAINT_WINDOW_COOKED_HOURS,
  COMPLAINT_WINDOW_OTHER_HOURS,
  CUSTOMER_REPUTATION,
  currentPolicy
} from "../constants/orderPolicy";
import { uuidParamSchema } from "../schemas/commonSchemas";
import {
  createProductBodySchema,
  createStoreBodySchema,
  createVoucherBodySchema,
  productListQuerySchema,
  storeListQuerySchema,
  updateProductBodySchema,
  updateStoreBodySchema,
  voucherListQuerySchema
} from "../schemas/catalogSchemas";

export const catalogRoutes = Router();

// Luật đơn hàng đang áp dụng (công khai, chỉ đọc): để app hiển thị đúng số phút/điểm mà không ghi cứng ở client
catalogRoutes.get("/policy", asyncHandler(async (_req, res) => {
  await policyConfigService.ensureFresh();
  const policy = currentPolicy();
  sendSuccess(res, {
    labels: {
      green: { pay_minutes: policy.labels.green.payMinutes, pickup_minutes: policy.labels.green.pickupMinutes, cancel_free_before_pickup_minutes: policy.labels.green.cancelFreeBeforePickupMinutes },
      yellow: { pay_minutes: policy.labels.yellow.payMinutes, pickup_minutes: policy.labels.yellow.pickupMinutes, cancel_free_before_pickup_minutes: policy.labels.yellow.cancelFreeBeforePickupMinutes },
      red: { pay_minutes: policy.labels.red.payMinutes, pickup_minutes: policy.labels.red.pickupMinutes, cancel_free_before_pickup_minutes: policy.labels.red.cancelFreeBeforePickupMinutes }
    },
    grace_cancel_minutes: policy.grace_cancel_minutes,
    no_show_ban_count: policy.no_show_ban_count,
    no_show_window_days: policy.no_show_window_days,
    red_ban_days: policy.red_ban_days,
    complaint: {
      window_hours_cooked: COMPLAINT_WINDOW_COOKED_HOURS,
      window_hours_other: COMPLAINT_WINDOW_OTHER_HOURS,
      store_response_hours: COMPLAINT_STORE_RESPONSE_HOURS
    },
    reputation: {
      initial: CUSTOMER_REPUTATION.initialScore,
      pickup_success: CUSTOMER_REPUTATION.pickupSuccessDelta,
      no_show: CUSTOMER_REPUTATION.noShowDelta,
      late_cancel: CUSTOMER_REPUTATION.lateCancelDelta,
      false_complaint: CUSTOMER_REPUTATION.falseComplaintDelta,
      blocked_below: CUSTOMER_REPUTATION.blockedBelow
    }
  });
}));
catalogRoutes.get("/products", validateRequest({ query: productListQuerySchema }), asyncHandler(catalogController.listProducts));
catalogRoutes.get("/products/:id", validateRequest({ params: uuidParamSchema }), asyncHandler(catalogController.getProduct));
catalogRoutes.get("/stores", validateRequest({ query: storeListQuerySchema }), asyncHandler(catalogController.listStores));
catalogRoutes.get("/stores/:id", validateRequest({ params: uuidParamSchema }), asyncHandler(catalogController.getStore));
catalogRoutes.get("/vouchers", validateRequest({ query: voucherListQuerySchema }), asyncHandler(catalogController.listVouchers));

catalogRoutes.post("/stores", authMiddleware, requireRoles("partner", "admin"), validateRequest({ body: createStoreBodySchema }), asyncHandler(catalogController.createStore));
catalogRoutes.patch("/stores/:id", authMiddleware, requireRoles("partner", "admin"), validateRequest({ params: uuidParamSchema, body: updateStoreBodySchema }), asyncHandler(catalogController.updateStore));
catalogRoutes.post("/products", authMiddleware, requireRoles("partner", "admin"), validateRequest({ body: createProductBodySchema }), asyncHandler(catalogController.createProduct));
catalogRoutes.patch("/products/:id", authMiddleware, requireRoles("partner", "admin"), validateRequest({ params: uuidParamSchema, body: updateProductBodySchema }), asyncHandler(catalogController.updateProduct));
catalogRoutes.delete("/products/:id", authMiddleware, requireRoles("partner", "admin"), validateRequest({ params: uuidParamSchema }), asyncHandler(catalogController.deleteProduct));
catalogRoutes.post("/vouchers", authMiddleware, requireRoles("partner", "admin"), validateRequest({ body: createVoucherBodySchema }), asyncHandler(catalogController.createVoucher));
