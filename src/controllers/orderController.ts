import type { Request, Response } from "express";
import { HTTP_STATUS } from "../constants/http";
import type {
  CreateComplaintBody,
  CreateMomoPaymentBody,
  CreateOrderBody,
  CreateReviewBody,
  MomoWebhookMockBody,
  OrderListQuery,
  UpdateComplaintBody,
  UpdateOrderStatusBody
} from "../schemas/orderSchemas";
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

  async createReview(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const body = req.validated?.body as CreateReviewBody;
    const review = await orderService.createReview(actor.userId, body);
    sendSuccess(res, review, HTTP_STATUS.CREATED);
  },

  async createComplaint(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const body = req.validated?.body as CreateComplaintBody;
    const complaint = await orderService.createComplaint(actor.userId, body);
    sendSuccess(res, complaint, HTTP_STATUS.CREATED);
  },

  async listComplaints(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const complaints = await orderService.listComplaints(actor.userId, actor.role);
    sendSuccess(res, complaints);
  },

  async updateComplaint(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const params = req.validated?.params as UuidParams;
    const body = req.validated?.body as UpdateComplaintBody;
    const complaint = await orderService.updateComplaint(actor.userId, actor.role, params.id, body);
    sendSuccess(res, complaint);
  }
};
