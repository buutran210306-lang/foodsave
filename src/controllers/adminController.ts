import type { Request, Response } from "express";
import { complaintService } from "../services/complaintService";
import { ledgerService } from "../services/ledgerService";
import { payoutAccountService } from "../services/payoutAccountService";
import { orderAutomationService } from "../services/orderAutomationService";
import { getActor } from "../utils/requestContext";
import { customerReputationService } from "../services/customerReputationService";
import { CUSTOMER_REPUTATION, GRACE_CANCEL_MINUTES, LABEL_POLICY, MIN_PICKUP_WINDOW_MINUTES, NO_SHOW_BAN_COUNT, NO_SHOW_WINDOW_DAYS, RED_BAN_DAYS, timeScale } from "../constants/orderPolicy";
import { HTTP_STATUS } from "../constants/http";
import { ERROR_CODES } from "../constants/errors";
import { AppError } from "../utils/appError";
import { adminService } from "../services/adminService";
import { labelAutomationService } from "../services/labelAutomationService";
import { sendSuccess } from "../utils/response";
import { adminAuditService } from "../services/adminAuditService";
import { adminOpsService, type VoucherInput } from "../services/adminOpsService";
import { AUTOMATION_JOBS, automationRunService, type AutomationJob } from "../services/automationRunService";
import { policyConfigService } from "../services/policyConfigService";
import { volunteerReminderService } from "../services/volunteerReminderService";
import type { PolicyConfig } from "../constants/orderPolicy";

const auditActor = (req: Request): { userId: string; name: string | null } => {
  const actor = getActor(req);
  return { userId: actor.userId, name: actor.profile.full_name ?? null };
};

type AdminUserParams = { userId: string };
type RejectPartnerBody = { reason: string };

