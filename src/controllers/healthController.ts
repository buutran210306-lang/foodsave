import type { Request, Response } from "express";
import { env } from "../config/env";
import { sendSuccess } from "../utils/response";

export const healthController = {
  getHealth(_req: Request, res: Response): void {
    sendSuccess(res, {
      service: "foodsave-backend",
      environment: env.NODE_ENV,
      uptime_seconds: Math.round(process.uptime()),
      checked_at: new Date().toISOString()
    });
  }
};
