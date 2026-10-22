/**
 * Route ghép đơn. Đặt vào src/routes/ rồi gắn trong src/routes/index.ts:
 *   import { matchingRoutes } from "./matchingRoutes";
 *   apiRoutes.use("/matching", matchingRoutes);
 *
 * GET  /api/matching/needs/:id/plans     → tối đa 3 phương án (chỉ đọc)
 * POST /api/matching/needs/:id/reserve   → body { donationIds: string[] } giữ hàng theo phương án đã chọn
 */
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { authMiddleware, requireRoles } from "../middlewares/authMiddleware";
import { validateRequest } from "../middlewares/validateRequest";
import { uuidParamSchema } from "../schemas/commonSchemas";
import { matchingService } from "../services/matchingService";
import { asyncHandler } from "../utils/asyncHandler";
import { getActor } from "../utils/requestContext";
import { sendSuccess } from "../utils/response";

const reserveBodySchema = z.object({
  donationIds: z.array(z.string().uuid()).min(1).max(5),
});

export const matchingRoutes = Router();

matchingRoutes.use(authMiddleware);
matchingRoutes.use(requireRoles("charity", "admin"));

matchingRoutes.get(
  "/needs/:id/plans",
  validateRequest({ params: uuidParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const actor = getActor(req);
    const { result, storeNames } = await matchingService.proposeForNeed(String(req.params.id), actor.userId, actor.role);
    sendSuccess(res, {
      algorithmVersion: result.algorithmVersion,
      plans: result.plans.map((p) => ({
        rank: p.rank,
        coveredKg: p.coveredQty,
        requestedKg: p.requestedQty,
        shortfallKg: p.shortfall,
        stopCount: p.stopCount,
        estDistanceKm: Math.round(p.estDistanceM / 100) / 10,
        estMinutes: Math.round(p.estDurationS / 60),
        redLots: p.redLots,
        donationIds: p.lines.map((l) => l.offerId),
        stops: p.stops.map((s) => ({
          seq: s.seq,
          storeId: s.siteId,
          storeName: storeNames[s.siteId] ?? "",
          location: s.location,
          arriveAt: s.arriveAt,
          kg: p.lines.filter((l) => l.siteId === s.siteId).reduce((sum, l) => sum + l.qty, 0),
        })),
      })),
      dropped: result.candidates.dropped,
    });
  }),
);

matchingRoutes.post(
  "/needs/:id/reserve",
  validateRequest({ params: uuidParamSchema, body: reserveBodySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const actor = getActor(req);
    const body = reserveBodySchema.parse(req.body);
    await matchingService.reservePlan(String(req.params.id), body.donationIds, actor.userId, actor.role);
    sendSuccess(res, { reserved: body.donationIds.length });
  }),
);
