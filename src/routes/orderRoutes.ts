import { Router } from "express";
import { orderController } from "../controllers/orderController";
import { requireRoles } from "../middlewares/authMiddleware";
import { validateRequest } from "../middlewares/validateRequest";
import { uuidParamSchema } from "../schemas/commonSchemas";
import {
  createComplaintBodySchema,
  createMomoPaymentBodySchema,
  createOrderBodySchema,
  createReviewBodySchema,
  momoWebhookMockBodySchema,
  orderListQuerySchema,
  updateComplaintBodySchema,
  updateOrderStatusBodySchema
} from "../schemas/orderSchemas";
import { asyncHandler } from "../utils/asyncHandler";

export const orderRoutes = Router();

orderRoutes.get("/", validateRequest({ query: orderListQuerySchema }), asyncHandler(orderController.listOrders));
orderRoutes.post("/", requireRoles("customer", "admin"), validateRequest({ body: createOrderBodySchema }), asyncHandler(orderController.createOrder));
orderRoutes.post("/payments/momo", requireRoles("customer", "admin"), validateRequest({ body: createMomoPaymentBodySchema }), asyncHandler(orderController.createMomoPayment));
orderRoutes.post("/payments/momo/webhook/mock", validateRequest({ body: momoWebhookMockBodySchema }), asyncHandler(orderController.mockMomoWebhook));
orderRoutes.get("/complaints/list", asyncHandler(orderController.listComplaints));
orderRoutes.post("/complaints", requireRoles("customer", "admin"), validateRequest({ body: createComplaintBodySchema }), asyncHandler(orderController.createComplaint));
orderRoutes.patch("/complaints/:id", requireRoles("partner", "admin"), validateRequest({ params: uuidParamSchema, body: updateComplaintBodySchema }), asyncHandler(orderController.updateComplaint));
orderRoutes.post("/:id/payments/momo/refresh", validateRequest({ params: uuidParamSchema }), asyncHandler(orderController.refreshMomoPayment));
orderRoutes.get("/:id/payments/momo/status", validateRequest({ params: uuidParamSchema }), asyncHandler(orderController.pollMomoPayment));
orderRoutes.get("/:id", validateRequest({ params: uuidParamSchema }), asyncHandler(orderController.getOrder));
orderRoutes.patch("/:id/status", validateRequest({ params: uuidParamSchema, body: updateOrderStatusBodySchema }), asyncHandler(orderController.updateOrderStatus));
orderRoutes.post("/reviews", requireRoles("customer", "admin"), validateRequest({ body: createReviewBodySchema }), asyncHandler(orderController.createReview));
