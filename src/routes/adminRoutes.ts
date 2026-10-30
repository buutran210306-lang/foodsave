import { Router } from "express";
import { z } from "zod";
import { adminController } from "../controllers/adminController";
import { uuidParamSchema } from "../schemas/commonSchemas";
import { requireRoles } from "../middlewares/authMiddleware";
import { validateRequest } from "../middlewares/validateRequest";
import { asyncHandler } from "../utils/asyncHandler";

const adminUserParamSchema = z.object({
  userId: z.string().uuid()
}).strict();

const rejectPartnerBodySchema = z.object({
  reason: z.string().trim().min(1).max(1000)
}).strict();

const labelPolicySchema = z.object({
  payMinutes: z.number().int(),
  pickupMinutes: z.number().int(),
  cancelFreeBeforePickupMinutes: z.number().int(),
  finalReminderMinutes: z.number().int()
}).strict();
const policyBodySchema = z.object({
  labels: z.object({ green: labelPolicySchema, yellow: labelPolicySchema, red: labelPolicySchema }).strict(),
  grace_cancel_minutes: z.number().int(),
  min_pickup_window_minutes: z.number().int(),
  no_show_ban_count: z.number().int(),
  no_show_window_days: z.number().int(),
  red_ban_days: z.number().int()
}).strict();

const voucherBodySchema = z.object({
  code: z.string().trim().regex(/^[A-Za-z0-9_-]{3,30}$/, "Mã chỉ gồm chữ, số, - và _ (3-30 ký tự)"),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(300).optional(),
  percent_off: z.number().int().min(1).max(100).optional(),
  fixed_discount_cents: z.number().int().min(1000).max(100_000_000).optional(),
  min_order_cents: z.number().int().min(0).max(100_000_000).optional(),
  starts_at: z.string().datetime({ offset: true }),
  expires_at: z.string().datetime({ offset: true }),
  max_redemptions: z.number().int().min(1).max(1_000_000).optional()
}).strict();

export const adminRoutes = Router();

export { voucherBodySchema };

adminRoutes.use(requireRoles("admin"));

adminRoutes.get("/users", asyncHandler(adminController.systemUsers));
adminRoutes.get("/pending-partners", asyncHandler(adminController.getPendingPartners));

adminRoutes.post(
  "/approve/:userId",
  validateRequest({ params: adminUserParamSchema }),
  asyncHandler(adminController.approvePartner)
);

adminRoutes.post(
  "/reject/:userId",
  validateRequest({ params: adminUserParamSchema, body: rejectPartnerBodySchema }),
  asyncHandler(adminController.rejectPartner)
);

adminRoutes.post("/label-automation/run", asyncHandler(adminController.runLabelAutomation));

