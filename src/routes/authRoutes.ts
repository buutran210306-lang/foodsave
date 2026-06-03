import { Router } from "express";
import { authController } from "../controllers/authController";
import { authMiddleware } from "../middlewares/authMiddleware";
import { validateRequest } from "../middlewares/validateRequest";
import {
  loginBodySchema,
  passwordResetBodySchema,
  refreshTokenBodySchema,
  registerCharityBodySchema,
  registerCustomerBodySchema,
  registerPartnerBodySchema
} from "../schemas/authSchemas";
import { asyncHandler } from "../utils/asyncHandler";

export const authRoutes = Router();

authRoutes.post(
  "/register/customer",
  validateRequest({ body: registerCustomerBodySchema }),
  asyncHandler(authController.registerCustomer)
);

authRoutes.post(
  "/register/partner",
  validateRequest({ body: registerPartnerBodySchema }),
  asyncHandler(authController.registerPartner)
);

authRoutes.post(
  "/register/charity",
  validateRequest({ body: registerCharityBodySchema }),
  asyncHandler(authController.registerCharity)
);

authRoutes.post(
  "/login",
  validateRequest({ body: loginBodySchema }),
  asyncHandler(authController.login)
);

authRoutes.post(
  "/refresh",
  validateRequest({ body: refreshTokenBodySchema }),
  asyncHandler(authController.refresh)
);

authRoutes.post(
  "/password-reset",
  validateRequest({ body: passwordResetBodySchema }),
  asyncHandler(authController.requestPasswordReset)
);

authRoutes.post(
  "/logout",
  authMiddleware,
  asyncHandler(authController.logout)
);
