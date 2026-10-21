import { Router } from "express";
import { z } from "zod";
import { volunteerAuth } from "../middlewares/volunteerAuth";
import { validateRequest } from "../middlewares/validateRequest";
import { uuidParamSchema } from "../schemas/commonSchemas";
import { teamService } from "../services/teamService";
import { volunteerService } from "../services/volunteerService";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";

const loginBodySchema = z.object({ phone: z.string().trim().min(8).max(20) }).strict();

// TNV chỉ được sửa các trường này; số điện thoại do tổ chức quản lý nên không có ở đây (.strict từ chối trường lạ)
const updateProfileBodySchema = z.object({
  full_name: z.string().trim().min(2).max(140).optional(),
  email: z.string().trim().email().max(200).optional(),
  vehicle: z.string().trim().min(2).max(180).optional(),
  zones: z.array(z.string().trim().min(1).max(80)).min(1).max(20).optional(),
  schedule: z.string().trim().min(2).max(240).optional(),
  duty_role: z.enum(["pickup", "distribute", "both"]).optional(),
  avatar_url: z.string().url().max(600).optional()
}).strict();

const avatarUploadBodySchema = z.object({ content_type: z.enum(["image/jpeg", "image/png", "image/webp"]) }).strict();

const activeBodySchema = z.object({ active: z.boolean() }).strict();

const stageSchema = z.enum(["pickup", "distribute"]);
const photoUploadBodySchema = z.object({ stage: stageSchema, content_type: z.enum(["image/jpeg", "image/png", "image/webp"]) }).strict();
const submitPhotoBodySchema = z.object({
  stage: stageSchema,
  photo_url: z.string().url().max(800),
  taken_at: z.string().datetime().optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  is_demo: z.boolean().optional(),
  blur_score: z.number().min(0).max(1000000).optional(),
  brightness: z.number().min(0).max(255).optional()
}).strict();
const completeStageBodySchema = z.object({ stage: stageSchema }).strict();

export const volunteerRoutes = Router();

// Tình nguyện viên đăng nhập chỉ bằng số điện thoại (do tổ chức đăng ký) - dùng cho bản demo
volunteerRoutes.post("/login", validateRequest({ body: loginBodySchema }), asyncHandler(async (req, res) => {
  const body = req.validated?.body as { phone: string };
  sendSuccess(res, await volunteerService.login(body.phone));
}));

volunteerRoutes.get("/me", volunteerAuth, asyncHandler(async (_req, res) => {
  sendSuccess(res, await volunteerService.getProfile(res.locals.volunteerId as string));
}));

volunteerRoutes.patch("/me", volunteerAuth, validateRequest({ body: updateProfileBodySchema }), asyncHandler(async (req, res) => {
  const body = req.validated?.body as z.infer<typeof updateProfileBodySchema>;
  sendSuccess(res, await volunteerService.updateProfile(res.locals.volunteerId as string, body));
}));

volunteerRoutes.post("/me/avatar-upload-url", volunteerAuth, validateRequest({ body: avatarUploadBodySchema }), asyncHandler(async (req, res) => {
  const body = req.validated?.body as z.infer<typeof avatarUploadBodySchema>;
  sendSuccess(res, await volunteerService.createAvatarUploadUrl(res.locals.volunteerId as string, body.content_type));
}));

volunteerRoutes.patch("/me/active", volunteerAuth, validateRequest({ body: activeBodySchema }), asyncHandler(async (req, res) => {
  const body = req.validated?.body as z.infer<typeof activeBodySchema>;
  sendSuccess(res, await volunteerService.setActive(res.locals.volunteerId as string, body.active));
}));

volunteerRoutes.get("/tasks", volunteerAuth, asyncHandler(async (_req, res) => {
  sendSuccess(res, { items: await volunteerService.listTasks(res.locals.volunteerId as string) });
}));

volunteerRoutes.post("/tasks/:id/photos/upload-url", volunteerAuth, validateRequest({ params: uuidParamSchema, body: photoUploadBodySchema }), asyncHandler(async (req, res) => {
  const params = req.validated?.params as { id: string };
  const body = req.validated?.body as z.infer<typeof photoUploadBodySchema>;
  sendSuccess(res, await teamService.createPhotoUploadUrl(res.locals.volunteerId as string, params.id, body.stage, body.content_type));
}));

volunteerRoutes.post("/tasks/:id/photos", volunteerAuth, validateRequest({ params: uuidParamSchema, body: submitPhotoBodySchema }), asyncHandler(async (req, res) => {
  const params = req.validated?.params as { id: string };
  const body = req.validated?.body as z.infer<typeof submitPhotoBodySchema>;
  sendSuccess(res, await teamService.submitPhoto(res.locals.volunteerId as string, params.id, body));
}));

volunteerRoutes.post("/tasks/:id/complete", volunteerAuth, validateRequest({ params: uuidParamSchema, body: completeStageBodySchema }), asyncHandler(async (req, res) => {
  const params = req.validated?.params as { id: string };
  const body = req.validated?.body as z.infer<typeof completeStageBodySchema>;
  sendSuccess(res, await teamService.completeStage(res.locals.volunteerId as string, params.id, body.stage));
}));

volunteerRoutes.patch("/tasks/:id/start", volunteerAuth, validateRequest({ params: uuidParamSchema }), asyncHandler(async (req, res) => {
  const params = req.validated?.params as { id: string };
  sendSuccess(res, await volunteerService.startTask(res.locals.volunteerId as string, params.id));
}));
