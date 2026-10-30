import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { pushActor } from "../middlewares/pushAuth";
import { validateRequest } from "../middlewares/validateRequest";
import { pushService } from "../services/pushService";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";

const subscribeBodySchema = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({
    p256dh: z.string().min(10).max(300),
    auth: z.string().min(10).max(300)
  }).strict()
}).strict();

const unsubscribeBodySchema = z.object({ endpoint: z.string().url().max(1000) }).strict();

export const pushRoutes = Router();

// Khóa công khai (không bí mật): giao diện dùng để đăng ký thiết bị
pushRoutes.get("/public-key", (_req: Request, res: Response) => {
  sendSuccess(res, pushService.publicKey());
});

pushRoutes.post(
  "/subscribe",
  pushActor,
  validateRequest({ body: subscribeBodySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const body = req.validated?.body as z.infer<typeof subscribeBodySchema>;
    const owner = res.locals.pushOwner as { kind: "user" | "volunteer"; id: string };
    sendSuccess(res, await pushService.subscribe(owner, { endpoint: body.endpoint, keys: body.keys, userAgent: req.headers["user-agent"] }));
  })
);

pushRoutes.post(
  "/unsubscribe",
  pushActor,
  validateRequest({ body: unsubscribeBodySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const body = req.validated?.body as z.infer<typeof unsubscribeBodySchema>;
    const owner = res.locals.pushOwner as { kind: "user" | "volunteer"; id: string };
    sendSuccess(res, await pushService.unsubscribe(owner, body.endpoint));
  })
);
