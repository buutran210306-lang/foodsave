import type { Request, Response } from "express";
import { ledgerService } from "../services/ledgerService";
import { payoutAccountService } from "../services/payoutAccountService";
import { partnerService, type PartnerProfileUpdate } from "../services/partnerService";
import { partnerOpsService } from "../services/partnerOpsService";
import type { VoucherInput } from "../services/adminOpsService";
import { supabaseAdmin } from "../services/supabaseService";
import { AppError } from "../utils/appError";
import { ERROR_CODES } from "../constants/errors";
import { HTTP_STATUS } from "../constants/http";
import { getActor } from "../utils/requestContext";
import { sendSuccess } from "../utils/response";

// Cửa hàng của chủ tài khoản (cửa hàng đầu tiên). Ví, rút tiền gắn với cửa hàng này.
const ownStoreId = async (ownerId: string): Promise<string> => {
  const { data, error } = await supabaseAdmin.from("stores").select("id").eq("owner_id", ownerId).order("created_at", { ascending: true }).limit(1);
  if (error) throw error;
  const id = (data as Array<{ id: string }> | null)?.[0]?.id;
  if (!id) throw new AppError("Chưa có cửa hàng nào cho tài khoản này", HTTP_STATUS.NOT_FOUND, ERROR_CODES.RESOURCE_NOT_FOUND);
  return id;
};

export const partnerController = {
  async listCustomers(req: Request, res: Response): Promise<void> {
    sendSuccess(res, await partnerOpsService.customers(getActor(req).userId));
  },

  async listVouchers(req: Request, res: Response): Promise<void> {
    sendSuccess(res, await partnerOpsService.listVouchers(getActor(req).userId));
  },

  async createVoucher(req: Request, res: Response): Promise<void> {
    sendSuccess(res, await partnerOpsService.createVoucher(getActor(req).userId, req.validated?.body as VoucherInput), HTTP_STATUS.CREATED);
  },

  async toggleVoucher(req: Request, res: Response): Promise<void> {
    const params = req.validated?.params as { id: string };
    const body = req.validated?.body as { is_active: boolean };
    sendSuccess(res, await partnerOpsService.toggleVoucher(getActor(req).userId, params.id, body.is_active));
  },

  async getWallet(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const storeId = await ownStoreId(actor.userId);
    const [balance, entries, withdrawals, payout] = await Promise.all([
      ledgerService.getStoreBalance(storeId),
      ledgerService.listStoreEntries(storeId, 50),
      ledgerService.listWithdrawals(storeId),
      // Chưa chạy SQL 035 thì ví vẫn hiện được, chỉ chưa có tài khoản nhận tiền
      payoutAccountService.getForStore(storeId).catch(() => ({ current: null, history: [] }))
    ]);
    sendSuccess(res, { store_id: storeId, ...balance, entries, withdrawals, payout_account: payout.current });
  },

  async listWithdrawals(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    sendSuccess(res, await ledgerService.listWithdrawals(await ownStoreId(actor.userId)));
  },

  async createWithdrawal(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const body = req.validated?.body as { amount_cents: number };
    const created = await ledgerService.requestWithdrawal(await ownStoreId(actor.userId), body.amount_cents);
    sendSuccess(res, created, HTTP_STATUS.CREATED);
  },

  // Tài khoản nhận tiền: chỉ trả dạng che (tên ngân hàng, chủ tài khoản, 4 số cuối), không bao giờ trả số đầy đủ
  async getPayoutAccount(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    sendSuccess(res, await payoutAccountService.getForStore(await ownStoreId(actor.userId)));
  },

  async submitPayoutAccount(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const body = req.validated?.body as { bank_name: string; account_holder_name: string; account_number: string };
    sendSuccess(res, await payoutAccountService.submit(await ownStoreId(actor.userId), body), HTTP_STATUS.CREATED);
  },

  async getDashboard(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const dashboard = await partnerService.getDashboard(actor.userId);
    sendSuccess(res, dashboard);
  },

  async listProducts(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    sendSuccess(res, await partnerService.listOwnProducts(actor.userId));
  },

  async updateProfile(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    sendSuccess(res, await partnerService.updateOwnProfile(actor.userId, req.validated?.body as PartnerProfileUpdate));
  },

  async createProductImageUploadUrl(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const body = req.validated?.body as { content_type: string };
    sendSuccess(res, await partnerService.createProductImageUploadUrl(actor.userId, body.content_type));
  }
};
