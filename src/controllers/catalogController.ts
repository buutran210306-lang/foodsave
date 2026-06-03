import type { Request, Response } from "express";
import { HTTP_STATUS } from "../constants/http";
import type {
  CreateProductBody,
  CreateStoreBody,
  CreateVoucherBody,
  ProductListQuery,
  StoreListQuery,
  UpdateProductBody,
  UpdateStoreBody,
  VoucherListQuery
} from "../schemas/catalogSchemas";
import { catalogService } from "../services/catalogService";
import { getActor } from "../utils/requestContext";
import { sendSuccess } from "../utils/response";

type UuidParams = { id: string };

export const catalogController = {
  async listProducts(req: Request, res: Response): Promise<void> {
    const query = req.validated?.query as ProductListQuery;
    const products = await catalogService.listProducts(query);
    sendSuccess(res, products);
  },

  async getProduct(req: Request, res: Response): Promise<void> {
    const params = req.validated?.params as UuidParams;
    const product = await catalogService.getProduct(params.id);
    sendSuccess(res, product);
  },

  async listStores(req: Request, res: Response): Promise<void> {
    const query = req.validated?.query as StoreListQuery;
    const stores = await catalogService.listStores(query);
    sendSuccess(res, stores);
  },

  async getStore(req: Request, res: Response): Promise<void> {
    const params = req.validated?.params as UuidParams;
    const store = await catalogService.getStore(params.id);
    sendSuccess(res, store);
  },

  async createStore(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const body = req.validated?.body as CreateStoreBody;
    const store = await catalogService.createStore(actor.userId, body);
    sendSuccess(res, store, HTTP_STATUS.CREATED);
  },

  async updateStore(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const params = req.validated?.params as UuidParams;
    const body = req.validated?.body as UpdateStoreBody;
    const store = await catalogService.updateStore(actor.userId, actor.role, params.id, body);
    sendSuccess(res, store);
  },

  async createProduct(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const body = req.validated?.body as CreateProductBody;
    const product = await catalogService.createProduct(actor.userId, actor.role, body);
    sendSuccess(res, product, HTTP_STATUS.CREATED);
  },

  async updateProduct(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const params = req.validated?.params as UuidParams;
    const body = req.validated?.body as UpdateProductBody;
    const product = await catalogService.updateProduct(actor.userId, actor.role, params.id, body);
    sendSuccess(res, product);
  },

  async deleteProduct(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const params = req.validated?.params as UuidParams;
    await catalogService.deleteProduct(actor.userId, actor.role, params.id);
    sendSuccess(res, { deleted: true });
  },

  async listVouchers(req: Request, res: Response): Promise<void> {
    const query = req.validated?.query as VoucherListQuery;
    const vouchers = await catalogService.listVouchers(query);
    sendSuccess(res, vouchers);
  },

  async createVoucher(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const body = req.validated?.body as CreateVoucherBody;
    const voucher = await catalogService.createVoucher(actor.userId, actor.role, body);
    sendSuccess(res, voucher, HTTP_STATUS.CREATED);
  }
};
