import type { Request, Response } from "express";
import { HTTP_STATUS } from "../constants/http";
import type {
  LoginBody,
  PasswordResetBody,
  RefreshTokenBody,
  RegisterCharityBody,
  RegisterCustomerBody,
  RegisterPartnerBody
} from "../schemas/authSchemas";
import { authService } from "../services/authService";
import { AppError } from "../utils/appError";
import { ERROR_CODES } from "../constants/errors";
import { getActor } from "../utils/requestContext";
import { sendSuccess } from "../utils/response";

const requestMeta = (req: Request): { ipAddress: string | null; userAgent: string | null } => ({
  ipAddress: req.ip ?? null,
  userAgent: req.get("user-agent") ?? null
});

const bearerToken = (req: Request): string => {
  const authorization = req.headers.authorization;
  const [scheme, token] = authorization ? authorization.split(" ") : ["", ""];

  if (scheme !== "Bearer" || !token) {
    throw new AppError("Authorization bearer token is required", HTTP_STATUS.UNAUTHORIZED, ERROR_CODES.AUTH_MISSING_TOKEN);
  }

  return token;
};

export const authController = {
  async registerCustomer(req: Request, res: Response): Promise<void> {
    const body = req.validated?.body as RegisterCustomerBody;
    const result = await authService.registerCustomer(body, requestMeta(req));
    sendSuccess(res, result, HTTP_STATUS.CREATED);
  },

  async registerPartner(req: Request, res: Response): Promise<void> {
    const body = req.validated?.body as RegisterPartnerBody;
    const result = await authService.registerPartner(body, requestMeta(req));
    sendSuccess(res, result, HTTP_STATUS.CREATED);
  },

  async registerCharity(req: Request, res: Response): Promise<void> {
    const body = req.validated?.body as RegisterCharityBody;
    const result = await authService.registerCharity(body, requestMeta(req));
    sendSuccess(res, result, HTTP_STATUS.CREATED);
  },

  async login(req: Request, res: Response): Promise<void> {
    const body = req.validated?.body as LoginBody;
    const result = await authService.login(body, requestMeta(req));
    sendSuccess(res, result);
  },

  async refresh(req: Request, res: Response): Promise<void> {
    const body = req.validated?.body as RefreshTokenBody;
    const result = await authService.refreshSession(body, requestMeta(req));
    sendSuccess(res, result);
  },

  async requestPasswordReset(req: Request, res: Response): Promise<void> {
    const body = req.validated?.body as PasswordResetBody;
    const result = await authService.requestPasswordReset(body, requestMeta(req));
    sendSuccess(res, result);
  },

  async logout(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const result = await authService.logout(bearerToken(req), actor.userId, actor.role, requestMeta(req));
    sendSuccess(res, result);
  }
};
