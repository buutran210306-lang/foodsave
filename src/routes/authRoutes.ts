import { Router } from "express";
import { authController } from "../controllers/authController";
import { authMiddleware } from "../middlewares/authMiddleware";
import { validateRequest } from "../middlewares/validateRequest";
import {
  facebookOAuthCallbackBodySchema,
  facebookOAuthStartBodySchema,
  googleOAuthStartBodySchema,
  googleOtpRequestBodySchema,
  googleOtpVerifyBodySchema,
  loginBodySchema,
  passwordResetBodySchema,
  phoneOtpRequestBodySchema,
  phoneOtpVerifyBodySchema,
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
  "/google/start",
  validateRequest({ body: googleOAuthStartBodySchema }),
  asyncHandler(authController.startGoogleOAuth)
);

authRoutes.post(
  "/google/otp",
  validateRequest({ body: googleOtpRequestBodySchema }),
  asyncHandler(authController.requestGoogleOtp)
);

authRoutes.post(
  "/google/verify",
  validateRequest({ body: googleOtpVerifyBodySchema }),
  asyncHandler(authController.verifyGoogleOtp)
);

authRoutes.post(
  "/facebook/start",
  validateRequest({ body: facebookOAuthStartBodySchema }),
  asyncHandler(authController.startFacebookOAuth)
);

authRoutes.post(
  "/facebook/callback",
  validateRequest({ body: facebookOAuthCallbackBodySchema }),
  asyncHandler(authController.completeFacebookOAuth)
);

authRoutes.post(
  "/phone/otp",
  validateRequest({ body: phoneOtpRequestBodySchema }),
  asyncHandler(authController.requestPhoneOtp)
);

authRoutes.post(
  "/phone/verify",
  validateRequest({ body: phoneOtpVerifyBodySchema }),
  asyncHandler(authController.verifyPhoneOtp)
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
