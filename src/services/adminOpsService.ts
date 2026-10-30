/**
 * Đợt 4b: các màn Admin dùng dữ liệu thật — quản lý nhãn, hàng đợi xác minh hồ sơ, voucher, báo cáo ESG theo tháng,
 * cảnh báo gian lận (tự tính từ dữ liệu có sẵn) và dải việc cần làm của bảng điều khiển.
 * Mọi con số lấy từ database; thứ gì không phát hiện được thì nói rõ ở `not_detected`, không bịa số.
 */
import { ERROR_CODES } from "../constants/errors";
import { HTTP_STATUS } from "../constants/http";
import { AppError } from "../utils/appError";
import { adminAuditService, type AuditActor } from "./adminAuditService";
import { adminService } from "./adminService";
import { createNotification } from "./notificationService";
import { handleSupabaseError, supabaseAdmin } from "./supabaseService";

type Row = Record<string, any>;

const DAY_MS = 86_400_000;
const loadNames = async (table: string, ids: string[], columns: string): Promise<Map<string, Row>> => {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const { data, error } = await supabaseAdmin.from(table).select(columns).in("id", unique);
  if (error) handleSupabaseError(error, `Failed to load ${table}`);
  return new Map(((data ?? []) as unknown as Row[]).map((row) => [String(row.id), row]));
};

/* ───────────── Quản lý nhãn ───────────── */
const labelOverview = async (): Promise<{ counts: Record<string, number>; total: number; lots: Row[] }> => {
  const { data, error } = await supabaseAdmin
    .from("products")
    .select("id,store_id,name,label,stock_quantity,expires_at,effective_deadline_at,price_cents,original_price_cents,label_changed_at")
    .eq("is_active", true)
    .gt("stock_quantity", 0)
    .order("expires_at", { ascending: true })
    .limit(500);
  if (error) handleSupabaseError(error, "Failed to load products for labels");
  const products = (data ?? []) as Row[];
  const stores = await loadNames("stores", products.map((p) => p.store_id), "id,name");
  const counts: Record<string, number> = { green: 0, yellow: 0, red: 0 };
  for (const product of products) { const key = String(product.label); if (key in counts) counts[key] = (counts[key] ?? 0) + 1; }
  const rank: Record<string, number> = { red: 0, yellow: 1, green: 2 };
  const lots = products
    .map((p) => ({
      id: p.id, name: p.name, store_name: stores.get(String(p.store_id))?.name ?? "—", label: p.label,
      stock_quantity: p.stock_quantity, expires_at: p.expires_at, effective_deadline_at: p.effective_deadline_at ?? null,
      price_cents: p.price_cents, original_price_cents: p.original_price_cents, label_changed_at: p.label_changed_at ?? null
    }))
    .sort((a, b) => (rank[a.label] ?? 3) - (rank[b.label] ?? 3) || String(a.expires_at).localeCompare(String(b.expires_at)));
  return { counts, total: products.length, lots };
};

