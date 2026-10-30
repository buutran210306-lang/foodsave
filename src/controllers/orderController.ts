import type { Request, Response } from "express";
import { HTTP_STATUS } from "../constants/http";
import { env } from "../config/env";
import { ERROR_CODES } from "../constants/errors";
import { AppError } from "../utils/appError";
import type {
  CancelOrderBody,
  ChatMessageBody,
  ConfirmPaymentBody,
  CreateComplaintBody,
  CreateMomoPaymentBody,
  CreateOrderBody,
  CreateReviewBody,
  RespondComplaintBody,
  MomoWebhookMockBody,
  OrderListQuery,
  UpdateComplaintBody,
  UpdateOrderStatusBody
} from "../schemas/orderSchemas";
import { complaintService } from "../services/complaintService";
import { orderChatService } from "../services/orderChatService";
import { orderService } from "../services/orderService";
import { getActor } from "../utils/requestContext";
import { sendSuccess } from "../utils/response";

type UuidParams = { id: string };

export const orderController = {
  async createOrder(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const body = req.validated?.body as CreateOrderBody;
    const result = await orderService.createOrder(actor.userId, body);
    sendSuccess(res, result, HTTP_STATUS.CREATED);
  },

  async confirmPayment(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const params = req.validated?.params as UuidParams;
    const body = req.validated?.body as ConfirmPaymentBody;
    const order = await orderService.confirmPayment(actor.userId, actor.role, params.id, body.payment_method);
    sendSuccess(res, order);
  },

  async createMomoPayment(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const body = req.validated?.body as CreateMomoPaymentBody;
    const result = await orderService.createMomoPayment(actor.userId, body);
    sendSuccess(res, result, HTTP_STATUS.CREATED);
  },

  async refreshMomoPayment(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const params = req.validated?.params as UuidParams;
    const result = await orderService.refreshMomoPayment(actor.userId, actor.role, params.id);
    sendSuccess(res, result);
  },

  async pollMomoPayment(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const params = req.validated?.params as UuidParams;
    const result = await orderService.pollMomoPayment(actor.userId, actor.role, params.id);
    sendSuccess(res, result);
  },

  async mockMomoWebhook(req: Request, res: Response): Promise<void> {
    // Webhook giả không có chữ ký: chỉ cho phép khi DEMO_MODE (thử nghiệm). Cổng thật dùng POST /payments/webhook/:provider.
    if (!env.DEMO_MODE) throw new AppError("Not found", HTTP_STATUS.NOT_FOUND, ERROR_CODES.RESOURCE_NOT_FOUND);
    const body = req.validated?.body as MomoWebhookMockBody;
    const order = await orderService.applyMomoWebhookMock(body);
    sendSuccess(res, order);
  },

  async listOrders(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const query = req.validated?.query as OrderListQuery;
    const result = await orderService.listOrders(actor.userId, actor.role, query);
    sendSuccess(res, result);
  },

  async getOrder(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const params = req.validated?.params as UuidParams;
    const order = await orderService.getOrder(actor.userId, actor.role, params.id);
    sendSuccess(res, order);
  },

  async updateOrderStatus(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const params = req.validated?.params as UuidParams;
    const body = req.validated?.body as UpdateOrderStatusBody;
    const order = await orderService.updateOrderStatus(actor.userId, actor.role, params.id, body);
    sendSuccess(res, order);
  },

  async cancelOrder(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const params = req.validated?.params as UuidParams;
    const body = req.validated?.body as CancelOrderBody;
    sendSuccess(res, await orderService.cancelByCustomer(actor.userId, params.id, body));
  },

  async listMessages(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const params = req.validated?.params as UuidParams;
    sendSuccess(res, await orderChatService.list(params.id, actor.userId, actor.role));
  },

  async sendMessage(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const params = req.validated?.params as UuidParams;
    const body = req.validated?.body as ChatMessageBody;
    sendSuccess(res, await orderChatService.send(params.id, actor.userId, actor.role, body.body), HTTP_STATUS.CREATED);
  },

  async markMessagesRead(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const params = req.validated?.params as UuidParams;
    sendSuccess(res, await orderChatService.markRead(params.id, actor.userId, actor.role));
  },

  async unreadMessages(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    sendSuccess(res, await orderChatService.unreadByOrder(actor.userId, actor.role));
  },

  async createReview(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const body = req.validated?.body as CreateReviewBody;
    const review = await orderService.createReview(actor.userId, body);
    sendSuccess(res, review, HTTP_STATUS.CREATED);
  },

  async createComplaint(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const body = req.validated?.body as CreateComplaintBody;
    sendSuccess(res, await complaintService.create(actor.userId, body), HTTP_STATUS.CREATED);
  },

  async listComplaints(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    sendSuccess(res, await complaintService.list(actor.userId, actor.role, (req.validated?.query as { status?: string } | undefined) ?? {}));
  },

  // Khiếu nại CŨ (không có lý do/ảnh): giữ luồng cũ cho dữ liệu đã có
  async updateComplaint(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const params = req.validated?.params as UuidParams;
    const body = req.validated?.body as UpdateComplaintBody;
    sendSuccess(res, await complaintService.legacyUpdate(actor.userId, actor.role, params.id, body));
  },

  async respondComplaint(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const params = req.validated?.params as UuidParams;
    sendSuccess(res, await complaintService.respond(actor.userId, params.id, req.validated?.body as RespondComplaintBody));
  },

  async complaintUploadUrl(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const body = req.validated?.body as { content_type: string };
    sendSuccess(res, await complaintService.createUploadUrl(actor.userId, actor.role, body.content_type), HTTP_STATUS.CREATED);
  }
};
