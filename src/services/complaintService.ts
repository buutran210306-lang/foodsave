/**
 * Khiếu nại (đặc tả 2.7).
 *  1. Người mua gửi khiếu nại cho đơn đã hoàn tất: bắt buộc >= 1 ảnh + lý do, trong hạn 12 giờ (có đồ nấu chín) / 24 giờ, mỗi đơn một khiếu nại.
 *  2. Cửa hàng có 12 giờ phản hồi: "Đồng ý hoàn tiền" (hoàn 100%, xong) hoặc "Không đồng ý" (kèm ghi chú / ảnh, chuyển Admin).
 *     Quá 12 giờ chưa phản hồi: tác vụ order-automation tự chuyển Admin.
 *  3. Admin quyết định: hoàn đủ / hoàn một phần / bác bỏ (có thể đánh dấu khiếu nại sai).
 *  4. Hệ quả: hoàn tiền qua sổ cái (lấy lại từ ví cửa hàng) và PaymentProvider.refund; khiếu nại đúng trừ 15 điểm cửa hàng + seller_violations
 *     COMPLAINT_UPHELD; khiếu nại sai trừ 10 điểm người mua; mọi bên được thông báo.
 * Khiếu nại CŨ (reason_code = null, tạo trước Đợt 3) vẫn chạy theo luồng cũ qua legacyUpdate().
 */
import { env } from "../config/env";
import { ERROR_CODES } from "../constants/errors";
import { HTTP_STATUS } from "../constants/http";
import { COMPLAINT_STORE_RESPONSE_HOURS, CUSTOMER_REPUTATION, policyHoursMs } from "../constants/orderPolicy";
import type { Order, UserRole } from "../types/domain";
import { AppError } from "../utils/appError";
import { logger } from "../utils/logger";
import { customerReputationService } from "./customerReputationService";
import { ledgerService } from "./ledgerService";
import { createNotification } from "./notificationService";
import { complaintDeadlineFor, refundViaProvider } from "./orderService";
import { applyComplaintUpheldPenalty } from "./sellerComplaintPenalty";
import { handleSupabaseError, requireRecord, supabaseAdmin } from "./supabaseService";
import { randomUUID } from "crypto";

export const EVIDENCE_BUCKET = "partner-assets";
const EVIDENCE_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export type ReasonCode = "wrong_item" | "spoiled_expired" | "missing_items" | "other";
export type Decision = "refund_full" | "refund_partial" | "reject";

export interface ComplaintRow {
  id: string;
  order_id: string;
  customer_id: string;
  store_id: string;
  product_names: string[];
  issue: string;
  priority: string;
  status: "open" | "in_review" | "resolved" | "rejected";
  resolution: string | null;
  image_urls: string[];
  created_at: string;
  reason_code: ReasonCode | null;
  response_due_at: string | null;
  store_response: string | null;
  store_response_action: "accept" | "dispute" | null;
  store_response_images: string[];
  store_responded_at: string | null;
  escalated_at: string | null;
  decision: Decision | null;
  refund_cents: number | string;
  is_false_claim: boolean;
  admin_note: string | null;
  decided_by: string | null;
  decided_at: string | null;
}

const PRIORITY_BY_REASON: Record<ReasonCode, string> = { spoiled_expired: "high", wrong_item: "medium", missing_items: "medium", other: "low" };
const REASON_LABEL: Record<string, string> = { wrong_item: "Giao sai sản phẩm", spoiled_expired: "Hư hỏng / hết hạn", missing_items: "Thiếu sản phẩm", other: "Lý do khác" };

const conflict = (message: string, code: string = ERROR_CODES.RESOURCE_CONFLICT): AppError => new AppError(message, HTTP_STATUS.CONFLICT, code);
const notFound = (message = "Không tìm thấy khiếu nại"): AppError => new AppError(message, HTTP_STATUS.NOT_FOUND, ERROR_CODES.RESOURCE_NOT_FOUND);
const forbidden = (message: string): AppError => new AppError(message, HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN);
const money = (value: number): string => `${Math.round(value).toLocaleString("vi-VN")}đ`;

