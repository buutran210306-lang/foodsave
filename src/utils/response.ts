import type { Response } from "express";
import type { SuccessResponse } from "../types/api";
import type { HttpStatus } from "../constants/http";
import { HTTP_STATUS } from "../constants/http";

export const sendSuccess = <T>(res: Response, data: T, status: HttpStatus = HTTP_STATUS.OK): void => {
  const payload: SuccessResponse<T> = {
    success: true,
    data
  };
  res.status(status).json(payload);
};
