import { Router } from "express";
import { sellerReputationController } from "../controllers/sellerReputationController";
import { requireRoles } from "../middlewares/authMiddleware";
import { validateRequest } from "../middlewares/validateRequest";
import { uuidParamSchema } from "../schemas/commonSchemas";
import {
  orderSuccessBodySchema,
  sellerCancellationBodySchema,
  sellerRatingAverageBodySchema
} from "../schemas/sellerReputationSchemas";
import { asyncHandler } from "../utils/asyncHandler";

export const sellerReputationRoutes = Router();

sellerReputationRoutes.get(
  "/:id",
  requireRoles("partner", "admin"),
  validateRequest({ params: uuidParamSchema }),
  asyncHandler(sellerReputationController.getSellerReputation)
);

sellerReputationRoutes.post(
  "/:id/cancellations",
  requireRoles("admin"),
  validateRequest({ params: uuidParamSchema, body: sellerCancellationBodySchema }),
  asyncHandler(sellerReputationController.handleSellerCancellation)
);

sellerReputationRoutes.post(
  "/:id/order-success",
  requireRoles("admin"),
  validateRequest({ params: uuidParamSchema, body: orderSuccessBodySchema }),
  asyncHandler(sellerReputationController.handleOrderSuccess)
);

sellerReputationRoutes.patch(
  "/:id/rating-average",
  requireRoles("admin"),
  validateRequest({ params: uuidParamSchema, body: sellerRatingAverageBodySchema }),
  asyncHandler(sellerReputationController.updateSellerRatingAverage)
);