/** Chỉ nhận ảnh đã tải lên kho của FoodSave (qua link tải ảnh của backend), không nhận đường dẫn ngoài */
const assertEvidenceUrls = (urls: string[] | undefined): string[] => {
  const prefix = `${env.SUPABASE_URL.replace(/\/+$/, "")}/storage/v1/object/public/${EVIDENCE_BUCKET}/complaints/`;
  const list = urls ?? [];
  if (list.some((url) => !url.startsWith(prefix))) {
    throw new AppError("Ảnh minh chứng phải được tải lên qua FoodSave", HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
  }
  return list;
};

const loadComplaint = async (id: string): Promise<ComplaintRow> => {
  const { data, error } = await supabaseAdmin.from("complaints").select("*").eq("id", id).maybeSingle();
  if (error) handleSupabaseError(error, "Failed to load complaint");
  if (!data) throw notFound();
  return data as ComplaintRow;
};

const loadOrder = async (orderId: string): Promise<Order & { stores?: { owner_id: string; name: string } }> => {
  const { data, error } = await supabaseAdmin.from("orders").select("*, stores!inner(owner_id,name)").eq("id", orderId).maybeSingle();
  if (error) handleSupabaseError(error, "Failed to load order");
  return requireRecord(data as (Order & { stores?: { owner_id: string; name: string } }) | null, "Không tìm thấy đơn hàng");
};

const logEvent = async (orderId: string, type: string, detail: Record<string, unknown>): Promise<void> => {
  const { error } = await supabaseAdmin.from("order_events").insert({ order_id: orderId, event_type: type, detail });
  if (error) logger.warn("Không ghi được nhật ký đơn", { orderId, type, error });
};

const eventExists = async (orderId: string, type: string, complaintId: string): Promise<boolean> => {
  const { data } = await supabaseAdmin.from("order_events").select("id,detail").eq("order_id", orderId).eq("event_type", type).limit(20);
  return ((data ?? []) as Array<{ detail: { complaint_id?: string } | null }>).some((row) => row.detail?.complaint_id === complaintId);
};

const notifyStore = async (storeId: string, type: string, title: string, body: string, complaintId: string): Promise<void> => {
  const { data } = await supabaseAdmin.from("stores").select("owner_id").eq("id", storeId).maybeSingle();
  const owner = (data as { owner_id: string } | null)?.owner_id;
  if (owner) await createNotification({ recipientId: owner, roleTarget: "partner", type, title, body, relatedType: "complaint", relatedId: complaintId });
};
const notifyCustomer = async (customerId: string, type: string, title: string, body: string, complaintId: string): Promise<void> => {
  await createNotification({ recipientId: customerId, roleTarget: "customer", type, title, body, relatedType: "complaint", relatedId: complaintId });
};
const notifyAdmins = async (title: string, body: string, complaintId: string): Promise<void> => {
  await createNotification({ roleTarget: "admin", type: "complaint-escalated", title, body, relatedType: "complaint", relatedId: complaintId });
};

/**
 * Hệ quả của một quyết định hoàn tiền / bác bỏ: sổ cái, cờ đơn, nhà cung cấp thanh toán, điểm uy tín.
 * Idempotent: gọi lại không hoàn / trừ điểm hai lần (khóa bút toán + nhật ký đơn). Không gửi thông báo (người gọi lo).
 */
const applyOutcome = async (complaint: ComplaintRow): Promise<void> => {
  const order = await loadOrder(complaint.order_id);
  const total = Number(order.total_cents);

  if (complaint.decision === "refund_full" || complaint.decision === "refund_partial") {
    const full = complaint.decision === "refund_full";
    const amount = full ? total : Math.min(total, Number(complaint.refund_cents));
    // Đơn đã hoàn tất nhưng sổ cái chưa kịp ghi giải ngân: ghi bù trước khi hoàn
    await ledgerService.syncOrder(order);
    await ledgerService.refundOrder(order, { amount, reason: full ? "complaint_upheld" : "complaint_partial" });
    await supabaseAdmin
      .from("orders")
      .update(full ? { settlement_status: "refunded", payment_status: "refunded", ledger_synced_status: "refunded" } : { settlement_status: "partially_refunded" })
      .eq("id", order.id);
    if (!(await eventExists(order.id, "complaint_provider_refund", complaint.id))) {
      await logEvent(order.id, "complaint_provider_refund", { complaint_id: complaint.id, amount });
      await refundViaProvider(order, amount, full ? "complaint_upheld" : "complaint_partial");
    }
    if (!(await eventExists(order.id, "complaint_seller_penalty", complaint.id))) {
      await logEvent(order.id, "complaint_seller_penalty", { complaint_id: complaint.id });
      try {
        await applyComplaintUpheldPenalty(order.store_id, order.id, complaint.id);
      } catch (error) {
        logger.warn("Không trừ được điểm uy tín cửa hàng khi khiếu nại đúng", { complaintId: complaint.id, error });
      }
    }
  } else if (complaint.decision === "reject" && complaint.is_false_claim) {
    if (!(await eventExists(order.id, "complaint_false_claim_penalty", complaint.id))) {
      await logEvent(order.id, "complaint_false_claim_penalty", { complaint_id: complaint.id });
      try {
        await customerReputationService.applyDelta(complaint.customer_id, CUSTOMER_REPUTATION.falseComplaintDelta, "false_complaint");
      } catch (error) {
        logger.warn("Không trừ được điểm người mua khi khiếu nại sai", { complaintId: complaint.id, error });
      }
    }
  }
};

/** Gắn thông tin hiển thị: mã đơn, giá trị đơn, tên người mua, tên cửa hàng */
const enrich = async (rows: ComplaintRow[]): Promise<Array<ComplaintRow & { order_number: string | null; order_total: number | null; customer_name: string | null; store_name: string | null }>> => {
  if (rows.length === 0) return [];
  const orderIds = [...new Set(rows.map((r) => r.order_id))];
  const customerIds = [...new Set(rows.map((r) => r.customer_id))];
  const storeIds = [...new Set(rows.map((r) => r.store_id))];
  const [{ data: orders }, { data: profiles }, { data: stores }] = await Promise.all([
    supabaseAdmin.from("orders").select("id,order_number,total_cents").in("id", orderIds),
    supabaseAdmin.from("profiles").select("id,full_name").in("id", customerIds),
    supabaseAdmin.from("stores").select("id,name").in("id", storeIds)
  ]);
  const orderById = new Map(((orders ?? []) as Array<{ id: string; order_number: string; total_cents: number }>).map((o) => [o.id, o]));
  const nameById = new Map(((profiles ?? []) as Array<{ id: string; full_name: string | null }>).map((p) => [p.id, p.full_name]));
  const storeById = new Map(((stores ?? []) as Array<{ id: string; name: string }>).map((s) => [s.id, s.name]));
  return rows.map((row) => ({
    ...row,
    order_number: orderById.get(row.order_id)?.order_number ?? null,
    order_total: orderById.has(row.order_id) ? Number(orderById.get(row.order_id)?.total_cents) : null,
    customer_name: nameById.get(row.customer_id) ?? null,
    store_name: storeById.get(row.store_id) ?? null
  }));
};

export const complaintService = {
  /** Link tạm để trình duyệt tự tải ảnh minh chứng lên (người mua và cửa hàng). Ảnh nằm dưới complaints/ trong kho partner-assets. */
  async createUploadUrl(actorId: string, role: UserRole, contentType: string): Promise<{ path: string; token: string; signed_url: string; public_url: string }> {
    const extension = EVIDENCE_TYPES[contentType];
    if (!extension) throw new AppError("Chỉ nhận ảnh JPG, PNG hoặc WEBP", HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
    const path = `complaints/${role}-${actorId}/${randomUUID()}.${extension}`;
    const bucket = supabaseAdmin.storage.from(EVIDENCE_BUCKET);
    const { data, error } = await bucket.createSignedUploadUrl(path);
    if (error || !data) throw new AppError("Không tạo được link tải ảnh", HTTP_STATUS.INTERNAL_SERVER_ERROR, ERROR_CODES.INTERNAL_SERVER_ERROR);
    return { path, token: data.token, signed_url: data.signedUrl, public_url: bucket.getPublicUrl(path).data.publicUrl };
  },

  async create(customerId: string, body: { order_id: string; reason_code: ReasonCode; issue: string; image_urls: string[]; product_names?: string[] | undefined }): Promise<ComplaintRow> {
    const order = await loadOrder(body.order_id);
    if (order.customer_id !== customerId) throw forbidden("Chỉ người đặt đơn mới được khiếu nại");
    if (order.status !== "completed") throw conflict("Chỉ khiếu nại được đơn đã hoàn tất (đã nhận hàng)");

    const deadline = order.complaint_deadline_at
      ? new Date(order.complaint_deadline_at)
      : order.completed_at ? await complaintDeadlineFor(order.id, new Date(order.completed_at)) : null;
    if (!deadline || Date.now() > deadline.getTime()) {
      throw conflict("Đã quá thời gian báo vấn đề cho đơn này (12 giờ với đồ nấu chín, 24 giờ với hàng còn lại)", ERROR_CODES.COMPLAINT_WINDOW_CLOSED);
    }

    const { data: existing } = await supabaseAdmin.from("complaints").select("id").eq("order_id", order.id).limit(1);
    if (existing && existing.length > 0) throw conflict("Đơn này đã có khiếu nại", ERROR_CODES.COMPLAINT_ALREADY_EXISTS);

    const images = assertEvidenceUrls(body.image_urls);
    if (images.length === 0) throw new AppError("Cần ít nhất 1 ảnh minh chứng", HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);

    let names = body.product_names ?? [];
    if (names.length === 0) {
      const { data: items } = await supabaseAdmin.from("order_items").select("product_name").eq("order_id", order.id);
      names = ((items ?? []) as Array<{ product_name: string }>).map((item) => item.product_name);
    }
    const dueAt = new Date(Date.now() + policyHoursMs(COMPLAINT_STORE_RESPONSE_HOURS)).toISOString();

    const { data, error } = await supabaseAdmin
      .from("complaints")
      .insert({
        order_id: order.id,
        customer_id: customerId,
        store_id: order.store_id,
        product_names: names.length > 0 ? names : ["Đơn hàng"],
        issue: body.issue,
        priority: PRIORITY_BY_REASON[body.reason_code],
        status: "open",
        image_urls: images,
        reason_code: body.reason_code,
        response_due_at: dueAt
      })
      .select("*")
      .single();
    if (error) {
      if (error.code === "23505") throw conflict("Đơn này đã có khiếu nại", ERROR_CODES.COMPLAINT_ALREADY_EXISTS);
      handleSupabaseError(error, "Failed to create complaint");
    }
    const complaint = data as ComplaintRow;
    await notifyStore(
      order.store_id,
      "new-complaint",
      `Khiếu nại mới · đơn ${order.order_number}`,
      `${REASON_LABEL[body.reason_code]}: ${body.issue.slice(0, 140)}. Bạn có ${COMPLAINT_STORE_RESPONSE_HOURS} giờ để phản hồi.`,
      complaint.id
    );
    return complaint;
  },

  /** Danh sách theo vai trò: người mua của mình, cửa hàng của mình, admin tất cả (lọc theo trạng thái) */
  async list(actorId: string, role: UserRole, filter: { status?: string | undefined } = {}): Promise<unknown[]> {
    let query = supabaseAdmin.from("complaints").select("*").order("created_at", { ascending: false }).limit(300);
    if (role === "customer") query = query.eq("customer_id", actorId);
    if (role === "partner") {
      const { data: stores } = await supabaseAdmin.from("stores").select("id").eq("owner_id", actorId);
      const ids = ((stores ?? []) as Array<{ id: string }>).map((s) => s.id);
      query = query.in("store_id", ids.length > 0 ? ids : ["00000000-0000-0000-0000-000000000000"]);
    }
    if (filter.status) query = query.eq("status", filter.status);
    const { data, error } = await query;
    if (error) handleSupabaseError(error, "Failed to list complaints");
    const rows = await enrich((data ?? []) as ComplaintRow[]);
    // Người mua không cần thấy ghi chú nội bộ của admin
    return role === "customer" ? rows.map((row) => ({ ...row, admin_note: null })) : rows;
  },

  /** Cửa hàng phản hồi trong hạn: accept = hoàn 100% và xong; dispute = chuyển Admin quyết định */
  async respond(ownerId: string, complaintId: string, body: { action: "accept" | "dispute"; note?: string | undefined; image_urls?: string[] | undefined }): Promise<ComplaintRow> {
    const complaint = await loadComplaint(complaintId);
    const order = await loadOrder(complaint.order_id);
    if (order.stores?.owner_id !== ownerId) throw forbidden("Chỉ chủ cửa hàng được phản hồi khiếu nại này");
    if (!complaint.reason_code) throw conflict("Khiếu nại cũ: hãy dùng cách xử lý cũ");
    if (complaint.status !== "open" || complaint.store_responded_at) throw conflict("Khiếu nại này đã được phản hồi");
    if (complaint.response_due_at && Date.now() > new Date(complaint.response_due_at).getTime()) {
      await complaintService.escalateOverdue();
      throw conflict("Đã quá thời hạn phản hồi 12 giờ, khiếu nại đã chuyển cho Admin quyết định");
    }
    const images = assertEvidenceUrls(body.image_urls);
    if (body.action === "dispute" && !(body.note && body.note.trim().length >= 5)) {
      throw new AppError("Cần nhập lý do không đồng ý (tối thiểu 5 ký tự)", HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
    }
    const nowIso = new Date().toISOString();
    const patch = body.action === "accept"
      ? {
          status: "resolved", store_response_action: "accept", store_response: body.note ?? null, store_response_images: images, store_responded_at: nowIso,
          decision: "refund_full", refund_cents: Number(order.total_cents), resolution: "Cửa hàng đồng ý hoàn tiền 100%", decided_at: nowIso
        }
      : { status: "in_review", store_response_action: "dispute", store_response: body.note, store_response_images: images, store_responded_at: nowIso, escalated_at: nowIso };

    // Chiếm quyền xử lý bằng điều kiện trạng thái: hai lần bấm / phản hồi đồng thời chỉ có một bên thắng
    const { data, error } = await supabaseAdmin.from("complaints").update(patch).eq("id", complaintId).eq("status", "open").is("store_responded_at", null).select("*").maybeSingle();
    if (error) handleSupabaseError(error, "Failed to respond to complaint");
    if (!data) throw conflict("Khiếu nại vừa được xử lý ở nơi khác, hãy tải lại");
    const updated = data as ComplaintRow;

    if (body.action === "accept") {
      await applyOutcome(updated);
      await notifyCustomer(updated.customer_id, "complaint-decision", "Cửa hàng đồng ý khiếu nại của bạn", `Bạn được hoàn ${money(Number(order.total_cents))} (100%) cho đơn ${order.order_number}.`, complaintId);
    } else {
      await notifyCustomer(updated.customer_id, "complaint-update", "Cửa hàng không đồng ý khiếu nại", `Cửa hàng đã phản hồi và khiếu nại được chuyển cho FoodSave quyết định. Đơn ${order.order_number}.`, complaintId);
      await notifyAdmins(`Khiếu nại cần quyết định · đơn ${order.order_number}`, `Cửa hàng không đồng ý: ${(body.note ?? "").slice(0, 120)}`, complaintId);
    }
    return updated;
  },

  /** Admin quyết định: hoàn đủ / hoàn một phần / bác bỏ (có thể đánh dấu khiếu nại sai) */
  async decide(adminId: string, complaintId: string, body: { decision: Decision; refund_cents?: number | undefined; is_false_claim?: boolean | undefined; note: string }): Promise<ComplaintRow> {
    const complaint = await loadComplaint(complaintId);
    if (!complaint.reason_code) throw conflict("Khiếu nại cũ: hãy dùng cách xử lý cũ");
    if (complaint.decision === body.decision && (complaint.status === "resolved" || complaint.status === "rejected")) return complaint; // lặp lại: không xử lý lần hai
    if (complaint.status !== "in_review") {
      throw conflict(complaint.status === "open" ? "Cửa hàng vẫn còn thời gian phản hồi, chưa thể quyết định" : "Khiếu nại này đã được quyết định");
    }
    const order = await loadOrder(complaint.order_id);
    const total = Number(order.total_cents);
    let refund = 0;
    if (body.decision === "refund_full") refund = total;
    if (body.decision === "refund_partial") {
      refund = Number(body.refund_cents);
      if (!Number.isInteger(refund) || refund <= 0 || refund >= total) {
        throw new AppError(`Số tiền hoàn một phần phải lớn hơn 0 và nhỏ hơn tổng đơn (${money(total)})`, HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
      }
    }
    if (body.is_false_claim && body.decision !== "reject") {
      throw new AppError("Chỉ đánh dấu khiếu nại sai khi bác bỏ", HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
    }

    const nowIso = new Date().toISOString();
    const summary = body.decision === "reject" ? `Admin bác bỏ khiếu nại: ${body.note}` : body.decision === "refund_full" ? `Admin quyết định hoàn 100% (${money(refund)}): ${body.note}` : `Admin quyết định hoàn một phần ${money(refund)}: ${body.note}`;
    const { data, error } = await supabaseAdmin
      .from("complaints")
      .update({
        status: body.decision === "reject" ? "rejected" : "resolved",
        decision: body.decision,
        refund_cents: refund,
        is_false_claim: body.decision === "reject" ? Boolean(body.is_false_claim) : false,
        admin_note: body.note,
        resolution: summary,
        decided_by: adminId,
        decided_at: nowIso,
        resolved_at: nowIso
      })
      .eq("id", complaintId)
      .eq("status", "in_review")
      .select("*")
      .maybeSingle();
    if (error) handleSupabaseError(error, "Failed to decide complaint");
    if (!data) throw conflict("Khiếu nại vừa được quyết định ở nơi khác, hãy tải lại");
    const updated = data as ComplaintRow;

    await applyOutcome(updated);

    if (body.decision === "reject") {
      await notifyCustomer(updated.customer_id, "complaint-decision", "Khiếu nại bị bác bỏ", `FoodSave đã xem xét và bác bỏ khiếu nại đơn ${order.order_number}. ${body.note}`, complaintId);
      await notifyStore(updated.store_id, "complaint-decision", "Khiếu nại đã được bác bỏ", `FoodSave bác bỏ khiếu nại đơn ${order.order_number}. Bạn không bị trừ điểm.`, complaintId);
    } else {
      await notifyCustomer(updated.customer_id, "complaint-decision", "Khiếu nại được chấp nhận", `Bạn được hoàn ${money(refund)} cho đơn ${order.order_number}. ${body.note}`, complaintId);
      await notifyStore(updated.store_id, "complaint-decision", "Khiếu nại đúng: bị trừ điểm uy tín", `FoodSave chấp nhận khiếu nại đơn ${order.order_number} (hoàn ${money(refund)}). Cửa hàng bị trừ 15 điểm uy tín và số tiền hoàn được trừ vào ví.`, complaintId);
    }
    return updated;
  },

  /** Tác vụ định kỳ: khiếu nại quá hạn phản hồi 12 giờ thì tự chuyển Admin */
  async escalateOverdue(): Promise<number> {
    const nowIso = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from("complaints")
      .select("id")
      .eq("status", "open")
      .not("reason_code", "is", null)
      .is("store_responded_at", null)
      .lt("response_due_at", nowIso)
      .limit(200);
    if (error) handleSupabaseError(error, "Failed to load overdue complaints");
    let done = 0;
    for (const row of (data ?? []) as Array<{ id: string }>) {
      const { data: moved } = await supabaseAdmin
        .from("complaints")
        .update({ status: "in_review", escalated_at: nowIso })
        .eq("id", row.id)
        .eq("status", "open")
        .is("store_responded_at", null)
        .select("*")
        .maybeSingle();
      if (!moved) continue;
      done += 1;
      const c = moved as ComplaintRow;
      await notifyStore(c.store_id, "complaint-escalated", "Khiếu nại quá hạn phản hồi", `Bạn chưa phản hồi trong ${COMPLAINT_STORE_RESPONSE_HOURS} giờ nên khiếu nại chuyển cho FoodSave quyết định.`, c.id);
      await notifyCustomer(c.customer_id, "complaint-update", "Khiếu nại được chuyển cho FoodSave", "Cửa hàng chưa phản hồi đúng hạn nên FoodSave sẽ quyết định.", c.id);
      await notifyAdmins("Khiếu nại quá hạn cửa hàng phản hồi", "Cần Admin quyết định.", c.id);
    }
    return done;
  },

  /** Tác vụ định kỳ: hoàn tất các quyết định hoàn tiền còn dang dở (lần xử lý trước bị lỗi giữa chừng). Idempotent. */
  async completePendingOutcomes(): Promise<number> {
    const { data, error } = await supabaseAdmin
      .from("complaints")
      .select("*")
      .eq("status", "resolved")
      .in("decision", ["refund_full", "refund_partial"])
      .limit(50);
    if (error) handleSupabaseError(error, "Failed to load resolved complaints");
    let done = 0;
    for (const c of (data ?? []) as ComplaintRow[]) {
      const { data: order } = await supabaseAdmin.from("orders").select("settlement_status").eq("id", c.order_id).maybeSingle();
      const status = (order as { settlement_status?: string } | null)?.settlement_status;
      if (status === "refunded" || status === "partially_refunded") continue;
      try {
        await applyOutcome(c);
        done += 1;
      } catch (e) {
        logger.warn("Chưa hoàn tất được hệ quả của khiếu nại", { complaintId: c.id, error: e });
      }
    }
    return done;
  },

  /** Khiếu nại CŨ (không có reason_code): cửa hàng / admin đổi trạng thái như trước Đợt 3 */
  async legacyUpdate(actorId: string, role: UserRole, complaintId: string, body: { status: "open" | "in_review" | "resolved" | "rejected"; resolution?: string | undefined }): Promise<unknown> {
    const complaint = await loadComplaint(complaintId);
    if (complaint.reason_code) throw conflict("Khiếu nại này dùng luồng mới: cửa hàng phản hồi (respond), admin quyết định (decision)");
    const order = await loadOrder(complaint.order_id);
    if (role !== "admin" && order.stores?.owner_id !== actorId) throw forbidden("Chỉ chủ cửa hàng được phản hồi khiếu nại này");
    const { data, error } = await supabaseAdmin
      .from("complaints")
      .update({ status: body.status, resolution: body.resolution ?? null, resolved_at: body.status === "resolved" ? new Date().toISOString() : null })
      .eq("id", complaintId)
      .select("*")
      .single();
    if (error) handleSupabaseError(error, "Failed to update complaint");
    await notifyCustomer(complaint.customer_id, "complaint-update", "Khiếu nại của bạn đã được cập nhật", body.resolution ?? `Trạng thái: ${body.status}`, complaintId);
    return data;
  }
};
