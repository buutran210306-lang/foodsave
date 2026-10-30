import { Router } from "express";
import { orderController } from "../controllers/orderController";
import { requireRoles } from "../middlewares/authMiddleware";
import { validateRequest } from "../middlewares/validateRequest";
import { uuidParamSchema } from "../schemas/commonSchemas";
import {
  cancelOrderBodySchema,
  chatMessageBodySchema,
  confirmPaymentBodySchema,
  createComplaintBodySchema,
  createMomoPaymentBodySchema,
  createOrderBodySchema,
  complaintListQuerySchema,
  complaintUploadBodySchema,
  createReviewBodySchema,
  respondComplaintBodySchema,
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
orderRoutes.get("/complaints/list", validateRequest({ query: complaintListQuerySchema }), asyncHandler(orderController.listComplaints));
orderRoutes.post("/complaints/upload-url", requireRoles("customer", "partner"), validateRequest({ body: complaintUploadBodySchema }), asyncHandler(orderController.complaintUploadUrl));
orderRoutes.post("/complaints/:id/respond", requireRoles("partner"), validateRequest({ params: uuidParamSchema, body: respondComplaintBodySchema }), asyncHandler(orderController.respondComplaint));
orderRoutes.post("/complaints", requireRoles("customer", "admin"), validateRequest({ body: createComplaintBodySchema }), asyncHandler(orderController.createComplaint));
orderRoutes.patch("/complaints/:id", requireRoles("partner", "admin"), validateRequest({ params: uuidParamSchema, body: updateComplaintBodySchema }), asyncHandler(orderController.updateComplaint));
orderRoutes.get("/chat/unread", requireRoles("customer", "partner"), asyncHandler(orderController.unreadMessages));
orderRoutes.post("/:id/cancel", requireRoles("customer"), validateRequest({ params: uuidParamSchema, body: cancelOrderBodySchema }), asyncHandler(orderController.cancelOrder));
orderRoutes.get("/:id/messages", requireRoles("customer", "partner", "admin"), validateRequest({ params: uuidParamSchema }), asyncHandler(orderController.listMessages));
orderRoutes.post("/:id/messages", requireRoles("customer", "partner"), validateRequest({ params: uuidParamSchema, body: chatMessageBodySchema }), asyncHandler(orderController.sendMessage));
orderRoutes.post("/:id/messages/read", requireRoles("customer", "partner"), validateRequest({ params: uuidParamSchema }), asyncHandler(orderController.markMessagesRead));
orderRoutes.post("/:id/confirm-payment", requireRoles("customer", "admin"), validateRequest({ params: uuidParamSchema, body: confirmPaymentBodySchema }), asyncHandler(orderController.confirmPayment));
orderRoutes.post("/:id/payments/momo/refresh", validateRequest({ params: uuidParamSchema }), asyncHandler(orderController.refreshMomoPayment));
orderRoutes.get("/:id/payments/momo/status", validateRequest({ params: uuidParamSchema }), asyncHandler(orderController.pollMomoPayment));
orderRoutes.get("/:id", validateRequest({ params: uuidParamSchema }), asyncHandler(orderController.getOrder));
orderRoutes.patch("/:id/status", validateRequest({ params: uuidParamSchema, body: updateOrderStatusBodySchema }), asyncHandler(orderController.updateOrderStatus));
orderRoutes.post("/reviews", requireRoles("customer", "admin"), validateRequest({ body: createReviewBodySchema }), asyncHandler(orderController.createReview));