adminRoutes.post("/order-automation/run", asyncHandler(adminController.runOrderAutomation));
adminRoutes.get("/order-policy", asyncHandler(adminController.orderPolicy));
adminRoutes.put("/order-policy", validateRequest({ body: policyBodySchema }), asyncHandler(adminController.savePolicy));
adminRoutes.post("/order-policy/reset", asyncHandler(adminController.resetPolicy));
adminRoutes.get("/automation", asyncHandler(adminController.automationOverview));
adminRoutes.post("/automation/:job/run", validateRequest({ params: z.object({ job: z.enum(["label-automation", "order-automation", "complaint-escalation", "push-reminders"]) }).strict() }), asyncHandler(adminController.runAutomationJob));
adminRoutes.get("/audit-log", validateRequest({ query: z.object({ limit: z.coerce.number().int().min(1).max(300).default(100) }).strict() }), asyncHandler(adminController.auditLog));
adminRoutes.get("/labels", asyncHandler(adminController.labels));
adminRoutes.get("/verification", asyncHandler(adminController.verificationQueue));
adminRoutes.post(
  "/verification/:kind/:id/decision",
  validateRequest({
    params: z.object({ kind: z.enum(["store", "charity"]), id: z.string().uuid() }).strict(),
    body: z.object({ decision: z.enum(["approve", "reject"]), reason: z.string().trim().max(1000).optional() }).strict()
  }),
  asyncHandler(adminController.decideVerification)
);
adminRoutes.get("/vouchers", asyncHandler(adminController.listVouchers));
adminRoutes.post("/vouchers", validateRequest({ body: voucherBodySchema.extend({ store_id: z.string().uuid().nullable().optional() }) }), asyncHandler(adminController.createVoucher));
adminRoutes.patch("/vouchers/:id", validateRequest({ params: uuidParamSchema, body: z.object({ is_active: z.boolean() }).strict() }), asyncHandler(adminController.toggleVoucher));
adminRoutes.get("/esg", validateRequest({ query: z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }).strict() }), asyncHandler(adminController.esg));
adminRoutes.get("/fraud-alerts", asyncHandler(adminController.fraudAlerts));
adminRoutes.post("/fraud-alerts/handle", validateRequest({ body: z.object({ key: z.string().trim().min(3).max(120), status: z.enum(["handled", "dismissed"]), note: z.string().trim().max(300).optional() }).strict() }), asyncHandler(adminController.handleFraudAlert));
adminRoutes.get("/dashboard/work", asyncHandler(adminController.workStrip));
adminRoutes.post(
  "/customers/:id/unlock",
  validateRequest({ params: uuidParamSchema, body: z.object({ note: z.string().trim().max(300).optional() }).strict() }),
  asyncHandler(adminController.unlockCustomer)
);

const ledgerQuerySchema = z.object({
  type: z.enum(["charge", "release", "refund", "refund_clawback", "withdraw", "adjustment"]).optional(),
  order_number: z.string().trim().max(60).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30)
}).strict();

adminRoutes.get("/finance/summary", asyncHandler(adminController.financeSummary));
adminRoutes.post("/finance/reconcile", asyncHandler(adminController.runReconcile));
adminRoutes.get("/ledger", validateRequest({ query: ledgerQuerySchema }), asyncHandler(adminController.listLedger));
adminRoutes.get("/withdrawals", validateRequest({ query: z.object({ status: z.enum(["requested", "approved", "rejected"]).optional() }).strict() }), asyncHandler(adminController.listWithdrawals));
adminRoutes.patch(
  "/withdrawals/:id",
  validateRequest({
    params: uuidParamSchema,
    body: z.object({
      decision: z.enum(["approve", "reject", "start", "pay", "fail"]),
      note: z.string().trim().max(300).optional(),
      bank_txn_ref: z.string().trim().min(3).max(80).optional()
    }).strict()
  }),
  asyncHandler(adminController.decideWithdrawal)
);
adminRoutes.post("/withdrawals/:id/reveal-account", validateRequest({ params: uuidParamSchema }), asyncHandler(adminController.revealWithdrawalAccount));
adminRoutes.get("/payout-accounts", validateRequest({ query: z.object({ status: z.enum(["pending_verification", "verified", "rejected", "replaced"]).optional() }).strict() }), asyncHandler(adminController.listPayoutAccounts));
adminRoutes.patch(
  "/payout-accounts/:id",
  validateRequest({ params: uuidParamSchema, body: z.object({ decision: z.enum(["verify", "reject"]), note: z.string().trim().max(300).optional() }).strict() }),
  asyncHandler(adminController.decidePayoutAccount)
);

adminRoutes.get("/complaints", validateRequest({ query: z.object({ status: z.enum(["open", "in_review", "resolved", "rejected"]).optional() }).strict() }), asyncHandler(adminController.listComplaints));
adminRoutes.post(
  "/complaints/:id/decision",
  validateRequest({
    params: uuidParamSchema,
    body: z.object({
      decision: z.enum(["refund_full", "refund_partial", "reject"]),
      refund_cents: z.number().int().min(1).max(1_000_000_000).optional(),
      is_false_claim: z.boolean().optional(),
      note: z.string().trim().min(3).max(1000)
    }).strict()
  }),
  asyncHandler(adminController.decideComplaint)
);
