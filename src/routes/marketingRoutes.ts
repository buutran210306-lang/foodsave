import { Router } from "express";
import { z } from "zod";
import { authMiddleware, requireRoles } from "../middlewares/authMiddleware";
import { validateRequest } from "../middlewares/validateRequest";
import { uuidParamSchema } from "../schemas/commonSchemas";
import { marketingService } from "../services/marketingService";
import { asyncHandler } from "../utils/asyncHandler";
import { getActor } from "../utils/requestContext";
import { sendSuccess } from "../utils/response";

const channelEnum = z.enum(["buyers", "facebook", "instagram", "tiktok", "zalo"]);

const promoteBodySchema = z.object({
  channels: z.array(channelEnum).min(1).max(5),
  facebook_text: z.string().trim().min(10).max(5000).optional()
}).strict();

const settingsBodySchema = z.object({
  marketing_auto: z.boolean().optional(),
  facebook_page_id: z.string().trim().max(60).optional(),
  facebook_page_name: z.string().trim().max(160).optional(),
  channels: z.record(channelEnum, z.object({
    enabled: z.boolean().optional(),
    info: z.record(z.string().max(40), z.string().trim().max(200)).optional()
  }).strict()).optional()
}).strict();

// n8n báo kết quả đăng về FoodSave (bài của cửa hàng và bài tổng hợp)
const callbackBodySchema = z.object({
  post_log_id: z.string().uuid(),
  status: z.enum(["posted", "failed"]),
  tier: z.enum(["ai", "template", "direct"]).optional(),
  external_id: z.string().trim().max(200).optional(),
  external_url: z.string().trim().max(600).optional(),
  error: z.string().trim().max(500).optional()
}).strict();

const adminSettingsBodySchema = z.object({ ai_enabled: z.boolean().optional(), auto_enabled: z.boolean().optional() }).strict().refine((body) => body.ai_enabled !== undefined || body.auto_enabled !== undefined, { message: "Cần ai_enabled hoặc auto_enabled" });
const adminRunBodySchema = z.object({ product_ids: z.array(z.string().uuid()).max(3).optional() }).strict();

export const marketingRoutes = Router();

// ───── Dành cho n8n (xác thực bằng header x-n8n-secret, không cần đăng nhập)
marketingRoutes.get("/feed", asyncHandler(async (req, res) => {
  marketingService.assertSecret(req.header("x-n8n-secret") ?? undefined);
  sendSuccess(res, await marketingService.centralFeed());
}));

marketingRoutes.post("/callback", validateRequest({ body: callbackBodySchema }), asyncHandler(async (req, res) => {
  marketingService.assertSecret(req.header("x-n8n-secret") ?? undefined);
  await marketingService.reportResult(req.validated?.body as z.infer<typeof callbackBodySchema>);
  sendSuccess(res, { ok: true });
}));

// ───── Dành cho Admin: AI Agent đăng bài tổng hợp của FoodSave
marketingRoutes.get("/admin/overview", authMiddleware, requireRoles("admin"), asyncHandler(async (_req, res) => {
  sendSuccess(res, await marketingService.adminOverview());
}));

marketingRoutes.patch("/admin/settings", authMiddleware, requireRoles("admin"), validateRequest({ body: adminSettingsBodySchema }), asyncHandler(async (req, res) => {
  const body = req.validated?.body as z.infer<typeof adminSettingsBodySchema>;
  sendSuccess(res, await marketingService.adminSetSettings(body));
}));

marketingRoutes.post("/admin/preview", authMiddleware, requireRoles("admin"), validateRequest({ body: adminRunBodySchema }), asyncHandler(async (req, res) => {
  const body = req.validated?.body as z.infer<typeof adminRunBodySchema>;
  sendSuccess(res, await marketingService.adminBuildBundle(body.product_ids));
}));

marketingRoutes.post("/admin/run", authMiddleware, requireRoles("admin"), validateRequest({ body: adminRunBodySchema }), asyncHandler(async (req, res) => {
  const body = req.validated?.body as z.infer<typeof adminRunBodySchema>;
  sendSuccess(res, await marketingService.adminRun(body.product_ids));
}));

// ───── Dành cho cửa hàng
marketingRoutes.use(authMiddleware, requireRoles("partner", "admin"));

marketingRoutes.get("/settings", asyncHandler(async (req, res) => {
  const actor = getActor(req);
  sendSuccess(res, await marketingService.getSettings(actor.userId, actor.role));
}));

marketingRoutes.patch("/settings", validateRequest({ body: settingsBodySchema }), asyncHandler(async (req, res) => {
  const actor = getActor(req);
  sendSuccess(res, await marketingService.updateSettings(actor.userId, actor.role, req.validated?.body as z.infer<typeof settingsBodySchema>));
}));

marketingRoutes.get("/posts", asyncHandler(async (req, res) => {
  const actor = getActor(req);
  sendSuccess(res, { items: await marketingService.listPosts(actor.userId, actor.role) });
}));

marketingRoutes.get("/products/:id/content", validateRequest({ params: uuidParamSchema }), asyncHandler(async (req, res) => {
  const actor = getActor(req);
  const params = req.validated?.params as { id: string };
  sendSuccess(res, await marketingService.getContent(actor.userId, actor.role, params.id));
}));

marketingRoutes.post("/products/:id/promote", validateRequest({ params: uuidParamSchema, body: promoteBodySchema }), asyncHandler(async (req, res) => {
  const actor = getActor(req);
  const params = req.validated?.params as { id: string };
  const body = req.validated?.body as z.infer<typeof promoteBodySchema>;
  sendSuccess(res, await marketingService.promote(actor.userId, actor.role, params.id, body.channels, body.facebook_text));
}));