/* ───────────── Xác minh hồ sơ ───────────── */
const verificationQueue = async (): Promise<{ stores: Row[]; charities: Row[]; history: Row[] }> => {
  const partners = await adminService.getPendingPartners();
  const stores = partners.filter((p) => p.store.status === "pending" || p.profile?.status === "pending").map((p) => ({
    id: p.store.id, kind: "store", name: p.store.name, address: p.store.address, district: p.store.district ?? null,
    owner_id: p.userId, owner_name: p.profile?.full_name ?? "", phone: p.profile?.phone ?? "", created_at: p.store.created_at
  }));
  const { data, error } = await supabaseAdmin
    .from("charity_profiles")
    .select("id,owner_id,name,phone,email,address,district,beneficiaries_count,created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) handleSupabaseError(error, "Failed to load pending charities");
  const charities = ((data ?? []) as Row[]).map((c) => ({ ...c, kind: "charity" }));
  const history = (await adminAuditService.list(300)).filter((row) => String(row.action).startsWith("verification.")).slice(0, 30);
  return { stores, charities, history };
};

const decideVerification = async (kind: "store" | "charity", id: string, decision: "approve" | "reject", reason: string | undefined, actor: AuditActor): Promise<{ kind: string; id: string; decision: string }> => {
  if (decision === "reject" && !(reason && reason.trim())) {
    throw new AppError("Cần nhập lý do từ chối", HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
  }
  if (kind === "store") {
    const { data, error } = await supabaseAdmin.from("stores").select("id,owner_id,name").eq("id", id).maybeSingle();
    if (error) handleSupabaseError(error, "Failed to load store");
    const store = data as Row | null;
    if (!store) throw new AppError("Không tìm thấy cửa hàng", HTTP_STATUS.NOT_FOUND, ERROR_CODES.RESOURCE_NOT_FOUND);
    if (decision === "approve") await adminService.approvePartner(String(store.owner_id));
    else await adminService.rejectPartner(String(store.owner_id), reason as string);
    await createNotification({
      recipientId: String(store.owner_id), roleTarget: "partner", type: "verification-result",
      title: decision === "approve" ? "Cửa hàng đã được duyệt" : "Hồ sơ cửa hàng bị từ chối",
      body: decision === "approve" ? `Cửa hàng ${store.name} đã được FoodSave duyệt, bạn có thể đăng bán.` : `Lý do: ${reason}`
    });
    await adminAuditService.log(actor, `verification.${decision}`, "store", id, { name: store.name, reason: reason ?? null });
    return { kind, id, decision };
  }
  const { data, error } = await supabaseAdmin.from("charity_profiles").select("id,owner_id,name,status").eq("id", id).maybeSingle();
  if (error) handleSupabaseError(error, "Failed to load charity");
  const charity = data as Row | null;
  if (!charity) throw new AppError("Không tìm thấy tổ chức", HTTP_STATUS.NOT_FOUND, ERROR_CODES.RESOURCE_NOT_FOUND);
  const now = new Date().toISOString();
  const approved = decision === "approve";
  const { error: updateError } = await supabaseAdmin.from("charity_profiles").update({
    status: approved ? "active" : "suspended", rejection_reason: approved ? null : reason, reviewed_at: now, approved_by: approved ? actor.userId : null, updated_at: now
  }).eq("id", id);
  if (updateError) handleSupabaseError(updateError, "Failed to update charity");
  if (approved) {
    const { error: profileError } = await supabaseAdmin.from("profiles").update({ status: "active", updated_at: now }).eq("id", charity.owner_id);
    if (profileError) handleSupabaseError(profileError, "Failed to activate charity owner");
  }
  await createNotification({
    recipientId: String(charity.owner_id), roleTarget: "charity", type: "verification-result",
    title: approved ? "Tổ chức đã được duyệt" : "Hồ sơ tổ chức bị từ chối",
    body: approved ? `Tổ chức ${charity.name} đã được FoodSave duyệt.` : `Lý do: ${reason}`
  });
  await adminAuditService.log(actor, `verification.${decision}`, "charity", id, { name: charity.name, reason: reason ?? null });
  return { kind, id, decision };
};

/* ───────────── Voucher (dùng chung cho Admin và cửa hàng) ───────────── */
export interface VoucherInput {
  code: string; name: string; description?: string | undefined;
  percent_off?: number | undefined; fixed_discount_cents?: number | undefined;
  min_order_cents?: number | undefined; starts_at: string; expires_at: string; max_redemptions?: number | undefined;
}

const VOUCHER_COLUMNS = "id,store_id,code,name,description,percent_off,fixed_discount_cents,min_order_cents,starts_at,expires_at,max_redemptions,redemption_count,is_active,created_at";

const createVoucher = async (storeId: string | null, input: VoucherInput, actor: AuditActor | null): Promise<Row> => {
  const hasPercent = input.percent_off !== undefined;
  const hasFixed = input.fixed_discount_cents !== undefined;
  if (hasPercent === hasFixed) throw new AppError("Chọn đúng một loại giảm: phần trăm hoặc số tiền cố định", HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
  if (new Date(input.expires_at).getTime() <= new Date(input.starts_at).getTime()) throw new AppError("Ngày hết hạn phải sau ngày bắt đầu", HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
  const code = input.code.trim().toUpperCase();
  const { data: existing, error: existingError } = await supabaseAdmin.from("vouchers").select("id").eq("code", code).maybeSingle();
  if (existingError) handleSupabaseError(existingError, "Failed to check voucher code");
  if (existing) throw new AppError("Mã voucher đã tồn tại", HTTP_STATUS.CONFLICT, ERROR_CODES.RESOURCE_CONFLICT);
  const { data, error } = await supabaseAdmin.from("vouchers").insert({
    store_id: storeId, code, name: input.name.trim(), description: (input.description ?? input.name).trim(),
    percent_off: input.percent_off ?? null, fixed_discount_cents: input.fixed_discount_cents ?? null,
    min_order_cents: input.min_order_cents ?? 0, starts_at: input.starts_at, expires_at: input.expires_at,
    max_redemptions: input.max_redemptions ?? null, is_active: true
  }).select(VOUCHER_COLUMNS).single();
  if (error) handleSupabaseError(error, "Failed to create voucher");
  if (actor) await adminAuditService.log(actor, "voucher.create", "voucher", String((data as Row).id), { code, store_id: storeId });
  return data as Row;
};

const toggleVoucher = async (voucherId: string, isActive: boolean, scopeStoreIds: string[] | null, actor: AuditActor | null): Promise<Row> => {
  const { data: found, error: findError } = await supabaseAdmin.from("vouchers").select("id,store_id,code").eq("id", voucherId).maybeSingle();
  if (findError) handleSupabaseError(findError, "Failed to load voucher");
  const voucher = found as Row | null;
  if (!voucher || (scopeStoreIds && !scopeStoreIds.includes(String(voucher.store_id)))) {
    throw new AppError("Không tìm thấy voucher", HTTP_STATUS.NOT_FOUND, ERROR_CODES.RESOURCE_NOT_FOUND);
  }
  const { data, error } = await supabaseAdmin.from("vouchers").update({ is_active: isActive, updated_at: new Date().toISOString() }).eq("id", voucherId).select(VOUCHER_COLUMNS).single();
  if (error) handleSupabaseError(error, "Failed to update voucher");
  if (actor) await adminAuditService.log(actor, isActive ? "voucher.enable" : "voucher.disable", "voucher", voucherId, { code: voucher.code });
  return data as Row;
};

const listVouchers = async (storeIds: string[] | null): Promise<Row[]> => {
  let query = supabaseAdmin.from("vouchers").select(VOUCHER_COLUMNS).order("created_at", { ascending: false }).limit(300);
  if (storeIds) {
    if (storeIds.length === 0) return [];
    query = query.in("store_id", storeIds);
  }
  const { data, error } = await query;
  if (error) handleSupabaseError(error, "Failed to load vouchers");
  const rows = (data ?? []) as Row[];
  const stores = await loadNames("stores", rows.map((v) => v.store_id), "id,name");
  const now = Date.now();
  return rows.map((v) => ({
    ...v,
    store_name: v.store_id ? stores.get(String(v.store_id))?.name ?? "—" : "Toàn sàn",
    state: !v.is_active ? "off" : new Date(v.expires_at).getTime() < now ? "expired" : new Date(v.starts_at).getTime() > now ? "scheduled" : (v.max_redemptions !== null && v.redemption_count >= v.max_redemptions) ? "used_up" : "live"
  }));
};

/* ───────────── ESG theo tháng ───────────── */
const monthRange = (month: string): { start: Date; end: Date } => {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) throw new AppError("Tháng không hợp lệ (dạng YYYY-MM)", HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
  const year = Number(match[1]); const m = Number(match[2]);
  // Tháng theo giờ Việt Nam (UTC+7)
  return { start: new Date(Date.UTC(year, m - 1, 1) - 7 * 3_600_000), end: new Date(Date.UTC(year, m, 1) - 7 * 3_600_000) };
};

const sumEvents = (rows: Row[]) => rows.reduce((acc, row) => ({
  food_saved_kg: acc.food_saved_kg + Number(row.food_saved_kg || 0),
  co2_avoided_kg: acc.co2_avoided_kg + Number(row.co2_avoided_kg || 0),
  water_saved_liters: acc.water_saved_liters + Number(row.water_saved_liters || 0),
  meals_equivalent: acc.meals_equivalent + Number(row.meals_equivalent || 0),
  money_saved_cents: acc.money_saved_cents + Number(row.money_saved_cents || 0),
  events: acc.events + 1
}), { food_saved_kg: 0, co2_avoided_kg: 0, water_saved_liters: 0, meals_equivalent: 0, money_saved_cents: 0, events: 0 });

const round = (value: number): number => Math.round(value * 100) / 100;

const esgReport = async (month: string): Promise<Row> => {
  const { start, end } = monthRange(month);
  const vnStart = new Date(start.getTime() + 7 * 3_600_000);
  const prevStart = new Date(Date.UTC(vnStart.getUTCFullYear(), vnStart.getUTCMonth() - 1, 1) - 7 * 3_600_000);
  const load = async (from: Date, to: Date): Promise<Row[]> => {
    const { data, error } = await supabaseAdmin
      .from("eco_impact_events")
      .select("source_type,store_id,food_saved_kg,co2_avoided_kg,water_saved_liters,meals_equivalent,money_saved_cents,occurred_at")
      .gte("occurred_at", from.toISOString()).lt("occurred_at", to.toISOString()).limit(20000);
    if (error) handleSupabaseError(error, "Failed to load eco impact events");
    return (data ?? []) as Row[];
  };
  const [current, prevMonthRows] = await Promise.all([load(start, end), load(prevStart, start)]);
  const total = sumEvents(current);
  const bySource: Record<string, ReturnType<typeof sumEvents>> = {};
  for (const source of ["order", "donation", "manual_adjustment"]) bySource[source] = sumEvents(current.filter((row) => row.source_type === source));
  const perStore = new Map<string, ReturnType<typeof sumEvents>>();
  for (const row of current) if (row.store_id) perStore.set(String(row.store_id), sumEvents(current.filter((r) => r.store_id === row.store_id)));
  const stores = await loadNames("stores", [...perStore.keys()], "id,name");
  const topStores = [...perStore.entries()].sort((a, b) => b[1].food_saved_kg - a[1].food_saved_kg).slice(0, 5)
    .map(([id, sums]) => ({ store_id: id, store_name: stores.get(id)?.name ?? "—", food_saved_kg: round(sums.food_saved_kg), meals_equivalent: sums.meals_equivalent }));

  const countIn = async (table: string, statusColumn: string, status: string, dateColumn: string): Promise<number> => {
    const { count, error } = await supabaseAdmin.from(table).select("id", { count: "exact", head: true }).eq(statusColumn, status).gte(dateColumn, start.toISOString()).lt(dateColumn, end.toISOString());
    if (error) handleSupabaseError(error, `Failed to count ${table}`);
    return count ?? 0;
  };
  const [ordersCompleted, donationsDone] = await Promise.all([countIn("orders", "status", "completed", "completed_at"), countIn("donations", "status", "completed", "updated_at").catch(() => 0)]);
  const fix = (s: ReturnType<typeof sumEvents>) => ({ ...s, food_saved_kg: round(s.food_saved_kg), co2_avoided_kg: round(s.co2_avoided_kg), water_saved_liters: round(s.water_saved_liters) });
  return {
    month, from: start.toISOString(), to: end.toISOString(), total: fix(total), previous: fix(sumEvents(prevMonthRows)),
    by_source: Object.fromEntries(Object.entries(bySource).map(([k, v]) => [k, fix(v)])), top_stores: topStores,
    orders_completed: ordersCompleted, donations_delivered: donationsDone, has_data: current.length > 0,
    note: "Số liệu lấy từ bảng eco_impact_events (hệ số quy đổi ở bảng eco_impact_factors). Tháng không có sự kiện thì hiển thị 0."
  };
};

/* ───────────── Cảnh báo gian lận (tự tính) ───────────── */
export interface FraudAlert {
  key: string; type: string; severity: "low" | "medium" | "high"; subject_type: "customer" | "order" | "ip";
  subject_id: string; subject_name: string; description: string; metrics: Record<string, unknown>;
  status: "open" | "handled" | "dismissed"; handled_at: string | null; note: string | null;
}

const fraudAlerts = async (): Promise<{ alerts: FraudAlert[]; not_detected: string[] }> => {
  const now = Date.now();
  const since60 = new Date(now - 60 * DAY_MS).toISOString();
  const { data: orderData, error } = await supabaseAdmin
    .from("orders")
    .select("id,order_number,customer_id,status,payment_status,total_cents,created_at")
    .gte("created_at", since60).order("created_at", { ascending: false }).limit(10000);
  if (error) handleSupabaseError(error, "Failed to load orders for fraud check");
  const orders = (orderData ?? []) as Row[];
  const raw: Array<Omit<FraudAlert, "status" | "handled_at" | "note" | "subject_name"> & { subject_name?: string }> = [];

  const byCustomer = new Map<string, Row[]>();
  for (const order of orders) byCustomer.set(String(order.customer_id), [...(byCustomer.get(String(order.customer_id)) ?? []), order]);
  for (const [customerId, list] of byCustomer) {
    const last30 = list.filter((o) => new Date(o.created_at).getTime() >= now - 30 * DAY_MS && o.status !== "awaiting_payment");
    const bad30 = last30.filter((o) => o.status === "cancelled" || o.status === "no_show").length;
    if (last30.length >= 5 && bad30 / last30.length >= 0.5) {
      raw.push({ key: `high_cancel_rate:${customerId}`, type: "high_cancel_rate", severity: bad30 / last30.length >= 0.8 ? "high" : "medium", subject_type: "customer", subject_id: customerId,
        description: `${bad30}/${last30.length} đơn trong 30 ngày bị hủy hoặc vắng mặt (${Math.round(bad30 / last30.length * 100)}%)`, metrics: { orders_30d: last30.length, cancelled_or_no_show: bad30 } });
    }
    const noShows = list.filter((o) => o.status === "no_show").length;
    if (noShows >= 2) {
      raw.push({ key: `repeat_no_show:${customerId}`, type: "repeat_no_show", severity: noShows >= 3 ? "high" : "medium", subject_type: "customer", subject_id: customerId,
        description: `Vắng mặt ${noShows} lần trong 60 ngày`, metrics: { no_show_60d: noShows } });
    }
  }
  for (const order of orders) {
    if (order.status === "awaiting_payment" && now - new Date(order.created_at).getTime() > 30 * 60_000) {
      raw.push({ key: `long_pending_payment:${order.id}`, type: "long_pending_payment", severity: "low", subject_type: "order", subject_id: String(order.id), subject_name: `#${order.order_number}`,
        description: `Đơn #${order.order_number} chờ thanh toán hơn 30 phút (đã quá hạn nhưng chưa bị hủy)`, metrics: { minutes_pending: Math.round((now - new Date(order.created_at).getTime()) / 60_000), total_cents: order.total_cents } });
    }
  }

  // Nhiều tài khoản cùng địa chỉ IP đăng nhập (tín hiệu yếu: wifi dùng chung cũng trùng IP)
  const { data: logData, error: logError } = await supabaseAdmin
    .from("auth_audit_logs").select("user_id,ip_address,created_at").eq("event_type", "LOGIN_SUCCESS")
    .gte("created_at", new Date(now - 7 * DAY_MS).toISOString()).limit(20000);
  if (!logError) {
    const byIp = new Map<string, Set<string>>();
    for (const log of (logData ?? []) as Row[]) {
      if (!log.ip_address || !log.user_id) continue;
      byIp.set(String(log.ip_address), (byIp.get(String(log.ip_address)) ?? new Set()).add(String(log.user_id)));
    }
    for (const [ip, users] of byIp) {
      if (users.size >= 3) raw.push({ key: `shared_ip:${ip}`, type: "shared_ip", severity: users.size >= 5 ? "medium" : "low", subject_type: "ip", subject_id: ip, subject_name: ip,
        description: `${users.size} tài khoản đăng nhập từ cùng một địa chỉ IP trong 7 ngày (có thể chỉ là wifi dùng chung)`, metrics: { accounts: users.size } });
    }
  }

  const customerNames = await loadNames("profiles", raw.filter((a) => a.subject_type === "customer").map((a) => a.subject_id), "id,full_name");
  const { data: statusData } = await supabaseAdmin.from("fraud_alert_status").select("alert_key,status,note,handled_at").limit(5000);
  const statuses = new Map(((statusData ?? []) as Row[]).map((row) => [String(row.alert_key), row]));
  const order: Record<string, number> = { high: 0, medium: 1, low: 2 };
  const alerts = raw.map((a): FraudAlert => {
    const st = statuses.get(a.key);
    return { ...a, subject_name: a.subject_name ?? customerNames.get(a.subject_id)?.full_name ?? "(chưa đặt tên)", status: (st?.status as FraudAlert["status"]) ?? "open", handled_at: st?.handled_at ?? null, note: st?.note ?? null };
  }).sort((a, b) => (a.status === "open" ? 0 : 1) - (b.status === "open" ? 0 : 1) || order[a.severity]! - order[b.severity]!);
  return {
    alerts,
    not_detected: [
      "Thiết bị dùng chung / vân tay thiết bị: hệ thống chưa thu thập nên không phát hiện được.",
      "Địa chỉ IP chỉ là tín hiệu yếu (wifi công cộng, mạng nhà dùng chung có thể trùng).",
      "Dùng chung thẻ / ví thanh toán: chưa có dữ liệu (thanh toán đang mô phỏng).",
      "Đánh giá giả, hoàn tiền bất thường theo cửa hàng: chưa có quy tắc."
    ]
  };
};

const handleFraudAlert = async (key: string, status: "handled" | "dismissed", note: string | undefined, actor: AuditActor): Promise<{ key: string; status: string }> => {
  if (!/^(high_cancel_rate|repeat_no_show|long_pending_payment|shared_ip):[\w.:\-]{1,80}$/.test(key)) {
    throw new AppError("Mã cảnh báo không hợp lệ", HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
  }
  const { error } = await supabaseAdmin.from("fraud_alert_status").upsert({ alert_key: key, status, note: note ?? null, handled_by: actor.userId, handled_at: new Date().toISOString() }, { onConflict: "alert_key" });
  if (error) handleSupabaseError(error, "Failed to save fraud alert status");
  await adminAuditService.log(actor, `fraud.${status}`, "fraud_alert", key, { note: note ?? null });
  return { key, status };
};

/* ───────────── Dải việc cần làm của bảng điều khiển ───────────── */
const workStrip = async (): Promise<Row> => {
  const count = async (table: string, apply: (q: any) => any): Promise<number> => {
    try {
      const { count: n, error } = await apply(supabaseAdmin.from(table).select("id", { count: "exact", head: true }));
      return error ? 0 : (n ?? 0);
    } catch { return 0; }
  };
  const [pendingStores, pendingCharities, complaintsReview, withdrawals, payoutAccounts, locked] = await Promise.all([
    count("stores", (q) => q.eq("status", "pending")),
    count("charity_profiles", (q) => q.eq("status", "pending")),
    count("complaints", (q) => q.eq("status", "in_review")),
    count("withdrawals", (q) => q.eq("status", "requested")),
    count("payout_accounts", (q) => q.eq("status", "pending_verification")),
    count("profiles", (q) => q.eq("role", "customer").gt("red_ban_until", new Date().toISOString()))
  ]);
  let fraudOpen = 0;
  try { fraudOpen = (await fraudAlerts()).alerts.filter((a) => a.status === "open").length; } catch { fraudOpen = 0; }
  return {
    verification_pending: pendingStores + pendingCharities, complaints_waiting_admin: complaintsReview,
    withdrawals_pending: withdrawals + payoutAccounts, fraud_open: fraudOpen, customers_locked: locked
  };
};

export const adminOpsService = {
  labelOverview, verificationQueue, decideVerification,
  createVoucher, toggleVoucher, listVouchers,
  esgReport, fraudAlerts, handleFraudAlert, workStrip
};
