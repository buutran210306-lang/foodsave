/**
 * Route ghép đơn (gắn tại /api/v1/matching):
 *   POST /needs               tạo nhu cầu
 *   GET  /needs               danh sách nhu cầu của tổ chức
 *   GET  /needs/:id/plans     tối đa 3 phương án ghép (chỉ đọc)
 *   POST /needs/:id/reserve   body { donationIds } giữ hàng theo phương án
 *   POST /needs/:id/cancel    hủy nhu cầu đang mở
 */
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireRoles } from "../middlewares/authMiddleware";
import { validateRequest } from "../middlewares/validateRequest";
import { uuidParamSchema } from "../schemas/commonSchemas";
import { MATCH_CATEGORY_CODES } from "../services/matchingCategories";
import { matchingService } from "../services/matchingService";
import { asyncHandler } from "../utils/asyncHandler";
import { getActor } from "../utils/requestContext";
import { sendSuccess } from "../utils/response";
import { HTTP_STATUS } from "../constants/http";

const createNeedSchema = z.object({
  charity_id: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(120),
  category_codes: z.array(z.enum(MATCH_CATEGORY_CODES)).min(1).max(MATCH_CATEGORY_CODES.length),
  quantity: z.number().int().min(1).max(5000),
  needed_by: z.string().datetime({ offset: true }),
  note: z.string().trim().max(500).optional(),
});

const reserveSchema = z.object({
  donationIds: z.array(z.string().uuid()).min(1).max(5),
});

export const matchingRoutes = Router();

// Đăng nhập (authMiddleware) đã được gắn ở routes/index.ts
matchingRoutes.use(requireRoles("charity", "admin"));

matchingRoutes.post(
  "/needs",
  validateRequest({ body: createNeedSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const actor = getActor(req);
    const body = createNeedSchema.parse(req.body);
    const need = await matchingService.createNeed(actor.userId, actor.role, body);
    sendSuccess(res, need, HTTP_STATUS.CREATED);
  }),
);

matchingRoutes.get(
  "/needs",
  asyncHandler(async (req: Request, res: Response) => {
    const actor = getActor(req);
    sendSuccess(res, await matchingService.listNeeds(actor.userId, actor.role));
  }),
);

matchingRoutes.get(
  "/needs/:id/plans",
  validateRequest({ params: uuidParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const actor = getActor(req);
    sendSuccess(res, await matchingService.proposeForNeed(String(req.params.id), actor.userId, actor.role));
  }),
);

matchingRoutes.post(
  "/needs/:id/reserve",
  validateRequest({ params: uuidParamSchema, body: reserveSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const actor = getActor(req);
    const body = reserveSchema.parse(req.body);
    sendSuccess(res, await matchingService.reservePlan(String(req.params.id), body.donationIds, actor.userId, actor.role));
  }),
);

matchingRoutes.post(
  "/needs/:id/cancel",
  validateRequest({ params: uuidParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const actor = getActor(req);
    await matchingService.cancelNeed(String(req.params.id), actor.userId, actor.role);
    sendSuccess(res, { cancelled: true });
  }),
);
