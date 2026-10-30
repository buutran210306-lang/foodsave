import { Router, type Request, type Response } from "express";
import { paymentWebhookService } from "../services/paymentWebhookService";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";

/**
 * Webhook của cổng thanh toán (KHÔNG đăng nhập; bảo vệ bằng chữ ký của nhà cung cấp, kiểm tra trong provider.verifyCallback).
 * Nhà cung cấp mô phỏng không có webhook nên endpoint trả 404.
 */
export const paymentRoutes = Router();

paymentRoutes.post(
  "/webhook/:provider",
  asyncHandler(async (req: Request, res: Response) => {
    const result = await paymentWebhookService.handle(String(req.params.provider), req.body, req.headers);
    sendSuccess(res, result);
  })
);