export const adminController = {
  async getPendingPartners(_req: Request, res: Response): Promise<void> {
    const partners = await adminService.getPendingPartners();
    sendSuccess(res, partners);
  },

  async approvePartner(req: Request, res: Response): Promise<void> {
    const params = req.validated?.params as AdminUserParams;
    const result = await adminService.approvePartner(params.userId);
    sendSuccess(res, result, HTTP_STATUS.OK);
  },

  async rejectPartner(req: Request, res: Response): Promise<void> {
    const params = req.validated?.params as AdminUserParams;
    const body = req.validated?.body as RejectPartnerBody;
    const result = await adminService.rejectPartner(params.userId, body.reason);
    sendSuccess(res, result, HTTP_STATUS.OK);
  },

  async systemUsers(_req: Request, res: Response): Promise<void> {
    sendSuccess(res, await adminService.systemUsers());
  },

  // Chạy ngay tác vụ đơn hàng (hủy quá hạn thanh toán, vắng mặt, nhắc lấy hàng)
  async runOrderAutomation(req: Request, res: Response): Promise<void> {
    const result = await automationRunService.track("order-automation", "manual", () => orderAutomationService.run("manual"));
    await adminAuditService.log(auditActor(req), "automation.run", "automation", "order-automation", {});
    sendSuccess(res, result);
  },

  async savePolicy(req: Request, res: Response): Promise<void> {
    const body = req.validated?.body as PolicyConfig;
    sendSuccess(res, await policyConfigService.save(body, auditActor(req)));
  },

  async resetPolicy(req: Request, res: Response): Promise<void> {
    sendSuccess(res, await policyConfigService.reset(auditActor(req)));
  },

  async automationOverview(_req: Request, res: Response): Promise<void> {
    sendSuccess(res, await automationRunService.overview());
  },

  // Chạy ngay MỘT tác vụ và ghi nhật ký
  async runAutomationJob(req: Request, res: Response): Promise<void> {
    const job = (req.validated?.params as { job: AutomationJob }).job;
    if (!AUTOMATION_JOBS.includes(job)) throw new AppError("Tác vụ không tồn tại", HTTP_STATUS.NOT_FOUND, ERROR_CODES.RESOURCE_NOT_FOUND);
    const work: Record<AutomationJob, () => Promise<object>> = {
      "label-automation": () => labelAutomationService.run(),
      "order-automation": () => orderAutomationService.run("manual"),
      "complaint-escalation": async () => ({ escalated: await complaintService.escalateOverdue(), completed: await complaintService.completePendingOutcomes() }),
      "push-reminders": async () => ({ volunteer_reminders: await volunteerReminderService.run() })
    };
    const result = await automationRunService.track(job, "manual", work[job]);
    await adminAuditService.log(auditActor(req), "automation.run", "automation", job, {});
    sendSuccess(res, result);
  },

  async auditLog(req: Request, res: Response): Promise<void> {
    const limit = Number((req.validated?.query as { limit?: number } | undefined)?.limit ?? 100);
    sendSuccess(res, await adminAuditService.list(limit));
  },

  async labels(_req: Request, res: Response): Promise<void> { sendSuccess(res, await adminOpsService.labelOverview()); },
  async verificationQueue(_req: Request, res: Response): Promise<void> { sendSuccess(res, await adminOpsService.verificationQueue()); },
  async decideVerification(req: Request, res: Response): Promise<void> {
    const params = req.validated?.params as { kind: "store" | "charity"; id: string };
    const body = req.validated?.body as { decision: "approve" | "reject"; reason?: string | undefined };
    sendSuccess(res, await adminOpsService.decideVerification(params.kind, params.id, body.decision, body.reason, auditActor(req)));
  },
  async listVouchers(_req: Request, res: Response): Promise<void> { sendSuccess(res, await adminOpsService.listVouchers(null)); },
  async createVoucher(req: Request, res: Response): Promise<void> {
    const body = req.validated?.body as VoucherInput & { store_id?: string | null };
    const { store_id: storeId, ...input } = body;
    sendSuccess(res, await adminOpsService.createVoucher(storeId ?? null, input, auditActor(req)), HTTP_STATUS.CREATED);
  },
  async toggleVoucher(req: Request, res: Response): Promise<void> {
    const params = req.validated?.params as { id: string };
    const body = req.validated?.body as { is_active: boolean };
    sendSuccess(res, await adminOpsService.toggleVoucher(params.id, body.is_active, null, auditActor(req)));
  },
  async esg(req: Request, res: Response): Promise<void> {
    const month = (req.validated?.query as { month: string }).month;
    sendSuccess(res, await adminOpsService.esgReport(month));
  },
  async fraudAlerts(_req: Request, res: Response): Promise<void> { sendSuccess(res, await adminOpsService.fraudAlerts()); },
  async handleFraudAlert(req: Request, res: Response): Promise<void> {
    const body = req.validated?.body as { key: string; status: "handled" | "dismissed"; note?: string | undefined };
    sendSuccess(res, await adminOpsService.handleFraudAlert(body.key, body.status, body.note, auditActor(req)));
  },
  async workStrip(_req: Request, res: Response): Promise<void> { sendSuccess(res, await adminOpsService.workStrip()); },

  // Chính sách đơn hàng ở chế độ chỉ đọc (một nguồn duy nhất: src/constants/orderPolicy.ts)
  async orderPolicy(_req: Request, res: Response): Promise<void> {
    const stored = await policyConfigService.get();
    sendSuccess(res, {
      stored: stored.stored,
      updated_at: stored.updated_at,
      updated_by: stored.updated_by,
      labels: LABEL_POLICY,
      grace_cancel_minutes: GRACE_CANCEL_MINUTES,
      min_pickup_window_minutes: MIN_PICKUP_WINDOW_MINUTES,
      platform_fee: 2000,
      no_show_ban_count: NO_SHOW_BAN_COUNT,
      no_show_window_days: NO_SHOW_WINDOW_DAYS,
      red_ban_days: RED_BAN_DAYS,
      reputation: CUSTOMER_REPUTATION,
      time_scale: timeScale()
    });
  },

  async financeSummary(_req: Request, res: Response): Promise<void> {
    const [summary, reconcile] = await Promise.all([ledgerService.financeSummary(), ledgerService.reconcile()]);
    sendSuccess(res, { ...summary, reconcile });
  },

  // "Chạy đối soát ngay": bù bút toán còn thiếu rồi kiểm tra tổng số dư
  async runReconcile(_req: Request, res: Response): Promise<void> {
    const synced = await ledgerService.syncPendingOrders();
    sendSuccess(res, { synced_orders: synced, ...(await ledgerService.reconcile()) });
  },

  async listLedger(req: Request, res: Response): Promise<void> {
    const q = req.validated?.query as { type?: string; order_number?: string; from?: string; to?: string; page: number; limit: number };
    sendSuccess(res, await ledgerService.listEntries(q));
  },

  async listWithdrawals(req: Request, res: Response): Promise<void> {
    const q = req.validated?.query as { status?: string };
    sendSuccess(res, await ledgerService.listAllWithdrawals(q.status));
  },

  async decideWithdrawal(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const params = req.validated?.params as { id: string };
    const body = req.validated?.body as { decision: "approve" | "reject" | "start" | "pay" | "fail"; note?: string | undefined; bank_txn_ref?: string | undefined };
    sendSuccess(res, await ledgerService.transitionWithdrawal(params.id, body.decision, actor.userId, { note: body.note, bank_txn_ref: body.bank_txn_ref }));
  },

  // Xem số tài khoản đầy đủ để chi trả: có ghi nhật ký truy cập
  async revealWithdrawalAccount(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const params = req.validated?.params as { id: string };
    sendSuccess(res, await payoutAccountService.revealForWithdrawal(params.id, actor.userId, "admin_manual_payout"));
  },

  async listPayoutAccounts(req: Request, res: Response): Promise<void> {
    const q = req.validated?.query as { status?: string };
    sendSuccess(res, await payoutAccountService.listForAdmin(q.status));
  },

  async decidePayoutAccount(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const params = req.validated?.params as { id: string };
    const body = req.validated?.body as { decision: "verify" | "reject"; note?: string | undefined };
    sendSuccess(res, await payoutAccountService.decide(params.id, body.decision === "verify", actor.userId, body.note));
  },

  async listComplaints(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const q = req.validated?.query as { status?: string };
    sendSuccess(res, await complaintService.list(actor.userId, "admin", q));
  },

  async decideComplaint(req: Request, res: Response): Promise<void> {
    const actor = getActor(req);
    const params = req.validated?.params as { id: string };
    const body = req.validated?.body as { decision: "refund_full" | "refund_partial" | "reject"; refund_cents?: number | undefined; is_false_claim?: boolean | undefined; note: string };
    sendSuccess(res, await complaintService.decide(actor.userId, params.id, body));
  },

  async unlockCustomer(req: Request, res: Response): Promise<void> {
    const params = req.validated?.params as { id: string };
    const body = req.validated?.body as { note?: string | undefined };
    const result = await customerReputationService.unlock(params.id, body.note);
    await adminAuditService.log(auditActor(req), "customer.unlock", "customer", params.id, { note: body.note ?? null });
    sendSuccess(res, result);
  },

  // Chạy ngay tác vụ đổi nhãn/giá/thông báo (dùng khi demo, không phải chờ lượt chạy định kỳ)
  async runLabelAutomation(req: Request, res: Response): Promise<void> {
    const result = await automationRunService.track("label-automation", "manual", () => labelAutomationService.run());
    await adminAuditService.log(auditActor(req), "automation.run", "automation", "label-automation", {});
    sendSuccess(res, result);
  }
};
