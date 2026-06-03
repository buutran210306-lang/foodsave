import cors from "cors";
import express from "express";
import helmet from "helmet";
import { env } from "./config/env";
import { ERROR_CODES } from "./constants/errors";
import { HTTP_STATUS } from "./constants/http";
import { errorHandler } from "./middlewares/errorHandler";
import { apiRateLimiter } from "./middlewares/rateLimiter";
import { apiRoutes } from "./routes";
import { AppError } from "./utils/appError";

export const app = express();

app.disable("x-powered-by");
app.set("trust proxy", 1);

const isAllowedCorsOrigin = (origin: string | undefined): boolean => {
  if (!origin) return true;
  if (env.CORS_ORIGINS.includes(origin)) return true;
  return env.NODE_ENV !== "production" && origin === "null";
};

app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (isAllowedCorsOrigin(origin)) {
      callback(null, true);
      return;
    }
    callback(new AppError(`CORS origin is not allowed: ${origin}`, HTTP_STATUS.FORBIDDEN, ERROR_CODES.CORS_FORBIDDEN));
  },
  credentials: true,
  methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Authorization", "Content-Type", "X-Requested-With"]
}));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));
app.use(apiRateLimiter);

app.use(env.API_BASE_PATH, apiRoutes);

app.use((_req, res) => {
  res.status(HTTP_STATUS.NOT_FOUND).json({
    success: false,
    error: {
      code: ERROR_CODES.RESOURCE_NOT_FOUND,
      message: "Route was not found"
    }
  });
});

app.use(errorHandler);
