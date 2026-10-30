/**
 * Kiểm thử MÔ PHỎNG quy trình đơn hàng trả trước (Đợt 1): chạy code thật của orderService, orderAutomationService,
 * customerReputationService, orderChatService trên một database giả trong bộ nhớ (scripts/fake-supabase.js).
 * Không kết nối mạng, không chạm Supabase thật. Phần sổ cái tiền (kịch bản 1 mục tiền, 14-16) thuộc Đợt 2.
 *
 * Chạy: npm run build && node scripts/test-order-flow.js
 */
// Chặn mọi khả năng chạm hệ thống thật: biến môi trường giả được đặt TRƯỚC khi nạp mã
Object.assign(process.env, {
  SUPABASE_URL: "http://127.0.0.1:9", SUPABASE_ANON_KEY: "x", SUPABASE_SERVICE_ROLE_KEY: "x", CORS_ORIGINS: "http://localhost",
  DATABASE_URL: "postgres://x:x@127.0.0.1:9/x", DEMO_MODE: "false", ORDER_POLICY_TIME_SCALE: "1", LOG_LEVEL: "error",
  PAYMENT_PROVIDER: "simulated", PAYOUT_PROVIDER: "manual", PAYOUT_ENCRYPTION_KEY: require("crypto").randomBytes(32).toString("base64")
});
const assert = require("assert");
const { FakeDb } = require("./fake-supabase");

let db = new FakeDb();
const sb = require("../dist/config/supabase");
sb.supabaseAdmin = {
  from: (name) => db.from(name),
  rpc: (name, args) => db.rpc(name, args),
  storage: { from: (bucket) => ({
    createSignedUploadUrl: async (path) => ({ data: { token: "t-" + path, signedUrl: "http://127.0.0.1:9/upload/" + path }, error: null }),
    getPublicUrl: (path) => ({ data: { publicUrl: "http://127.0.0.1:9/storage/v1/object/public/" + bucket + "/" + path } })
  }) }
};
require("../dist/config/postgres").isPostgresAvailable = async () => false;

const { orderService } = require("../dist/services/orderService");
const { orderAutomationService } = require("../dist/services/orderAutomationService");
const { customerReputationService } = require("../dist/services/customerReputationService");
const { orderChatService } = require("../dist/services/orderChatService");
const { ledgerService } = require("../dist/services/ledgerService");
const crypto = require("crypto");
const { env } = require("../dist/config/env");
const payoutCrypto = require("../dist/utils/payoutCrypto");
const payoutAccountModule = require("../dist/services/payoutAccountService");
const payoutAccountService = Object.assign({}, payoutAccountModule.payoutAccountService, { namesMatch: payoutAccountModule.namesMatch });
const { registerPayoutProvider } = require("../dist/services/payouts");
const { registerPaymentProvider } = require("../dist/services/payments");
const { hmacSha256Hex, safeEqualHex, headerValue, invalidSignature } = require("../dist/services/payments/paymentProvider");
const { paymentWebhookService } = require("../dist/services/paymentWebhookService");
const { orderController } = require("../dist/controllers/orderController");
const { complaintService } = require("../dist/services/complaintService");
const pushModule = require("../dist/services/pushService");
const pushService = pushModule.pushService;
const notificationModule = require("../dist/services/notificationService");
const pushActorMiddleware = require("../dist/middlewares/pushAuth");
const policyModule = require("../dist/constants/orderPolicy");
const policyConfigService = Object.assign({}, require("../dist/services/policyConfigService"));
const automationRunService = require("../dist/services/automationRunService");
const adminOpsService = require("../dist/services/adminOpsService");
const partnerOpsService = require("../dist/services/partnerOpsService");
partnerOpsService.maskPhone = partnerOpsService.maskPhone;

const OWNER = "owner-1", CUST = "cust-1", OTHER = "cust-2", OTHER_OWNER = "owner-2", ADMIN = "admin-1";
const MIN = 60000, HOUR = 3600000;
const iso = (ms) => new Date(Date.now() + ms).toISOString();

function reset(points = 100) {
  db = new FakeDb();
  db.seedSystemWallets();
  db.seed("profiles", [
    { id: CUST, role: "customer", full_name: "Khách A", points, rank: "Tin cậy", red_ban_until: null },
    { id: OTHER, role: "customer", full_name: "Khách B", points: 100, rank: "Tin cậy", red_ban_until: null }
  ]);
  db.seed("stores", [{ id: "s-1", owner_id: OWNER, name: "Tiệm Thử" }]);
  db.seed("partner_profiles", [{ profile_id: OWNER, store_id: "s-1", legal_name: "NGUYỄN VĂN A" }]);
  db.seed("seller_reputation", [{ seller_id: "s-1", trust_score: 100, rating_avg: 5, status: "Active" }]);
  const mk = (id, label, hours) => ({
    id, store_id: "s-1", name: "Bánh " + label, price_cents: 50000, original_price_cents: 100000, stock_quantity: 50, sold_count: 0,
    is_active: true, category: "Bánh ngọt / bánh tươi", label, expires_at: iso(hours * HOUR), effective_deadline_at: iso(hours * HOUR),
    emoji: "🥐", estimated_weight_kg: null, servings_count: null, food_group: "cooked", blocked_reason: null
  });
  db.seed("products", [mk("p-green", "green", 20), mk("p-yellow", "yellow", 8), mk("p-red", "red", 3)]);
}

const body = (productId, qty = 2) => ({ items: [{ product_id: productId, quantity: qty }], pickup_slot_key: "policy", payment_method: "momo", donation_cents: 0 });
const create = async (productId = "p-yellow", qty = 2) => (await orderService.createOrder(CUST, body(productId, qty))).order;
const pay = (o) => orderService.confirmPayment(CUST, "customer", o.id, "momo");
const partner = (o, status) => orderService.updateOrderStatus(OWNER, "partner", o.id, { status, is_charity_order: false });
const row = (id) => db.table("orders").find((o) => o.id === id);
const prod = (id) => db.table("products").find((p) => p.id === id);
const points = () => db.table("profiles").find((p) => p.id === CUST).points;
const notes = (filter) => db.table("notifications").filter(filter);
const rejects = async (fn, code) => {
  try { await fn(); } catch (error) { assert.strictEqual(error.code, code, "mã lỗi mong đợi " + code + " nhưng nhận " + error.code + " · " + error.message); return; }
  assert.fail("lẽ ra phải lỗi " + code);
};

const results = [];
const scenario = async (name, fn) => {
  try { reset(); await fn(); results.push([true, name]); console.log("  ĐẠT   " + name); }
  catch (error) { results.push([false, name]); console.log("  KHÔNG ĐẠT   " + name + "\n         " + (error && error.message || error)); }
};

(async () => {
  console.log("\nKiểm thử quy trình đơn hàng trả trước (database giả trong bộ nhớ)\n");

  await scenario("1. Mua đủ vòng: đặt → trả → nhận → sẵn sàng → QR → hoàn tất", async () => {
    db.table("profiles").find((p) => p.id === CUST).points = 90;
    const o = await create("p-yellow");
    assert.strictEqual(o.status, "awaiting_payment");
    assert.strictEqual(o.policy_label, "yellow");
    const payWindow = new Date(o.pay_deadline).getTime() - Date.now();
    assert.ok(payWindow > 9 * MIN && payWindow <= 10 * MIN + 2000, "hạn thanh toán nhãn vàng ~10 phút");
    assert.strictEqual(notes((n) => n.recipient_id === OWNER).length, 0, "cửa hàng KHÔNG được báo ở bước tạo đơn");
    assert.strictEqual(prod("p-yellow").stock_quantity, 48, "giữ kho ngay khi đặt");

    const paid = await pay(o);
    assert.strictEqual(paid.status, "pending");
    assert.strictEqual(paid.payment_status, "paid");
    assert.strictEqual(paid.settlement_status, "held");
    const pickup = new Date(paid.pickup_deadline).getTime() - new Date(paid.paid_at).getTime();
    assert.ok(Math.abs(pickup - 90 * MIN) < 2000, "hạn lấy nhãn vàng = 90 phút sau thanh toán");
    const free = new Date(paid.pickup_deadline).getTime() - new Date(paid.cancel_free_until).getTime();
    assert.ok(Math.abs(free - 20 * MIN) < 2000, "hủy miễn phí đến trước hạn lấy 20 phút");
    assert.strictEqual(notes((n) => n.recipient_id === OWNER && n.type === "order-paid").length, 1, "cửa hàng được báo khi đã thanh toán");
    assert.strictEqual(notes((n) => n.recipient_id === CUST && n.type === "order-paid").length, 1, "người mua được báo hạn lấy hàng");
    assert.ok(db.table("order_messages").some((m) => m.sender_role === "system"), "chat mở sau thanh toán");

    await partner(o, "confirmed");
    await partner(o, "ready");
    const done = await partner(o, "completed");
    assert.strictEqual(done.status, "completed");
    assert.strictEqual(done.settlement_status, "released");
    const window = new Date(done.complaint_deadline_at).getTime() - new Date(done.completed_at).getTime();
    assert.ok(Math.abs(window - 12 * HOUR) < 2000, "đồ nấu chín: hạn khiếu nại 12 giờ");
    assert.strictEqual(points(), 95, "người mua +5 điểm");
  });

  await scenario("2. Không trả tiền: quá 5 phút (nhãn đỏ) → tự hủy, hàng về kho, cửa hàng không thấy đơn", async () => {
    const o = await create("p-red");
    assert.ok(Math.abs(new Date(o.pay_deadline).getTime() - Date.now() - 5 * MIN) < 2000, "hạn thanh toán nhãn đỏ = 5 phút");
    assert.strictEqual(prod("p-red").stock_quantity, 48);
    row(o.id).pay_deadline = iso(-MIN);
    const result = await orderAutomationService.run();
    assert.strictEqual(result.payment_timeouts, 1);
    assert.strictEqual(row(o.id).status, "cancelled");
    assert.strictEqual(row(o.id).cancel_reason, "payment_timeout");
    assert.strictEqual(row(o.id).cancelled_by, "system");
    assert.strictEqual(prod("p-red").stock_quantity, 50, "hàng trả về kho");
    assert.strictEqual(points(), 100, "không tính lỗi người mua");
    const list = await orderService.listOrders(OWNER, "partner", { page: 1, limit: 20 });
    assert.strictEqual(list.items.length, 0, "cửa hàng không thấy đơn chưa thanh toán / hết hạn trả");
    await rejects(() => pay(row(o.id)), "PAYMENT_EXPIRED");
  });

  await scenario("2b. Quá hạn mà bấm thanh toán: bị từ chối PAYMENT_EXPIRED và đơn bị hủy", async () => {
    const o = await create("p-green");
    row(o.id).pay_deadline = iso(-MIN);
    await rejects(() => pay(o), "PAYMENT_EXPIRED");
    assert.strictEqual(row(o.id).status, "cancelled");
    assert.strictEqual(prod("p-green").stock_quantity, 50);
  });

  await scenario("3. Hủy miễn phí: hoàn 100%, hàng về kho, không trừ điểm", async () => {
    const o = await pay(await create("p-yellow"));
    const result = await orderService.cancelByCustomer(CUST, o.id, {});
    assert.strictEqual(result.refunded, true);
    assert.strictEqual(result.refund_cents, o.total_cents);
    const after = row(o.id);
    assert.strictEqual(after.status, "cancelled");
    assert.strictEqual(after.payment_status, "refunded");
    assert.strictEqual(after.settlement_status, "refunded");
    assert.strictEqual(prod("p-yellow").stock_quantity, 50);
    assert.strictEqual(points(), 100);
  });

  await scenario("4. Hủy muộn: không hoàn, tiền thuộc cửa hàng, người mua −5 điểm, hàng về kho nếu còn hạn", async () => {
    const o = await pay(await create("p-yellow"));
    row(o.id).cancel_free_until = iso(-MIN);
    const result = await orderService.cancelByCustomer(CUST, o.id, {});
    assert.strictEqual(result.refunded, false);
    assert.strictEqual(result.refund_cents, 0);
    const after = row(o.id);
    assert.strictEqual(after.payment_status, "paid");
    assert.strictEqual(after.settlement_status, "forfeited");
    assert.strictEqual(points(), 95, "−5 điểm");
    assert.strictEqual(prod("p-yellow").stock_quantity, 50, "còn đủ hạn → trả về kho");
    assert.ok(!db.table("order_events").some((e) => e.event_type === "stock_not_restored"), "không có cảnh báo không-trả-kho");
  });

  await scenario("4a. Xem trước hủy (app): khớp kết quả hủy thật, không ghi gì, đơn người khác bị từ chối", async () => {
    const o = await pay(await create("p-yellow"));
    const before = JSON.stringify(row(o.id));
    const free = await orderService.previewCancel(CUST, o.id);
    assert.deepStrictEqual([free.can_cancel, free.paid, free.free, free.refund_cents, free.penalty_points], [true, true, true, o.total_cents, 0]);
    assert.strictEqual(JSON.stringify(row(o.id)), before, "xem trước không đổi đơn");
    row(o.id).cancel_free_until = iso(-MIN);
    const late = await orderService.previewCancel(CUST, o.id);
    assert.deepStrictEqual([late.free, late.refund_cents, late.penalty_points], [false, 0, 5]);
    await assert.rejects(() => orderService.previewCancel("nguoi-khac", o.id), (e) => e.statusCode === 403);
    const result = await orderService.cancelByCustomer(CUST, o.id, {});
    assert.strictEqual(result.refund_cents, late.refund_cents, "kết quả thật = kết quả xem trước");
    assert.strictEqual(points(), 100 - late.penalty_points);
    const done = await orderService.previewCancel(CUST, o.id);
    assert.strictEqual(done.can_cancel, false, "đơn đã hủy thì không hủy được nữa");
  });

  await scenario("4b. Hủy muộn khi sản phẩm sắp hết hạn: KHÔNG trả về kho, ghi nhật ký đơn", async () => {
    const o = await pay(await create("p-yellow"));
    prod("p-yellow").effective_deadline_at = iso(10 * MIN); // còn 10 phút < 15 phút
    row(o.id).cancel_free_until = iso(-MIN);
    await orderService.cancelByCustomer(CUST, o.id, {});
    assert.strictEqual(prod("p-yellow").stock_quantity, 48, "không trả về kho");
    const ev = db.table("order_events").find((e) => e.event_type === "stock_not_restored");
    assert.ok(ev, "có nhật ký đơn");
    assert.strictEqual(ev.detail.skipped[0].why, "con_duoi_15_phut_toi_han");
  });

  await scenario("4c. Hủy muộn khi sản phẩm bị chặn: KHÔNG trả về kho", async () => {
    const o = await pay(await create("p-yellow"));
    prod("p-yellow").blocked_reason = "Đã hết thời gian bán";
    prod("p-yellow").is_active = false;
    row(o.id).cancel_free_until = iso(-MIN);
    await orderService.cancelByCustomer(CUST, o.id, {});
    assert.strictEqual(prod("p-yellow").stock_quantity, 48);
    assert.strictEqual(db.table("order_events")[0].detail.skipped[0].why, "san_pham_bi_chan_hoac_ngung_ban");
  });

  await scenario("5. Vắng mặt ×3: −15 mỗi lần, cảnh báo lần 2, khóa nhãn đỏ 30 ngày lần 3; nhãn xanh/vàng vẫn đặt được", async () => {
    const goNoShow = async () => {
      const o = await pay(await create("p-yellow", 1));
      row(o.id).pickup_deadline = iso(-6 * MIN);
      const result = await orderAutomationService.run();
      assert.strictEqual(result.no_shows, 1);
      assert.strictEqual(row(o.id).status, "no_show");
      assert.strictEqual(row(o.id).settlement_status, "forfeited");
      assert.ok(row(o.id).no_show_at);
      assert.ok(notes((n) => n.recipient_id === CUST && n.type === "order-no-show").length >= 1, "người mua được báo");
      assert.ok(notes((n) => n.recipient_id === OWNER && n.type === "order-no-show").length >= 1, "cửa hàng được báo");
      return o;
    };
    await goNoShow();
    assert.strictEqual(points(), 85);
    assert.strictEqual(notes((n) => n.type === "no-show-warning").length, 0);
    await goNoShow();
    assert.strictEqual(points(), 70);
    assert.strictEqual(notes((n) => n.type === "no-show-warning").length, 1, "cảnh báo lần 2");
    await goNoShow();
    assert.strictEqual(points(), 55);
    const ban = db.table("profiles").find((p) => p.id === CUST).red_ban_until;
    assert.ok(ban && Math.abs(new Date(ban).getTime() - Date.now() - 30 * 24 * HOUR) < 5000, "khóa nhãn đỏ 30 ngày");
    assert.strictEqual(notes((n) => n.type === "red-label-banned").length, 1);
    await rejects(() => create("p-red", 1), "RED_LABEL_BANNED");
    const ok1 = await create("p-green", 1);
    const ok2 = await create("p-yellow", 1);
    assert.ok(ok1.id && ok2.id, "nhãn xanh/vàng vẫn đặt được");
  });

  await scenario("5b. Hàng no-show về kho nếu còn đủ hạn", async () => {
    const o = await pay(await create("p-yellow", 3));
    row(o.id).pickup_deadline = iso(-6 * MIN);
    await orderAutomationService.run();
    assert.strictEqual(prod("p-yellow").stock_quantity, 50);
  });

  await scenario("6. Điểm < 40: CUSTOMER_BLOCKED; admin mở khóa rồi đặt lại được", async () => {
    db.table("profiles").find((p) => p.id === CUST).points = 30;
    await rejects(() => create("p-green", 1), "CUSTOMER_BLOCKED");
    const result = await customerReputationService.unlock(CUST, "đã làm việc với khách");
    assert.strictEqual(result.points, 40);
    const o = await create("p-green", 1);
    assert.strictEqual(o.status, "awaiting_payment");
    assert.strictEqual(notes((n) => n.type === "account-unlocked").length, 1);
  });

  await scenario("7. Cửa hàng hủy / hết hàng: hoàn 100%, hàng về kho", async () => {
    const o = await pay(await create("p-yellow"));
    const out = await partner(o, "cancelled");
    assert.strictEqual(out.status, "cancelled");
    assert.strictEqual(out.payment_status, "refunded");
    assert.strictEqual(out.settlement_status, "refunded");
    assert.strictEqual(out.cancelled_by, "store");
    assert.strictEqual(prod("p-yellow").stock_quantity, 50);
    assert.strictEqual(points(), 100, "người mua không bị trừ");
  });

  await scenario("8. Nhắc nhở: sau thanh toán, giữa chừng, nhắc cuối; cron chạy lại không gửi trùng", async () => {
    const o = await pay(await create("p-yellow", 1));
    assert.strictEqual(notes((n) => n.type === "order-paid" && n.recipient_id === CUST).length, 1, "(1) ngay sau thanh toán");
    const paidAt = Date.now() - 50 * MIN; // qua nửa của 90 phút
    row(o.id).paid_at = new Date(paidAt).toISOString();
    row(o.id).pickup_deadline = new Date(paidAt + 90 * MIN).toISOString();
    let r = await orderAutomationService.run();
    assert.strictEqual(r.reminders_mid, 1);
    assert.strictEqual(r.reminders_final, 0);
    r = await orderAutomationService.run();
    assert.strictEqual(r.reminders_mid, 0, "không gửi trùng nhắc giữa chừng");
    row(o.id).pickup_deadline = iso(10 * MIN); // còn 10 phút ≤ 15
    r = await orderAutomationService.run();
    assert.strictEqual(r.reminders_final, 1);
    r = await orderAutomationService.run();
    assert.strictEqual(r.reminders_final, 0, "không gửi trùng nhắc cuối");
    assert.strictEqual(notes((n) => n.type === "order-reminder-mid").length, 1);
    assert.strictEqual(notes((n) => n.type === "order-reminder-final").length, 1);
  });

  await scenario("9. Hoàn tất quá hạn lấy hàng + 5 phút → PICKUP_EXPIRED; trong 5 phút gia hạn thì được", async () => {
    const late = await pay(await create("p-yellow", 1));
    row(late.id).pickup_deadline = iso(-10 * MIN);
    await rejects(() => partner(late, "completed"), "PICKUP_EXPIRED");
    assert.strictEqual(row(late.id).status, "pending");
    const grace = await pay(await create("p-green", 1));
    row(grace.id).pickup_deadline = iso(-3 * MIN);
    const done = await partner(grace, "completed");
    assert.strictEqual(done.status, "completed");
  });

  await scenario("9b. Cửa hàng chỉ đánh dấu vắng mặt SAU hạn lấy hàng", async () => {
    const o = await pay(await create("p-yellow", 1));
    await assert.rejects(() => partner(o, "no_show"), (e) => e.statusCode === 409);
    row(o.id).pickup_deadline = iso(-6 * MIN);
    const out = await partner(o, "no_show");
    assert.strictEqual(out.status, "no_show");
  });

  await scenario("15. Chống trùng: thanh toán / hoàn tất / hủy lặp lại không xử lý hai lần", async () => {
    const o = await create("p-yellow", 1);
    const first = await pay(o);
    const second = await pay(o);
    assert.strictEqual(first.paid_at, second.paid_at, "thanh toán lần 2 không đổi giờ trả");
    assert.strictEqual(notes((n) => n.type === "order-paid" && n.recipient_id === OWNER).length, 1);
    await partner(o, "confirmed");
    await partner(o, "completed");
    const pts = points();
    await partner(o, "completed");
    assert.strictEqual(points(), pts, "hoàn tất lần 2 không cộng điểm lại");
    await assert.rejects(() => orderService.cancelByCustomer(CUST, o.id, {}), (e) => e.statusCode === 409);
    const o2 = await pay(await create("p-green", 2));
    await orderService.cancelByCustomer(CUST, o2.id, {});
    await assert.rejects(() => orderService.cancelByCustomer(CUST, o2.id, {}), (e) => e.statusCode === 409);
    assert.strictEqual(prod("p-green").stock_quantity, 50, "chỉ trả kho một lần");
  });

  await scenario("19. Chat: đúng người, đóng khi đơn kết thúc, giới hạn tốc độ, admin chỉ đọc khi có khiếu nại", async () => {
    const o = await pay(await create("p-yellow", 1));
    await orderChatService.send(o.id, CUST, "customer", "Mình đến lúc 6 giờ nhé");
    await orderChatService.send(o.id, OWNER, "partner", "Dạ cửa hàng đã giữ hàng");
    const view = await orderChatService.list(o.id, CUST, "customer");
    assert.strictEqual(view.messages.filter((m) => m.sender_role !== "system").length, 2);
    assert.strictEqual(view.can_send, true);
    assert.strictEqual(notes((n) => n.type === "order-chat" && n.recipient_id === OWNER).length, 1, "cửa hàng được báo");
    assert.strictEqual(notes((n) => n.type === "order-chat" && n.recipient_id === CUST).length, 1, "người mua được báo");
    await rejects(() => orderChatService.list(o.id, OTHER, "customer"), "CHAT_FORBIDDEN");
    await rejects(() => orderChatService.send(o.id, OTHER_OWNER, "partner", "xin chào"), "CHAT_FORBIDDEN");
    await rejects(() => orderChatService.list(o.id, ADMIN, "admin"), "CHAT_FORBIDDEN");
    await rejects(() => orderChatService.send(o.id, ADMIN, "admin", "xin chào"), "CHAT_FORBIDDEN");
    db.seed("complaints", [{ id: "c-1", order_id: o.id, status: "open" }]);
    const adminView = await orderChatService.list(o.id, ADMIN, "admin");
    assert.strictEqual(adminView.can_send, false, "admin chỉ đọc");
    assert.ok(adminView.messages.length >= 3);

    for (let i = 0; i < 19; i += 1) await orderChatService.send(o.id, CUST, "customer", "tin " + i); // đủ 20 tin trong phút này
    await rejects(() => orderChatService.send(o.id, CUST, "customer", "tin thứ 21 trong một phút"), "CHAT_RATE_LIMITED");

    await partner(o, "completed");
    await rejects(() => orderChatService.send(o.id, OWNER, "partner", "cảm ơn"), "CHAT_CLOSED");
    const closed = await orderChatService.list(o.id, CUST, "customer");
    assert.strictEqual(closed.can_send, false);
    assert.ok(closed.messages.length > 3, "vẫn xem lại được");
    assert.ok(closed.messages.some((m) => m.sender_role === "system" && /kết thúc/.test(m.body)), "có tin hệ thống đơn đã kết thúc");
  });

  await scenario("19b. Chat: đơn chưa thanh toán thì chưa có cuộc trò chuyện", async () => {
    const unpaid = await create("p-yellow", 1);
    const view = await orderChatService.list(unpaid.id, CUST, "customer");
    assert.deepStrictEqual(view.messages, []);
    assert.strictEqual(view.can_send, false);
    await rejects(() => orderChatService.send(unpaid.id, CUST, "customer", "xin chào"), "CHAT_CLOSED");
  });

  await scenario("Danh sách đơn của cửa hàng: ẩn đơn chưa thanh toán, hiện đơn đã trả", async () => {
    await create("p-green", 1);
    const paid = await pay(await create("p-yellow", 1));
    const list = await orderService.listOrders(OWNER, "partner", { page: 1, limit: 20 });
    assert.deepStrictEqual(list.items.map((x) => x.id), [paid.id]);
    const mine = await orderService.listOrders(CUST, "customer", { page: 1, limit: 20 });
    assert.strictEqual(mine.items.length, 2, "người mua thấy cả đơn chờ thanh toán");
  });

  // ───────────────────────── Đợt 2: sổ cái tiền ─────────────────────────
  const W = { ext: "w-external", esc: "w-escrow", plat: "w-platform", char: "w-charity", store: "w-store-s-1" };
  const bal = (id) => { const w = db.wallet(id); return w ? w.balance_cents : 0; };
  const entriesOf = (orderId) => db.table("ledger_entries").filter((e) => e.order_id === orderId);
  const totalAllWallets = () => db.table("wallets").reduce((t, w) => t + w.balance_cents, 0);
  const createD = async (donation = 3000, qty = 2, productId = "p-yellow") => (await orderService.createOrder(CUST, { ...body(productId, qty), donation_cents: donation })).order;
  const expectBalanced = async () => {
    assert.strictEqual(totalAllWallets(), 0, "tổng số dư mọi ví phải bằng 0");
    const check = await ledgerService.reconcile();
    assert.strictEqual(check.ok, true, "đối soát phải khớp: " + JSON.stringify(check));
  };

  await scenario("L1. Thanh toán → giữ chờ; hoàn tất → ví cửa hàng +100.000, doanh thu +2.000, quỹ từ thiện +3.000, escrow về 0", async () => {
    const o = await pay(await createD(3000, 2));
    assert.strictEqual(o.total_cents, 105000);
    assert.strictEqual(bal(W.esc), 105000, "escrow giữ toàn bộ");
    assert.strictEqual(bal(W.ext), -105000);
    assert.strictEqual(entriesOf(o.id).length, 1);
    await partner(o, "completed");
    assert.strictEqual(bal(W.esc), 0);
    assert.strictEqual(bal(W.store), 100000);
    assert.strictEqual(bal(W.plat), 2000);
    assert.strictEqual(bal(W.char), 3000);
    assert.strictEqual(entriesOf(o.id).length, 4);
    await expectBalanced();
  });

  await scenario("L2. Hủy miễn phí: escrow → external 100%, mọi ví về 0", async () => {
    const o = await pay(await createD(0, 2));
    await orderService.cancelByCustomer(CUST, o.id, {});
    assert.strictEqual(bal(W.esc), 0);
    assert.strictEqual(bal(W.ext), 0);
    assert.strictEqual(bal(W.store), 0);
    assert.deepStrictEqual(entriesOf(o.id).map((e) => e.entry_type).sort(), ["charge", "refund"]);
    await expectBalanced();
  });

  await scenario("L3. Hủy muộn: không hoàn, tiền thuộc cửa hàng (trừ phí), metadata.reason = late_cancel", async () => {
    const o = await pay(await createD(0, 2));
    row(o.id).cancel_free_until = iso(-MIN);
    await orderService.cancelByCustomer(CUST, o.id, {});
    assert.strictEqual(bal(W.store), 100000);
    assert.strictEqual(bal(W.plat), 2000);
    assert.strictEqual(bal(W.esc), 0);
    assert.ok(entriesOf(o.id).filter((e) => e.entry_type === "release").every((e) => e.metadata.reason === "late_cancel"));
    await expectBalanced();
  });

  await scenario("L4. Vắng mặt: forfeited, reason = no_show, tiền thuộc cửa hàng", async () => {
    const o = await pay(await createD(0, 2));
    row(o.id).pickup_deadline = iso(-6 * MIN);
    await orderAutomationService.run();
    assert.strictEqual(row(o.id).status, "no_show");
    assert.strictEqual(bal(W.store), 100000);
    assert.ok(entriesOf(o.id).filter((e) => e.entry_type === "release").every((e) => e.metadata.reason === "no_show"));
    await expectBalanced();
  });

  await scenario("L5. Cửa hàng hủy: hoàn 100% từ escrow", async () => {
    const o = await pay(await createD(3000, 2));
    await partner(o, "cancelled");
    assert.strictEqual(bal(W.ext), 0);
    assert.strictEqual(bal(W.esc), 0);
    assert.strictEqual(bal(W.store), 0);
    await expectBalanced();
  });

  // ───────────────────────── Phần A: nhà cung cấp thanh toán / chi trả / tài khoản nhận tiền ─────────────────────────
  const ACC_NUMBER = "0123456789012";
  const verifiedAccount = async (holder = "NGUYEN VAN A") => {
    const created = await payoutAccountService.submit("s-1", { bank_name: "Vietcombank", account_holder_name: holder, account_number: ACC_NUMBER });
    return payoutAccountService.decide(created.id, true, ADMIN, "đã đối chiếu");
  };
  const fundStore = async (qty) => { const o = await pay(await createD(0, qty)); await partner(o, "completed"); return o; };
  const noPlainNumber = (value, label) => {
    const text = JSON.stringify(value);
    assert.ok(!text.includes(ACC_NUMBER), label + ": lộ số tài khoản đầy đủ");
    assert.ok(!text.includes("account_number_encrypted"), label + ": lộ cột mã hóa");
    assert.ok(!text.includes("v1:"), label + ": lộ chuỗi mã hóa");
  };

  await scenario("L6. Rút tiền: tài khoản chưa xác minh không rút được; vượt số dư bị từ chối; hợp lệ → requested", async () => {
    await fundStore(5); // cửa hàng nhận 250.000
    await rejects(() => ledgerService.requestWithdrawal("s-1", 100000), "ACCOUNT_NOT_VERIFIED"); // chưa có tài khoản
    const pending = await payoutAccountService.submit("s-1", { bank_name: "Vietcombank", account_holder_name: "NGUYEN VAN A", account_number: ACC_NUMBER });
    await rejects(() => ledgerService.requestWithdrawal("s-1", 100000), "ACCOUNT_NOT_VERIFIED"); // đang chờ duyệt
    await payoutAccountService.decide(pending.id, true, ADMIN, undefined);
    await rejects(() => ledgerService.requestWithdrawal("s-1", 300000), "INSUFFICIENT_BALANCE");
    await assert.rejects(() => ledgerService.requestWithdrawal("s-1", 10000), (e) => e.statusCode === 400, "dưới mức tối thiểu 50.000đ");
    const w1 = await ledgerService.requestWithdrawal("s-1", 100000);
    assert.strictEqual(w1.status, "requested");
    assert.strictEqual(w1.account_last4, "9012");
    const b = await ledgerService.getStoreBalance("s-1");
    assert.deepStrictEqual([b.balance, b.pending_withdrawals, b.available], [250000, 100000, 150000]);
    await rejects(() => ledgerService.requestWithdrawal("s-1", 200000), "INSUFFICIENT_BALANCE"); // khả dụng chỉ còn 150.000
    noPlainNumber(w1, "lệnh rút");
  });

  await scenario("L6b. Vòng đời lệnh rút: requested → approved → processing → paid; chỉ paid mới trừ ví; mỗi bước ghi người + thời gian", async () => {
    await fundStore(5);
    await verifiedAccount();
    const w = await ledgerService.requestWithdrawal("s-1", 100000);
    assert.strictEqual(bal(W.store), 250000);
    await rejects(() => ledgerService.transitionWithdrawal(w.id, "pay", ADMIN, { bank_txn_ref: "FT001" }), "PAYOUT_INVALID_TRANSITION"); // chưa duyệt mà chi
    const approved = await ledgerService.transitionWithdrawal(w.id, "approve", ADMIN, { note: "ok" });
    assert.strictEqual(approved.status, "approved");
    assert.strictEqual(approved.approved_by, ADMIN);
    assert.ok(approved.approved_at);
    assert.strictEqual(bal(W.store), 250000, "duyệt chưa trừ ví");
    const processing = await ledgerService.transitionWithdrawal(w.id, "start", ADMIN);
    assert.strictEqual(processing.status, "processing");
    assert.strictEqual(processing.processing_by, ADMIN);
    assert.strictEqual(bal(W.store), 250000, "đang chi chưa trừ ví");
    await assert.rejects(() => ledgerService.transitionWithdrawal(w.id, "pay", ADMIN, {}), (e) => e.statusCode === 400, "bắt buộc có mã giao dịch ngân hàng");
    const paid = await ledgerService.transitionWithdrawal(w.id, "pay", ADMIN, { bank_txn_ref: "FT20261029001" });
    assert.strictEqual(paid.status, "paid");
    assert.strictEqual(paid.bank_txn_ref, "FT20261029001");
    assert.strictEqual(paid.paid_by, ADMIN);
    assert.ok(paid.paid_at);
    assert.strictEqual(bal(W.store), 150000, "paid mới trừ ví");
    assert.strictEqual(db.table("ledger_entries").filter((e) => e.entry_type === "withdraw").length, 1);
    await rejects(() => ledgerService.transitionWithdrawal(w.id, "fail", ADMIN, { note: "muộn rồi" }), "PAYOUT_INVALID_TRANSITION");
    assert.ok(notes((n) => n.type === "withdrawal-update" && n.title === "Đã chi tiền rút").length === 1, "chủ cửa hàng được báo khi đã chi");
    await expectBalanced();
  });

  await scenario("L6c. Duyệt và chi đều IDEMPOTENT: lặp lại / chạy đồng thời không trừ ví hai lần", async () => {
    await fundStore(5);
    await verifiedAccount();
    const w = await ledgerService.requestWithdrawal("s-1", 100000);
    const a1 = await ledgerService.transitionWithdrawal(w.id, "approve", ADMIN);
    const a2 = await ledgerService.transitionWithdrawal(w.id, "approve", ADMIN);
    assert.strictEqual(a1.approved_at, a2.approved_at, "duyệt lần 2 không đổi gì");
    assert.strictEqual(notes((n) => n.type === "withdrawal-update" && n.title === "Lệnh rút tiền đã được duyệt").length, 1, "không báo trùng");
    await ledgerService.transitionWithdrawal(w.id, "start", ADMIN);
    await ledgerService.transitionWithdrawal(w.id, "start", ADMIN);
    await Promise.all(Array.from({ length: 5 }, () => ledgerService.transitionWithdrawal(w.id, "pay", ADMIN, { bank_txn_ref: "FT-SAME" })));
    assert.strictEqual(db.table("ledger_entries").filter((e) => e.entry_type === "withdraw").length, 1, "chỉ một bút toán rút");
    assert.strictEqual(bal(W.store), 150000);
    await expectBalanced();
  });

  await scenario("L6d. Chi thất bại / từ chối: số dư khả dụng được trả lại, không có bút toán rút", async () => {
    await fundStore(5);
    await verifiedAccount();
    const w1 = await ledgerService.requestWithdrawal("s-1", 100000);
    await ledgerService.transitionWithdrawal(w1.id, "approve", ADMIN);
    await ledgerService.transitionWithdrawal(w1.id, "start", ADMIN);
    await assert.rejects(() => ledgerService.transitionWithdrawal(w1.id, "fail", ADMIN, {}), (e) => e.statusCode === 400, "phải có lý do");
    const failed = await ledgerService.transitionWithdrawal(w1.id, "fail", ADMIN, { note: "ngân hàng báo sai số tài khoản" });
    assert.strictEqual(failed.status, "failed");
    assert.strictEqual(failed.failed_by, ADMIN);
    const w2 = await ledgerService.requestWithdrawal("s-1", 200000); // vừa vặn nhờ khoản giữ chỗ đã được trả lại
    await ledgerService.transitionWithdrawal(w2.id, "reject", ADMIN, { note: "sai thông tin" });
    const b = await ledgerService.getStoreBalance("s-1");
    assert.deepStrictEqual([b.balance, b.pending_withdrawals, b.available, b.withdrawn], [250000, 0, 250000, 0]);
    assert.strictEqual(db.table("ledger_entries").filter((e) => e.entry_type === "withdraw").length, 0);
    await expectBalanced();
  });

  await scenario("L7. Hai lệnh rút gửi CÙNG LÚC, tổng vượt số dư: chỉ một lệnh thành công", async () => {
    await fundStore(3); // 150.000
    await verifiedAccount();
    const results2 = await Promise.allSettled([ledgerService.requestWithdrawal("s-1", 100000), ledgerService.requestWithdrawal("s-1", 100000)]);
    assert.strictEqual(results2.filter((r) => r.status === "fulfilled").length, 1);
    assert.strictEqual(results2.filter((r) => r.status === "rejected" && r.reason.code === "INSUFFICIENT_BALANCE").length, 1);
    assert.strictEqual(db.table("withdrawals").length, 1);
  });

  await scenario("A1. Tài khoản nhận tiền được MÃ HÓA; API không bao giờ trả số đầy đủ", async () => {
    const created = await payoutAccountService.submit("s-1", { bank_name: "Vietcombank", account_holder_name: "NGUYEN VAN A", account_number: "0123 456 789 012" });
    const row = db.table("store_payout_accounts")[0];
    assert.ok(row.account_number_encrypted.startsWith("v1:"), "lưu dạng mã hóa");
    assert.ok(!row.account_number_encrypted.includes("0123456789012"), "bản mã không chứa số gốc");
    assert.strictEqual(row.account_last4, "9012");
    assert.strictEqual(payoutCrypto.decryptAccountNumber(row.account_number_encrypted), "0123456789012", "giải mã khứ hồi đúng");
    const other = payoutCrypto.encryptAccountNumber("0123456789012");
    assert.notStrictEqual(other, row.account_number_encrypted, "mỗi lần mã hóa dùng IV khác nhau");
    assert.throws(() => payoutCrypto.decryptAccountNumber(row.account_number_encrypted.slice(0, -4) + "AAAA"), /Không giải mã/, "dữ liệu bị sửa thì không giải mã được");
    assert.throws(() => payoutCrypto.decryptAccountNumber(row.account_number_encrypted, crypto.randomBytes(32).toString("base64")), /Không giải mã/, "sai khóa thì không giải mã được");
    // mọi kết quả API chỉ có bản che
    noPlainNumber(created, "submit");
    noPlainNumber(await payoutAccountService.getForStore("s-1"), "getForStore");
    noPlainNumber(await payoutAccountService.listForAdmin(), "listForAdmin");
    await fundStore(5);
    await payoutAccountService.decide(created.id, true, ADMIN, "ok");
    noPlainNumber(await payoutAccountService.decide(created.id, true, ADMIN, "ok"), "decide");
    const w = await ledgerService.requestWithdrawal("s-1", 100000);
    noPlainNumber(await ledgerService.listWithdrawals("s-1"), "listWithdrawals");
    noPlainNumber(await ledgerService.listAllWithdrawals(), "listAllWithdrawals");
    noPlainNumber(await ledgerService.getStoreBalance("s-1"), "getStoreBalance");
    noPlainNumber(await ledgerService.listStoreEntries("s-1"), "listStoreEntries");
    noPlainNumber(await ledgerService.transitionWithdrawal(w.id, "approve", ADMIN), "transition");
    assert.ok(created.account_last4 === "9012" && created.bank_name === "Vietcombank" && created.account_holder_name === "NGUYEN VAN A");
  });

  await scenario("A1b. Thiếu / sai khóa mã hóa: từ chối lưu, KHÔNG bao giờ lưu số tài khoản dạng rõ", async () => {
    const saved = env.PAYOUT_ENCRYPTION_KEY;
    env.PAYOUT_ENCRYPTION_KEY = undefined;
    await rejects(() => payoutAccountService.submit("s-1", { bank_name: "VCB", account_holder_name: "A", account_number: ACC_NUMBER }), "PROVIDER_NOT_CONFIGURED");
    env.PAYOUT_ENCRYPTION_KEY = "khong-phai-khoa-hop-le";
    await rejects(() => payoutAccountService.submit("s-1", { bank_name: "VCB", account_holder_name: "A", account_number: ACC_NUMBER }), "PROVIDER_NOT_CONFIGURED");
    env.PAYOUT_ENCRYPTION_KEY = saved;
    assert.strictEqual(db.table("store_payout_accounts").length, 0, "không lưu gì");
    await assert.rejects(() => payoutAccountService.submit("s-1", { bank_name: "VCB", account_holder_name: "A", account_number: "12ab" }), (e) => e.statusCode === 400);
  });

  await scenario("A2. Đổi tài khoản: tài khoản cũ thành 'replaced', mới chờ xác minh và CHƯA rút được; từ chối thì không rút được", async () => {
    await fundStore(5);
    const first = await verifiedAccount();
    await ledgerService.requestWithdrawal("s-1", 50000); // rút được với tài khoản đã xác minh
    const second = await payoutAccountService.submit("s-1", { bank_name: "Techcombank", account_holder_name: "NGUYEN VAN A", account_number: "9876543210" });
    const rows = db.table("store_payout_accounts");
    assert.strictEqual(rows.find((r) => r.id === first.id).status, "replaced");
    assert.strictEqual(rows.find((r) => r.id === second.id).status, "pending_verification");
    await rejects(() => ledgerService.requestWithdrawal("s-1", 50000), "ACCOUNT_NOT_VERIFIED");
    await payoutAccountService.decide(second.id, false, ADMIN, "ảnh chụp không rõ");
    await rejects(() => ledgerService.requestWithdrawal("s-1", 50000), "ACCOUNT_NOT_VERIFIED");
    assert.strictEqual((await payoutAccountService.getForStore("s-1")).current, null);
    assert.ok(notes((n) => n.type === "payout-account-decision").length >= 1, "chủ cửa hàng được báo");
  });

  await scenario("A3. Admin xác minh: tên chủ tài khoản lệch tên đăng ký kinh doanh → cảnh báo, bắt buộc có ghi chú", async () => {
    const acc = await payoutAccountService.submit("s-1", { bank_name: "BIDV", account_holder_name: "TRAN THI B", account_number: ACC_NUMBER });
    await assert.rejects(() => payoutAccountService.decide(acc.id, true, ADMIN, undefined), (e) => e.statusCode === 409, "lệch tên phải có ghi chú");
    const verified = await payoutAccountService.decide(acc.id, true, ADMIN, "chủ cửa hàng xác nhận qua điện thoại");
    assert.strictEqual(verified.holder_name_match, false);
    assert.strictEqual(verified.warning, "name_mismatch");
    assert.strictEqual(verified.status, "verified");
    const listed = (await payoutAccountService.listForAdmin()).find((r) => r.id === acc.id);
    assert.strictEqual(listed.registered_name, "NGUYỄN VĂN A");
    // khớp tên (bỏ dấu, không phân biệt hoa thường) thì không cảnh báo
    const ok = await payoutAccountService.submit("s-1", { bank_name: "BIDV", account_holder_name: "nguyen van a", account_number: ACC_NUMBER });
    const okVerified = await payoutAccountService.decide(ok.id, true, ADMIN, undefined);
    assert.strictEqual(okVerified.holder_name_match, true);
    assert.strictEqual(okVerified.warning, null);
    assert.ok(payoutAccountService.namesMatch("Nguyễn  Văn A", "NGUYEN VAN A"));
    assert.ok(!payoutAccountService.namesMatch("", ""));
  });

  await scenario("A4. Xem số đầy đủ để chi trả: mỗi lần giải mã có nhật ký; không có nhật ký thì không giải mã; chỉ lệnh đã duyệt", async () => {
    await fundStore(5);
    await verifiedAccount();
    const w = await ledgerService.requestWithdrawal("s-1", 100000);
    await rejects(() => payoutAccountService.revealForWithdrawal(w.id, ADMIN, "admin_manual_payout"), "PAYOUT_INVALID_TRANSITION"); // chưa duyệt
    assert.strictEqual(db.table("payout_access_log").length, 0);
    await ledgerService.transitionWithdrawal(w.id, "approve", ADMIN);
    const shown = await payoutAccountService.revealForWithdrawal(w.id, ADMIN, "admin_manual_payout");
    assert.strictEqual(shown.account_number, ACC_NUMBER);
    assert.strictEqual(shown.account_holder_name, "NGUYEN VAN A");
    assert.strictEqual(db.table("payout_access_log").length, 1, "một lần xem = một dòng nhật ký");
    const log = db.table("payout_access_log")[0];
    assert.strictEqual(log.admin_id, ADMIN);
    assert.strictEqual(log.withdrawal_id, w.id);
    assert.ok(log.created_at);
    await payoutAccountService.revealForWithdrawal(w.id, ADMIN, "admin_manual_payout");
    assert.strictEqual(db.table("payout_access_log").length, 2, "xem lần nữa ghi thêm một dòng");
    // ghi nhật ký lỗi => đóng cửa an toàn: không giải mã
    db.failInsert.payout_access_log = true;
    await assert.rejects(() => payoutAccountService.revealForWithdrawal(w.id, ADMIN, "admin_manual_payout"), (e) => e.statusCode === 500);
    db.failInsert.payout_access_log = false;
    assert.strictEqual(db.table("payout_access_log").length, 2);
    // bắt đầu chi bằng provider thủ công (không cần số đầy đủ) không giải mã
    await ledgerService.transitionWithdrawal(w.id, "start", ADMIN);
    assert.strictEqual(db.table("payout_access_log").length, 2, "provider thủ công không giải mã");
    // lệnh đã chi xong thì không xem được nữa
    await ledgerService.transitionWithdrawal(w.id, "pay", ADMIN, { bank_txn_ref: "FT777" });
    await rejects(() => payoutAccountService.revealForWithdrawal(w.id, ADMIN, "admin_manual_payout"), "PAYOUT_INVALID_TRANSITION");
  });

  await scenario("A5. Provider chi trả cần số đầy đủ (bank_api): giải mã có nhật ký rồi gọi provider; khung chưa cấu hình báo lỗi rõ", async () => {
    await fundStore(5);
    await verifiedAccount();
    const w = await ledgerService.requestWithdrawal("s-1", 100000);
    await ledgerService.transitionWithdrawal(w.id, "approve", ADMIN);
    const seen = [];
    registerPayoutProvider("test_bank", () => ({ name: "test_bank", needsAccountNumber: true, createPayout: async (wd, account) => { seen.push(account); return { ref: "BANK-REF-1", status: "processing" }; }, getPayoutStatus: async () => ({ status: "processing" }) }));
    env.PAYOUT_PROVIDER = "test_bank";
    const started = await ledgerService.transitionWithdrawal(w.id, "start", ADMIN);
    env.PAYOUT_PROVIDER = "manual";
    assert.strictEqual(started.status, "processing");
    assert.strictEqual(started.payout_ref, "BANK-REF-1");
    assert.strictEqual(seen[0].account_number, ACC_NUMBER, "provider nhận số đầy đủ");
    assert.strictEqual(db.table("payout_access_log").filter((r) => r.reason === "provider_payout").length, 1, "việc giải mã được ghi nhật ký");
    // khung bank_api thật chưa cấu hình
    const w2 = await ledgerService.requestWithdrawal("s-1", 50000);
    await ledgerService.transitionWithdrawal(w2.id, "approve", ADMIN);
    env.PAYOUT_PROVIDER = "bank_api";
    await rejects(() => ledgerService.transitionWithdrawal(w2.id, "start", ADMIN), "PROVIDER_NOT_CONFIGURED");
    env.PAYOUT_PROVIDER = "manual";
    assert.strictEqual(db.table("withdrawals").find((x) => x.id === w2.id).status, "approved", "lỗi provider không làm đổi trạng thái");
  });

  // ───────── thanh toán: nhà cung cấp + webhook ─────────
  const SECRET = "test-webhook-secret";
  const signed = (body) => hmacSha256Hex(`${body.txnId}|${body.orderNumber}|${body.amount}|${body.status}`, SECRET);
  const refunds = [];
  registerPaymentProvider("testsigned", () => ({
    name: "testsigned", supportsWebhook: true, allowsManualConfirm: false,
    createPayment: async (order) => ({ provider: "testsigned", paymentRef: "TS-" + order.order_number, mode: "redirect", payUrl: "https://pay.example/" + order.order_number }),
    verifyCallback: async (payload, headers) => {
      const p = payload || {};
      if (!safeEqualHex(headerValue(headers, "x-signature"), signed(p))) throw invalidSignature();
      return { providerTxnId: String(p.txnId), orderNumber: String(p.orderNumber), amount: Number(p.amount), status: p.status === "ok" ? "paid" : "failed", paymentRef: "TS-" + p.orderNumber };
    },
    refund: async (ref, amount, ctx) => { refunds.push({ ref, amount, ctx }); return { ok: true, refundRef: "TSR-1" }; },
    getStatus: async () => ({ status: "unknown" })
  }));
  const hook = (o, overrides = {}) => { const body = { txnId: "T-" + o.order_number, orderNumber: o.order_number, amount: o.total_cents, status: "ok", ...overrides }; return { body, headers: { "x-signature": signed(body) } }; };

  await scenario("W1. Webhook SAI chữ ký bị từ chối (401), không ghi gì; đơn không đổi", async () => {
    env.PAYMENT_PROVIDER = "testsigned";
    try {
      const o = await createD(0, 2);
      const h = hook(o);
      await rejects(() => paymentWebhookService.handle("testsigned", h.body, { "x-signature": "deadbeef" }), "PAYMENT_SIGNATURE_INVALID");
      await rejects(() => paymentWebhookService.handle("testsigned", { ...h.body, amount: 1 }, h.headers), "PAYMENT_SIGNATURE_INVALID"); // sửa số tiền => chữ ký lệch
      await rejects(() => paymentWebhookService.handle("testsigned", h.body, {}), "PAYMENT_SIGNATURE_INVALID");
      assert.strictEqual(row(o.id).status, "awaiting_payment");
      assert.strictEqual(db.table("payment_events").length, 0);
      assert.strictEqual(bal(W.esc), 0);
    } finally { env.PAYMENT_PROVIDER = "simulated"; }
  });

  await scenario("W2. Webhook đúng chữ ký: đơn thành 'đã thanh toán' qua đúng một đường (hạn, sổ cái, mã tham chiếu); gọi trùng KHÔNG ghi trùng", async () => {
    env.PAYMENT_PROVIDER = "testsigned";
    try {
      const o = (await orderService.createOrder(CUST, { ...body("p-yellow", 2), donation_cents: 3000 })).order;
      assert.strictEqual(row(o.id).payment_provider, "testsigned");
      assert.strictEqual(row(o.id).payment_ref, "TS-" + o.order_number, "lưu mã tham chiếu của nhà cung cấp");
      const h = hook(o);
      const first = await paymentWebhookService.handle("testsigned", h.body, h.headers);
      assert.strictEqual(first.outcome, "paid");
      assert.strictEqual(row(o.id).status, "pending");
      assert.strictEqual(row(o.id).payment_status, "paid");
      assert.ok(row(o.id).pickup_deadline && row(o.id).paid_at);
      assert.strictEqual(bal(W.esc), 105000);
      // gọi lại cùng mã giao dịch (và đồng thời): không xử lý lần hai
      const again = await Promise.all(Array.from({ length: 5 }, () => paymentWebhookService.handle("testsigned", h.body, h.headers)));
      assert.ok(again.every((r) => r.duplicate === true), "mọi lần sau đều là trùng");
      assert.strictEqual(db.table("ledger_entries").filter((e) => e.entry_type === "charge").length, 1);
      assert.strictEqual(bal(W.esc), 105000);
      assert.strictEqual(notes((n) => n.type === "order-paid" && n.recipient_id === OWNER).length, 1, "cửa hàng chỉ được báo một lần");
      assert.strictEqual(db.table("payment_events").length, 1);
      assert.strictEqual(db.table("payment_events")[0].status, "processed");
    } finally { env.PAYMENT_PROVIDER = "simulated"; }
  });

  await scenario("W2b. Hai webhook cùng mã giao dịch đến ĐỒNG THỜI: chỉ một bút toán charge", async () => {
    env.PAYMENT_PROVIDER = "testsigned";
    try {
      const o = await createD(0, 2);
      const h = hook(o);
      await Promise.all(Array.from({ length: 8 }, () => paymentWebhookService.handle("testsigned", h.body, h.headers).catch((e) => e)));
      assert.strictEqual(db.table("ledger_entries").filter((e) => e.entry_type === "charge").length, 1);
      assert.strictEqual(db.table("payment_events").length, 1);
      assert.strictEqual(bal(W.esc), o.total_cents);
    } finally { env.PAYMENT_PROVIDER = "simulated"; }
  });

  await scenario("W3. Webhook lệch số tiền bị từ chối; webhook báo thất bại không đổi đơn; đơn không tồn tại không gây lỗi", async () => {
    env.PAYMENT_PROVIDER = "testsigned";
    try {
      const o = await createD(0, 2);
      const wrong = hook(o, { amount: o.total_cents - 1000, txnId: "T-WRONG" });
      assert.strictEqual((await paymentWebhookService.handle("testsigned", wrong.body, wrong.headers)).outcome, "amount_mismatch");
      assert.strictEqual(row(o.id).status, "awaiting_payment");
      assert.strictEqual(db.table("payment_events").find((e) => e.provider_txn_id === "T-WRONG").status, "rejected");
      const bad = hook(o, { status: "fail", txnId: "T-FAIL" });
      assert.strictEqual((await paymentWebhookService.handle("testsigned", bad.body, bad.headers)).outcome, "failed");
      assert.strictEqual(row(o.id).status, "awaiting_payment");
      const ghost = hook({ order_number: "FS-NOPE", total_cents: 1000 }, { txnId: "T-GHOST" });
      assert.strictEqual((await paymentWebhookService.handle("testsigned", ghost.body, ghost.headers)).outcome, "order_not_found");
    } finally { env.PAYMENT_PROVIDER = "simulated"; }
  });

  await scenario("W4. Thanh toán đến SAU khi đơn hết hạn: không đánh dấu đã trả, tự gọi hoàn tiền cho khách", async () => {
    env.PAYMENT_PROVIDER = "testsigned";
    try {
      refunds.length = 0;
      const o = await createD(0, 2);
      row(o.id).pay_deadline = iso(-MIN);
      const h = hook(o, { txnId: "T-LATE" });
      const result = await paymentWebhookService.handle("testsigned", h.body, h.headers);
      assert.strictEqual(result.outcome, "late_payment_refunded");
      assert.strictEqual(row(o.id).status, "cancelled");
      assert.strictEqual(row(o.id).payment_status, "pending");
      assert.strictEqual(refunds.length, 1, "gọi provider.refund");
      assert.strictEqual(refunds[0].amount, o.total_cents);
      assert.strictEqual(bal(W.esc), 0);
    } finally { env.PAYMENT_PROVIDER = "simulated"; }
  });

  await scenario("W5. Mô phỏng: webhook trả 404; nhà cung cấp không đang dùng cũng 404; cổng thật không cho khách tự bấm 'Đã thanh toán'", async () => {
    await rejects(() => paymentWebhookService.handle("simulated", {}, {}), "RESOURCE_NOT_FOUND");
    await rejects(() => paymentWebhookService.handle("testsigned", {}, {}), "RESOURCE_NOT_FOUND"); // đang dùng simulated
    await rejects(() => paymentWebhookService.handle("momo", {}, {}), "RESOURCE_NOT_FOUND");
    const sim = await createD(0, 1);
    assert.strictEqual(row(sim.id).payment_provider, "simulated");
    assert.strictEqual(row(sim.id).payment_ref, "SIM-" + sim.order_number);
    assert.strictEqual((await pay(sim)).status, "pending", "mô phỏng vẫn cho bấm xác nhận");
    env.PAYMENT_PROVIDER = "testsigned";
    try {
      const real = await createD(0, 1, "p-green");
      await rejects(() => pay(real), "PAYMENT_REQUIRES_PROVIDER");
      assert.strictEqual(row(real.id).status, "awaiting_payment", "không thể tự đánh dấu đã trả");
      assert.strictEqual((await orderService.confirmPayment(ADMIN, "admin", real.id, "momo")).status, "pending", "admin xử lý hỗ trợ vẫn được");
    } finally { env.PAYMENT_PROVIDER = "simulated"; }
  });

  await scenario("W6. Khung MoMo chưa cấu hình: tạo đơn báo lỗi rõ ràng, đơn bị hủy và hàng trả về kho (không để treo)", async () => {
    env.PAYMENT_PROVIDER = "momo";
    try {
      await rejects(() => createD(0, 3), "PROVIDER_NOT_CONFIGURED");
      assert.strictEqual(prod("p-yellow").stock_quantity, 50, "hàng đã trả về kho");
      const cancelled = db.table("orders")[0];
      assert.strictEqual(cancelled.status, "cancelled");
      assert.strictEqual(cancelled.cancel_reason, "payment_provider_error");
      await rejects(() => paymentWebhookService.handle("momo", {}, {}), "PROVIDER_NOT_CONFIGURED");
    } finally { env.PAYMENT_PROVIDER = "simulated"; }
  });

  await scenario("W7. Hoàn tiền qua nhà cung cấp: hủy sớm / cửa hàng hủy gọi provider.refund; lỗi provider ghi nhật ký, không chặn sổ cái", async () => {
    env.PAYMENT_PROVIDER = "testsigned";
    try {
      refunds.length = 0;
      const o = await createD(0, 2);
      const h = hook(o);
      await paymentWebhookService.handle("testsigned", h.body, h.headers);
      await orderService.cancelByCustomer(CUST, o.id, {});
      assert.strictEqual(refunds.length, 1);
      assert.strictEqual(refunds[0].ref, "TS-" + o.order_number);
      assert.strictEqual(refunds[0].amount, o.total_cents);
      assert.ok(db.table("order_events").some((e) => e.event_type === "provider_refund"));
      assert.strictEqual(bal(W.esc), 0);
      // provider lỗi khi hoàn
      registerPaymentProvider("testsigned", () => ({
        name: "testsigned", supportsWebhook: true, allowsManualConfirm: false,
        createPayment: async (order) => ({ provider: "testsigned", paymentRef: "TS-" + order.order_number, mode: "redirect" }),
        verifyCallback: async (payload, headers) => { const p = payload || {}; if (!safeEqualHex(headerValue(headers, "x-signature"), signed(p))) throw invalidSignature(); return { providerTxnId: String(p.txnId), orderNumber: String(p.orderNumber), amount: Number(p.amount), status: "paid", paymentRef: "TS-" + p.orderNumber }; },
        refund: async () => { throw new Error("cổng không phản hồi"); },
        getStatus: async () => ({ status: "unknown" })
      }));
      const o2 = await createD(0, 2, "p-green");
      const h2 = hook(o2);
      await paymentWebhookService.handle("testsigned", h2.body, h2.headers);
      await partner(row(o2.id), "cancelled");
      assert.strictEqual(row(o2.id).status, "cancelled", "hủy vẫn thành công");
      assert.strictEqual(bal(W.esc), 0, "sổ cái vẫn hoàn tiền");
      assert.ok(db.table("order_events").some((e) => e.event_type === "provider_refund_failed" && /không phản hồi/.test(e.detail.error)));
    } finally { env.PAYMENT_PROVIDER = "simulated"; }
  });

  await scenario("W8. Webhook MoMo giả (không chữ ký) bị khóa ngoài DEMO_MODE", async () => {
    const o = await createD(0, 1);
    await assert.rejects(() => orderController.mockMomoWebhook({ validated: { body: { order_id: o.id, resultCode: 0 } } }, { status() { return this; }, json() { return this; } }), (e) => e.statusCode === 404);
    assert.strictEqual(row(o.id).payment_status, "pending");
  });

  await scenario("15 / L8. HAI YÊU CẦU ĐỒNG THỜI cùng một đơn: thanh toán và hoàn tất chỉ tạo MỘT bộ bút toán", async () => {
    const o = await createD(3000, 2);
    const [p1, p2] = await Promise.all([pay(o), pay(o)]);
    assert.strictEqual(p1.paid_at, p2.paid_at);
    assert.strictEqual(db.table("ledger_entries").filter((e) => e.entry_type === "charge").length, 1, "chỉ một bút toán charge");
    assert.strictEqual(bal(W.esc), 105000, "escrow không bị cộng đôi");
    await Promise.allSettled([partner(row(o.id), "completed"), partner(row(o.id), "completed")]);
    assert.strictEqual(entriesOf(o.id).filter((e) => e.entry_type === "release").length, 3, "chỉ ba bút toán release");
    // đồng bộ sổ cái gọi dồn dập vẫn không ghi trùng
    await Promise.all(Array.from({ length: 8 }, () => ledgerService.syncOrder(row(o.id))));
    assert.strictEqual(entriesOf(o.id).length, 4);
    assert.strictEqual(bal(W.store), 100000);
    assert.strictEqual(bal(W.esc), 0);
    await expectBalanced();
  });

  await scenario("L9. Hoàn tiền sau khi đã giải ngân (khiếu nại): lấy lại từ ví cửa hàng; hoàn một phần trừ từ phần cửa hàng trước", async () => {
    const full = await pay(await createD(3000, 2));
    await partner(full, "completed");
    await ledgerService.refundOrder(row(full.id), { reason: "complaint_upheld" });
    assert.strictEqual(bal(W.store), 0);
    assert.strictEqual(bal(W.plat), 0);
    assert.strictEqual(bal(W.char), 0);
    assert.strictEqual(bal(W.ext), 0);
    await ledgerService.refundOrder(row(full.id), { reason: "complaint_upheld" }); // lần 2: không hoàn thêm
    assert.strictEqual(bal(W.store), 0);

    const part = await pay(await createD(3000, 2));
    await partner(part, "completed");
    await ledgerService.refundOrder(row(part.id), { amount: 30000, reason: "complaint_partial" });
    assert.strictEqual(bal(W.store), 70000, "trừ 30.000 từ phần cửa hàng");
    assert.strictEqual(bal(W.plat), 2000);
    assert.strictEqual(bal(W.char), 3000);
    assert.strictEqual(bal(W.ext), -75000, "khách đã trả 105.000, được hoàn 30.000");
    await expectBalanced();
    assert.deepStrictEqual(ledgerService.splitRefund({ store: 100, fee: 20, donation: 30 }, 110), { store: 100, fee: 10, donation: 0 });
  });

  await scenario("L10. Đơn đã thanh toán TRƯỚC khi có sổ cái được tác vụ định kỳ bù bút toán, chạy lại không ghi trùng", async () => {
    const a = await createD(0, 2);
    Object.assign(row(a.id), { status: "pending", payment_status: "paid", paid_at: iso(-HOUR), settlement_status: "held" });
    const b = await createD(0, 2, "p-green");
    Object.assign(row(b.id), { status: "completed", payment_status: "paid", paid_at: iso(-HOUR), completed_at: iso(-HOUR / 2), settlement_status: "released" });
    const c = await createD(0, 2, "p-red");
    Object.assign(row(c.id), { status: "cancelled", payment_status: "refunded", paid_at: iso(-HOUR), settlement_status: "refunded", cancel_reason: "customer_free_cancel" });
    const r1 = await orderAutomationService.run();
    assert.strictEqual(r1.ledger_synced, 3);
    assert.strictEqual(bal(W.esc), 102000, "chỉ đơn a còn giữ chờ");
    assert.strictEqual(bal(W.store), 100000, "đơn b đã giải ngân");
    const count = db.table("ledger_entries").length;
    const r2 = await orderAutomationService.run();
    assert.strictEqual(r2.ledger_synced, 0);
    assert.strictEqual(db.table("ledger_entries").length, count, "chạy lại không ghi thêm");
    await expectBalanced();
  });

  await scenario("L11. Đơn chưa thanh toán không có bút toán nào", async () => {
    const o = await createD(0, 2);
    assert.strictEqual(entriesOf(o.id).length, 0);
    assert.strictEqual(await ledgerService.syncOrder(row(o.id)), false);
    await expectBalanced();
  });

  // ───────────────────────── Đợt 3: khiếu nại ─────────────────────────
  const IMG = (n = "a") => `${env.SUPABASE_URL}/storage/v1/object/public/partner-assets/complaints/customer-${CUST}/${n}.jpg`;
  const STORE_IMG = (n = "s") => `${env.SUPABASE_URL}/storage/v1/object/public/partner-assets/complaints/partner-${OWNER}/${n}.jpg`;
  const completedOrder = async (donation = 3000, qty = 2, productId = "p-yellow") => {
    const o = await pay(await createD(donation, qty, productId));
    await partner(o, "completed");
    return row(o.id);
  };
  const complain = (o, overrides = {}) => complaintService.create(CUST, { order_id: o.id, reason_code: "spoiled_expired", issue: "Bánh có mùi lạ khi mở hộp ra", image_urls: [IMG()], ...overrides });
  const complaintRow = (id) => db.table("complaints").find((c) => c.id === id);
  const violations = () => db.table("seller_violations");
  const trust = () => db.table("seller_reputation")[0].trust_score;

  await scenario("10. Khiếu nại đồng ý: gửi trong hạn có ảnh, cửa hàng accept → hoàn 100% lấy lại từ ví cửa hàng, cửa hàng −15 điểm + seller_violations, người mua nhận thông báo", async () => {
    const o = await completedOrder(3000, 2);
    assert.strictEqual(bal(W.store), 100000);
    const c = await complain(o);
    assert.strictEqual(c.status, "open");
    assert.strictEqual(c.priority, "high");
    const due = new Date(c.response_due_at).getTime() - Date.now();
    assert.ok(Math.abs(due - 12 * HOUR) < 3000, "cửa hàng có 12 giờ phản hồi");
    assert.ok(notes((n) => n.type === "new-complaint" && n.recipient_id === OWNER).length === 1, "cửa hàng được báo");
    const done = await complaintService.respond(OWNER, c.id, { action: "accept" });
    assert.strictEqual(done.status, "resolved");
    assert.strictEqual(done.decision, "refund_full");
    assert.strictEqual(Number(done.refund_cents), o.total_cents);
    assert.strictEqual(bal(W.store), 0, "lấy lại phần cửa hàng");
    assert.strictEqual(bal(W.plat), 0);
    assert.strictEqual(bal(W.char), 0);
    assert.strictEqual(bal(W.ext), 0, "khách được hoàn đủ 105.000");
    assert.strictEqual(row(o.id).settlement_status, "refunded");
    assert.strictEqual(row(o.id).payment_status, "refunded");
    assert.strictEqual(trust(), 85, "cửa hàng −15 điểm");
    assert.strictEqual(violations().length, 1);
    assert.strictEqual(violations()[0].violation_type, "COMPLAINT_UPHELD");
    assert.strictEqual(violations()[0].point_delta, -15);
    assert.strictEqual(violations()[0].metadata.complaint_id, c.id);
    assert.ok(notes((n) => n.type === "complaint-decision" && n.recipient_id === CUST && /hoàn/.test(n.body)).length === 1, "người mua nhận thông báo hoàn tiền");
    assert.ok(db.table("order_events").some((e) => e.event_type === "complaint_provider_refund"), "gọi PaymentProvider.refund");
    await rejects(() => complaintService.respond(OWNER, c.id, { action: "accept" }), "RESOURCE_CONFLICT"); // phản hồi lần 2
    assert.strictEqual(trust(), 85, "phản hồi lặp không trừ điểm lần hai");
    await expectBalanced();
  });

  await scenario("11a. Khiếu nại không đồng ý → Admin hoàn MỘT PHẦN đúng số tiền; quyết định lặp không xử lý hai lần", async () => {
    const o = await completedOrder(3000, 2);
    const c = await complain(o, { reason_code: "missing_items", issue: "Thiếu một hộp bánh so với đơn đã đặt" });
    await assert.rejects(() => complaintService.respond(OWNER, c.id, { action: "dispute" }), (e) => e.statusCode === 400, "phản bác phải có lý do");
    const disputed = await complaintService.respond(OWNER, c.id, { action: "dispute", note: "Đã giao đủ hàng, có camera", image_urls: [STORE_IMG()] });
    assert.strictEqual(disputed.status, "in_review");
    assert.ok(disputed.escalated_at && disputed.store_responded_at);
    assert.strictEqual(disputed.store_response_images.length, 1);
    assert.ok(notes((n) => n.type === "complaint-escalated" && n.role_target === "admin").length >= 1, "admin được báo");
    await rejects(() => complaintService.decide(ADMIN, c.id, { decision: "refund_partial", refund_cents: 0, note: "x lệch" }), "VALIDATION_ERROR").catch(() => {});
    await assert.rejects(() => complaintService.decide(ADMIN, c.id, { decision: "refund_partial", refund_cents: o.total_cents, note: "hoàn đủ nhưng gọi là một phần" }), (e) => e.statusCode === 400);
    await assert.rejects(() => complaintService.decide(ADMIN, c.id, { decision: "refund_partial", refund_cents: 30000.5, note: "số lẻ" }), (e) => e.statusCode === 400);
    const decided = await complaintService.decide(ADMIN, c.id, { decision: "refund_partial", refund_cents: 30000, note: "thiếu 1 hộp" });
    assert.strictEqual(decided.status, "resolved");
    assert.strictEqual(Number(decided.refund_cents), 30000);
    assert.strictEqual(decided.decided_by, ADMIN);
    assert.ok(decided.decided_at);
    assert.strictEqual(bal(W.store), 70000, "trừ 30.000 từ phần cửa hàng");
    assert.strictEqual(bal(W.plat), 2000);
    assert.strictEqual(bal(W.char), 3000);
    assert.strictEqual(bal(W.ext), -75000);
    assert.strictEqual(row(o.id).settlement_status, "partially_refunded");
    assert.strictEqual(trust(), 85, "khiếu nại đúng (một phần) vẫn trừ 15 điểm");
    // lặp lại
    const again = await complaintService.decide(ADMIN, c.id, { decision: "refund_partial", refund_cents: 30000, note: "thiếu 1 hộp" });
    assert.strictEqual(again.id, decided.id);
    await rejects(() => complaintService.decide(ADMIN, c.id, { decision: "refund_full", note: "đổi ý hoàn đủ" }), "RESOURCE_CONFLICT");
    await Promise.allSettled(Array.from({ length: 4 }, () => complaintService.decide(ADMIN, c.id, { decision: "refund_partial", refund_cents: 30000, note: "thiếu 1 hộp" })));
    assert.strictEqual(bal(W.store), 70000, "không trừ ví thêm");
    assert.strictEqual(violations().length, 1, "chỉ một dòng vi phạm");
    assert.ok(notes((n) => n.type === "complaint-decision" && n.recipient_id === OWNER).length >= 1, "cửa hàng được báo quyết định");
    await expectBalanced();
  });

  await scenario("11b. Admin BÁC BỎ + đánh dấu khiếu nại sai → người mua −10 điểm, không đụng ví, cửa hàng không bị trừ", async () => {
    const o = await completedOrder(0, 2);
    const c = await complain(o, { reason_code: "other", issue: "Không thích mùi vị của bánh này lắm" });
    await complaintService.respond(OWNER, c.id, { action: "dispute", note: "Bánh đúng chuẩn, không có lỗi" });
    await assert.rejects(() => complaintService.decide(ADMIN, c.id, { decision: "refund_full", is_false_claim: true, note: "đánh dấu sai chỗ" }), (e) => e.statusCode === 400);
    const before = points();
    const rejected = await complaintService.decide(ADMIN, c.id, { decision: "reject", is_false_claim: true, note: "Không có bằng chứng lỗi" });
    assert.strictEqual(rejected.status, "rejected");
    assert.strictEqual(rejected.is_false_claim, true);
    assert.strictEqual(points(), before - 10, "người mua −10 điểm");
    assert.strictEqual(bal(W.store), 100000, "ví cửa hàng giữ nguyên");
    assert.strictEqual(trust(), 100, "cửa hàng không bị trừ");
    assert.strictEqual(violations().length, 0);
    await complaintService.decide(ADMIN, c.id, { decision: "reject", is_false_claim: true, note: "Không có bằng chứng lỗi" });
    assert.strictEqual(points(), before - 10, "bác bỏ lặp lại không trừ điểm lần hai");
    // bác bỏ KHÔNG đánh dấu sai: người mua không bị trừ
    const o2 = await completedOrder(0, 1, "p-green");
    const c2 = await complain(o2, { reason_code: "other", issue: "Mình nghĩ bánh hơi ngọt so với mô tả" });
    await complaintService.respond(OWNER, c2.id, { action: "dispute", note: "Đúng mô tả" });
    const p2 = points();
    await complaintService.decide(ADMIN, c2.id, { decision: "reject", note: "Không đủ căn cứ" });
    assert.strictEqual(points(), p2);
  });

  await scenario("12. Cửa hàng không trả lời trong 12 giờ → order-automation tự chuyển Admin; sau đó cửa hàng không phản hồi được nữa", async () => {
    const o = await completedOrder(0, 2);
    const c = await complain(o);
    const none = await orderAutomationService.run();
    assert.strictEqual(none.complaints_escalated, 0, "chưa tới hạn");
    complaintRow(c.id).response_due_at = iso(-MIN);
    const r = await orderAutomationService.run();
    assert.strictEqual(r.complaints_escalated, 1);
    assert.strictEqual(complaintRow(c.id).status, "in_review");
    assert.ok(complaintRow(c.id).escalated_at);
    assert.ok(notes((n) => n.type === "complaint-escalated" && n.recipient_id === OWNER).length === 1);
    assert.ok(notes((n) => n.recipient_id === CUST && n.type === "complaint-update").length >= 1);
    assert.strictEqual((await orderAutomationService.run()).complaints_escalated, 0, "chạy lại không chuyển lại");
    await rejects(() => complaintService.respond(OWNER, c.id, { action: "accept" }), "RESOURCE_CONFLICT");
    const done = await complaintService.decide(ADMIN, c.id, { decision: "refund_full", note: "Cửa hàng không phản hồi" });
    assert.strictEqual(done.status, "resolved");
    assert.strictEqual(bal(W.store), 0);
    await expectBalanced();
  });

  await scenario("12b. Phản hồi sau hạn mà tác vụ chưa kịp chạy: bị từ chối và khiếu nại được chuyển Admin ngay", async () => {
    const o = await completedOrder(0, 2);
    const c = await complain(o);
    complaintRow(c.id).response_due_at = iso(-MIN);
    await rejects(() => complaintService.respond(OWNER, c.id, { action: "accept" }), "RESOURCE_CONFLICT");
    assert.strictEqual(complaintRow(c.id).status, "in_review");
    assert.strictEqual(bal(W.store), 100000, "không hoàn tiền");
  });

  await scenario("13. Ngoài hạn khiếu nại → COMPLAINT_WINDOW_CLOSED; gửi lần 2 → COMPLAINT_ALREADY_EXISTS; thiếu ảnh / ảnh ngoài hệ thống / sai người / đơn chưa hoàn tất bị từ chối", async () => {
    const late = await completedOrder(0, 1);
    row(late.id).complaint_deadline_at = iso(-MIN);
    await rejects(() => complain(late), "COMPLAINT_WINDOW_CLOSED");
    const o = await completedOrder(0, 1, "p-green");
    await complain(o);
    await rejects(() => complain(o), "COMPLAINT_ALREADY_EXISTS");
    const o2 = await completedOrder(0, 1);
    await assert.rejects(() => complain(o2, { image_urls: [] }), (e) => e.statusCode === 400, "bắt buộc có ảnh");
    await assert.rejects(() => complain(o2, { image_urls: ["https://evil.example.com/pixel.jpg"] }), (e) => e.statusCode === 400, "ảnh phải tải lên qua FoodSave");
    await assert.rejects(() => complaintService.create(OTHER, { order_id: o2.id, reason_code: "other", issue: "Khiếu nại đơn của người khác", image_urls: [IMG()] }), (e) => e.statusCode === 403);
    const notDone = await pay(await createD(0, 1));
    await assert.rejects(() => complain(notDone), (e) => e.statusCode === 409, "đơn chưa hoàn tất");
    const unpaid = await createD(0, 1);
    await assert.rejects(() => complain(unpaid), (e) => e.statusCode === 409);
  });

  await scenario("13b. Hạn khiếu nại: 12 giờ nếu có đồ nấu chín, 24 giờ nếu không", async () => {
    const cooked = await completedOrder(0, 1);
    assert.ok(Math.abs(new Date(cooked.complaint_deadline_at).getTime() - new Date(cooked.completed_at).getTime() - 12 * HOUR) < 3000);
    prod("p-green").food_group = "packaged";
    const packaged = await completedOrder(0, 1, "p-green");
    assert.ok(Math.abs(new Date(packaged.complaint_deadline_at).getTime() - new Date(packaged.completed_at).getTime() - 24 * HOUR) < 3000);
  });

  await scenario("14. Phân quyền & dữ liệu cũ: cửa hàng khác không phản hồi được; khiếu nại CŨ vẫn chạy luồng cũ, khiếu nại MỚI không dùng được luồng cũ", async () => {
    const o = await completedOrder(0, 2);
    const c = await complain(o);
    await rejects(() => complaintService.respond(OTHER_OWNER, c.id, { action: "accept" }), "AUTH_FORBIDDEN");
    await rejects(() => complaintService.legacyUpdate(OWNER, "partner", c.id, { status: "resolved", resolution: "xong" }), "RESOURCE_CONFLICT");
    db.seed("complaints", [{ id: "legacy-1", order_id: o.id + "-x", customer_id: CUST, store_id: "s-1", product_names: ["Bánh cũ"], issue: "khiếu nại tạo trước Đợt 3", priority: "medium", status: "open", image_urls: [], created_at: new Date().toISOString() }]);
    db.seed("orders", [{ id: o.id + "-x", order_number: "FS-OLD", customer_id: CUST, store_id: "s-1", total_cents: 50000 }]);
    const updated = await complaintService.legacyUpdate(OWNER, "partner", "legacy-1", { status: "resolved", resolution: "đã giải thích" });
    assert.strictEqual(updated.status, "resolved");
    await rejects(() => complaintService.respond(OWNER, "legacy-1", { action: "accept" }), "RESOURCE_CONFLICT");
    await rejects(() => complaintService.decide(ADMIN, "legacy-1", { decision: "reject", note: "cũ" }), "RESOURCE_CONFLICT");
    await rejects(() => complaintService.decide(ADMIN, c.id, { decision: "reject", note: "cửa hàng còn thời gian" }), "RESOURCE_CONFLICT"); // còn đang chờ cửa hàng
  });

  await scenario("15c. Hai lần phản hồi ĐỒNG THỜI (accept ×2): chỉ một lần hoàn tiền và trừ điểm", async () => {
    const o = await completedOrder(3000, 2);
    const c = await complain(o);
    const results3 = await Promise.allSettled([complaintService.respond(OWNER, c.id, { action: "accept" }), complaintService.respond(OWNER, c.id, { action: "accept" }), complaintService.respond(OWNER, c.id, { action: "dispute", note: "đổi ý lần nữa" })]);
    assert.strictEqual(results3.filter((r) => r.status === "fulfilled").length, 1);
    assert.strictEqual(complaintRow(c.id).status, "resolved", "accept đến trước thắng");
    assert.strictEqual(violations().length, 1, "đúng một dòng vi phạm");
    assert.strictEqual(trust(), 85, "trừ điểm đúng một lần");
    assert.strictEqual(db.table("ledger_entries").filter((e) => e.entry_type === "refund_clawback").length, 3, "đúng ba bút toán thu hồi");
    assert.strictEqual(bal(W.ext), 0);
    await expectBalanced();
  });

  await scenario("16. Lần xử lý trước dang dở (đã quyết định nhưng chưa hoàn tiền): tác vụ định kỳ hoàn tất, không trừ điểm hai lần", async () => {
    const o = await completedOrder(3000, 2);
    const c = await complain(o);
    // giả lập sập giữa chừng: khiếu nại đã resolved nhưng sổ cái / đơn chưa được cập nhật
    Object.assign(complaintRow(c.id), { status: "resolved", store_response_action: "accept", store_responded_at: new Date().toISOString(), decision: "refund_full", refund_cents: o.total_cents });
    assert.strictEqual(bal(W.store), 100000);
    const r1 = await orderAutomationService.run();
    assert.strictEqual(r1.complaints_completed, 1);
    assert.strictEqual(bal(W.store), 0);
    assert.strictEqual(row(o.id).settlement_status, "refunded");
    assert.strictEqual(trust(), 85);
    const r2 = await orderAutomationService.run();
    assert.strictEqual(r2.complaints_completed, 0);
    assert.strictEqual(trust(), 85, "không trừ điểm lần hai");
    await expectBalanced();
  });

  await scenario("17. Danh sách theo vai trò + tải ảnh: người mua chỉ thấy của mình (không thấy ghi chú nội bộ), cửa hàng thấy của mình, admin lọc theo trạng thái; link tải ảnh đúng định dạng", async () => {
    const o = await completedOrder(0, 2);
    const c = await complain(o);
    await complaintService.respond(OWNER, c.id, { action: "dispute", note: "Cửa hàng không đồng ý" });
    await complaintService.decide(ADMIN, c.id, { decision: "reject", note: "Ghi chú nội bộ của admin" });
    const mine = await complaintService.list(CUST, "customer");
    assert.strictEqual(mine.length, 1);
    assert.strictEqual(mine[0].admin_note, null, "ghi chú nội bộ không lộ cho người mua");
    assert.strictEqual(mine[0].order_number, o.order_number);
    assert.strictEqual((await complaintService.list(OTHER, "customer")).length, 0);
    assert.strictEqual((await complaintService.list(OWNER, "partner")).length, 1);
    assert.strictEqual((await complaintService.list(OTHER_OWNER, "partner")).length, 0);
    assert.strictEqual((await complaintService.list(ADMIN, "admin", { status: "rejected" })).length, 1);
    assert.strictEqual((await complaintService.list(ADMIN, "admin", { status: "open" })).length, 0);
    const up = await complaintService.createUploadUrl(CUST, "customer", "image/png");
    assert.ok(up.path.startsWith("complaints/customer-" + CUST + "/") && up.path.endsWith(".png"));
    assert.ok(up.public_url.includes("/partner-assets/complaints/"));
    await assert.rejects(() => complaintService.createUploadUrl(CUST, "customer", "application/pdf"), (e) => e.statusCode === 400);
  });

  // ───────────────────────── Đợt 4a: Web Push (người mua + tình nguyện viên) ─────────────────────────
  const sentPush = [];
  const EP = (n) => "https://push.example.com/" + n;
  const KEYS = { p256dh: "p".repeat(24), auth: "a".repeat(24) };
  const subUser = (n, id = CUST) => pushService.subscribe({ kind: "user", id }, { endpoint: EP(n), keys: KEYS, userAgent: "TestBrowser/1.0" });
  const withPush = async (fn, transport) => {
    sentPush.length = 0;
    pushModule.setPushTransport(transport || (async (sub, payload) => { sentPush.push({ endpoint: sub.endpoint, ...JSON.parse(payload) }); }));
    try { await fn(); } finally { pushModule.setPushTransport(null); }
  };
  const pushTo = (n) => sentPush.filter((p) => p.endpoint === EP(n));

  await scenario("P1. Đăng ký thiết bị: lưu một lần theo endpoint; đổi chủ khi cùng thiết bị đăng nhập người khác; chỉ gỡ được thiết bị của chính mình; endpoint không https bị từ chối", async () => {
    await subUser("dev1");
    await subUser("dev1"); // gọi lại: không trùng
    assert.strictEqual(db.table("push_subscriptions").length, 1);
    const row1 = db.table("push_subscriptions")[0];
    assert.strictEqual(row1.user_id, CUST);
    assert.strictEqual(row1.volunteer_id, null);
    assert.strictEqual(row1.role, "customer");
    await pushService.subscribe({ kind: "volunteer", id: "vol-1" }, { endpoint: EP("dev1"), keys: KEYS }); // cùng thiết bị, tình nguyện viên đăng nhập
    assert.strictEqual(db.table("push_subscriptions").length, 1, "vẫn một dòng");
    const moved = db.table("push_subscriptions")[0];
    assert.strictEqual(moved.volunteer_id, "vol-1");
    assert.strictEqual(moved.user_id, null, "đúng một chủ sở hữu");
    assert.strictEqual(moved.role, "volunteer");
    await pushService.unsubscribe({ kind: "user", id: CUST }, EP("dev1")); // người khác không gỡ được
    assert.strictEqual(db.table("push_subscriptions").length, 1);
    await pushService.unsubscribe({ kind: "volunteer", id: "vol-1" }, EP("dev1"));
    assert.strictEqual(db.table("push_subscriptions").length, 0);
    await assert.rejects(() => pushService.subscribe({ kind: "user", id: CUST }, { endpoint: "http://insecure.example.com/x", keys: KEYS }), (e) => e.statusCode === 400);
    assert.deepStrictEqual(pushService.publicKey(), { public_key: null, enabled: false }, "chưa cấu hình VAPID thì báo tắt");
  });

  await scenario("P2. Push theo sự kiện đơn hàng: thanh toán, cửa hàng nhận, sẵn sàng, hoàn tất, hoàn tiền; mở đúng đơn (deep link) và gộp theo tag", async () => {
    await subUser("dev-a"); await subUser("dev-b"); // hai thiết bị
    await withPush(async () => {
      const o = await createD(0, 2);
      assert.strictEqual(sentPush.length, 0, "tạo đơn chưa thanh toán: không push");
      await pay(o);
      const paid = pushTo("dev-a").find((p) => p.type === "order-paid");
      assert.ok(paid, "push đã thanh toán");
      assert.strictEqual(paid.url, "/FOODSAVE_USER.html#order=" + o.id);
      assert.ok(/trước/.test(paid.body), "kèm hạn lấy hàng");
      assert.strictEqual(pushTo("dev-b").filter((p) => p.type === "order-paid").length, 1, "mọi thiết bị đều nhận");
      await partner(o, "confirmed");
      await partner(o, "ready");
      await partner(o, "completed");
      const updates = pushTo("dev-a").filter((p) => p.type === "order-update");
      assert.strictEqual(updates.length, 2, "nhận đơn, hoàn tất");
      const ready = pushTo("dev-a").filter((p) => p.type === "order-ready");
      assert.strictEqual(ready.length, 1, "cửa hàng chuẩn bị xong: loại push riêng, một lần");
      assert.ok(/đã chuẩn bị xong đơn/.test(ready[0].title));
      assert.ok(updates.concat(ready).every((p) => p.url === "/FOODSAVE_USER.html#order=" + o.id));
      // hoàn tiền (hủy sớm)
      const o2 = await pay(await createD(0, 1, "p-green"));
      await orderService.cancelByCustomer(CUST, o2.id, {});
      assert.ok(pushTo("dev-a").some((p) => p.type === "order-update" && /hủy/.test(p.title) && p.url.endsWith(o2.id)));
      // cửa hàng hủy: người mua nhận push hoàn tiền
      const o3 = await pay(await createD(0, 1, "p-green"));
      await partner(o3, "cancelled");
      assert.ok(pushTo("dev-a").some((p) => p.type === "order-update" && /hủy/.test(p.title) && /hoàn/.test(p.body) && p.url.endsWith(o3.id)));
    });
  });

  await scenario("P3. Push nhắc hạn lấy hàng (giữa chừng + cuối), vắng mặt, cảnh báo lần 2, khóa nhãn đỏ", async () => {
    await subUser("dev-a");
    await withPush(async () => {
      const o = await pay(await createD(0, 1));
      const paidAt = Date.now() - 50 * MIN;
      row(o.id).paid_at = new Date(paidAt).toISOString();
      row(o.id).pickup_deadline = new Date(paidAt + 90 * MIN).toISOString();
      await orderAutomationService.run();
      assert.strictEqual(sentPush.filter((p) => p.type === "order-reminder-mid").length, 1);
      row(o.id).pickup_deadline = iso(10 * MIN);
      await orderAutomationService.run();
      await orderAutomationService.run();
      assert.strictEqual(sentPush.filter((p) => p.type === "order-reminder-final").length, 1, "nhắc cuối đúng một lần");
      for (let i = 0; i < 3; i += 1) {
        const n = await pay(await createD(0, 1));
        row(n.id).pickup_deadline = iso(-6 * MIN);
        await orderAutomationService.run();
      }
      assert.ok(sentPush.filter((p) => p.type === "order-no-show").length >= 3, "push vắng mặt");
      assert.strictEqual(sentPush.filter((p) => p.type === "no-show-warning").length, 1, "cảnh báo lần 2");
      assert.strictEqual(sentPush.filter((p) => p.type === "red-label-banned").length, 1, "khóa nhãn đỏ");
    });
  });

  await scenario("P4. Push chat (cửa hàng nhắn → người mua nhận, gộp theo đơn) và khiếu nại (phản hồi / quyết định)", async () => {
    await subUser("dev-a");
    await withPush(async () => {
      const o = await pay(await createD(0, 2));
      await orderChatService.send(o.id, OWNER, "partner", "Hàng đã sẵn sàng, mời bạn đến nhận");
      const chat = sentPush.filter((p) => p.type === "order-chat");
      assert.strictEqual(chat.length, 1);
      assert.strictEqual(chat[0].tag, "chat-" + o.id, "tin mới thay tin cũ cùng đơn");
      assert.strictEqual(chat[0].url, "/FOODSAVE_USER.html#order=" + o.id);
      await orderChatService.send(o.id, CUST, "customer", "Mình đến liền"); // người mua nhắn: cửa hàng KHÔNG có push
      assert.strictEqual(sentPush.filter((p) => p.type === "order-chat").length, 1);
      await partner(o, "completed");
      sentPush.length = 0;
      const c = await complaintService.create(CUST, { order_id: o.id, reason_code: "other", issue: "Mình muốn khiếu nại đơn này", image_urls: [`${env.SUPABASE_URL}/storage/v1/object/public/partner-assets/complaints/customer-${CUST}/a.jpg`] });
      assert.strictEqual(sentPush.length, 0, "cửa hàng nhận khiếu nại: không push");
      await complaintService.respond(OWNER, c.id, { action: "dispute", note: "Đã giao đúng hàng" });
      assert.ok(sentPush.some((p) => p.type === "complaint-update" && p.url === "/FOODSAVE_USER.html#complaint=" + c.id), "khiếu nại có phản hồi");
      await complaintService.decide(ADMIN, c.id, { decision: "refund_full", note: "Hoàn tiền cho bạn" });
      assert.ok(sentPush.some((p) => p.type === "complaint-decision" && p.url === "/FOODSAVE_USER.html#complaint=" + c.id), "khiếu nại có quyết định");
    });
  });

  await scenario("P5. KHÔNG push cho cổng cửa hàng / tổ chức: thông báo của cửa hàng và theo vai trò không bao giờ gửi push", async () => {
    await pushService.subscribe({ kind: "user", id: OWNER }, { endpoint: EP("store-device"), keys: KEYS }); // thiết bị của chủ cửa hàng (giả định đã đăng ký)
    await withPush(async () => {
      const o = await pay(await createD(0, 2));
      await orderChatService.send(o.id, CUST, "customer", "Chào cửa hàng");
      assert.ok(notes((n) => n.recipient_id === OWNER).length >= 2, "cửa hàng vẫn nhận thông báo trong app");
      assert.strictEqual(sentPush.length, 0, "nhưng không có push nào");
      await notificationModule.createNotification({ roleTarget: "charity", type: "new-donation", title: "Lô mới", body: "x", relatedType: "donation", relatedId: "d" });
      await notificationModule.createNotification({ roleTarget: "customer", type: "promo-push", title: "Khuyến mãi", body: "x" });
      assert.strictEqual(sentPush.length, 0, "thông báo theo vai trò không push");
    });
  });

  await scenario("P6. Thiết bị hết hạn (404/410) tự bị xóa; lỗi khác giữ lại; thiết bị gửi thành công ghi last_used_at", async () => {
    await subUser("alive"); await subUser("gone410"); await subUser("gone404"); await subUser("flaky");
    await withPush(async () => {
      const o = await createD(0, 1);
      await pay(o);
    }, async (sub) => {
      if (sub.endpoint === EP("gone410")) throw Object.assign(new Error("gone"), { statusCode: 410 });
      if (sub.endpoint === EP("gone404")) throw Object.assign(new Error("not found"), { statusCode: 404 });
      if (sub.endpoint === EP("flaky")) throw Object.assign(new Error("server error"), { statusCode: 500 });
    });
    const left = db.table("push_subscriptions").map((r) => r.endpoint).sort();
    assert.deepStrictEqual(left, [EP("alive"), EP("flaky")].sort(), "chỉ xóa 404/410");
    // gửi thành công thì có last_used_at
    await withPush(async () => { await pay(await createD(0, 1, "p-green")); });
    assert.ok(db.table("push_subscriptions").find((r) => r.endpoint === EP("alive")).last_used_at, "ghi last_used_at");
  });

  await scenario("P7. Lỗi / treo của push KHÔNG làm hỏng nghiệp vụ; chưa cấu hình VAPID thì không gửi, không lỗi", async () => {
    await subUser("alive");
    await withPush(async () => {
      const o = await createD(0, 2);
      const paid = await pay(o);
      assert.strictEqual(paid.status, "pending", "thanh toán vẫn thành công");
      assert.strictEqual(notes((n) => n.type === "order-paid" && n.recipient_id === CUST).length, 1, "thông báo trong app vẫn có");
      await partner(o, "completed");
      assert.strictEqual(bal(W.store), 100000, "tiền vẫn về ví");
    }, async () => { throw new Error("mạng sập"); });
    // không có transport và không có khóa VAPID: im lặng
    pushModule.setPushTransport(null);
    const r = await pushService.sendToUser(CUST, { title: "t", body: "b", url: "/" });
    assert.deepStrictEqual(r, { sent: 0, removed: 0 });
    const o2 = await pay(await createD(0, 1, "p-green"));
    assert.strictEqual(o2.status, "pending");
  });

  await scenario("P8. Tình nguyện viên: nhắc nhiệm vụ lấy hàng còn <= 30 phút đúng một lần, không nhắc nhiệm vụ xong / chưa gần hạn; push theo đúng thiết bị của tình nguyện viên", async () => {
    await pushService.subscribe({ kind: "volunteer", id: "vol-1" }, { endpoint: EP("vol-dev"), keys: KEYS });
    await pushService.subscribe({ kind: "volunteer", id: "vol-2" }, { endpoint: EP("vol2-dev"), keys: KEYS });
    db.seed("donations", [
      { id: "d-soon", donation_code: "DON-SOON", status: "accepted", pickup_end: iso(20 * MIN) },
      { id: "d-far", donation_code: "DON-FAR", status: "accepted", pickup_end: iso(3 * HOUR) },
      { id: "d-done", donation_code: "DON-DONE", status: "accepted", pickup_end: iso(10 * MIN) },
      { id: "d-past", donation_code: "DON-PAST", status: "accepted", pickup_end: iso(-5 * MIN) },
      { id: "d-open", donation_code: "DON-OPEN", status: "open", pickup_end: iso(10 * MIN) }
    ]);
    db.seed("donation_assignments", [
      { id: "a1", donation_id: "d-soon", volunteer_id: "vol-1", stage: "pickup", done_at: null, reminder_sent_at: null },
      { id: "a2", donation_id: "d-far", volunteer_id: "vol-1", stage: "pickup", done_at: null, reminder_sent_at: null },
      { id: "a3", donation_id: "d-done", volunteer_id: "vol-2", stage: "pickup", done_at: iso(-MIN), reminder_sent_at: null },
      { id: "a4", donation_id: "d-past", volunteer_id: "vol-2", stage: "pickup", done_at: null, reminder_sent_at: null },
      { id: "a5", donation_id: "d-open", volunteer_id: "vol-2", stage: "pickup", done_at: null, reminder_sent_at: null },
      { id: "a6", donation_id: "d-soon", volunteer_id: "vol-2", stage: "distribute", done_at: null, reminder_sent_at: null }
    ]);
    await withPush(async () => {
      const r1 = await orderAutomationService.run();
      assert.strictEqual(r1.volunteer_reminders, 1);
      assert.strictEqual(sentPush.length, 1);
      assert.strictEqual(sentPush[0].endpoint, EP("vol-dev"));
      assert.strictEqual(sentPush[0].type, "volunteer-task-reminder");
      assert.strictEqual(sentPush[0].url, "/FOODSAVE_VOLUNTEER.html#task=d-soon");
      assert.ok(db.table("donation_assignments").find((a) => a.id === "a1").reminder_sent_at, "đã đánh dấu nhắc");
      const r2 = await orderAutomationService.run();
      assert.strictEqual(r2.volunteer_reminders, 0, "không nhắc lại");
      assert.strictEqual(sentPush.length, 1);
    });
  });

  await scenario("P9. Xác thực /push: token tình nguyện viên hợp lệ → chủ sở hữu là tình nguyện viên; token sai / thiếu → 401", async () => {
    const { createVolunteerToken } = require("../dist/utils/volunteerToken");
    const run = (token) => new Promise((resolve) => {
      const req = { headers: token ? { authorization: "Bearer " + token } : {} };
      const res = { locals: {} };
      pushActorMiddleware.pushActor(req, res, (error) => resolve({ error, res }));
    });
    const ok = await run(createVolunteerToken("vol-9", "charity-1"));
    assert.ok(!ok.error);
    assert.deepStrictEqual(ok.res.locals.pushOwner, { kind: "volunteer", id: "vol-9" });
    const bad = await run("khong.phai.token");
    assert.ok(bad.error && bad.error.statusCode === 401, "token sai bị từ chối");
    const none = await run("");
    assert.ok(none.error && none.error.statusCode === 401, "thiếu token bị từ chối");
  });

  // ───────────────────────── Đợt 4b: Admin + cổng cửa hàng dùng dữ liệu thật ─────────────────────────
  const ACTOR = { userId: ADMIN, name: "Quản trị A" };
  const vnMonth = () => new Date(Date.now() + 7 * HOUR).toISOString().slice(0, 7);

  await scenario("Q1. Chính sách chỉnh được: kiểm tra hợp lệ, lưu + nhật ký, đơn cũ giữ hạn, đơn mới theo cấu hình mới, đọc lại từ DB, dữ liệu hỏng thì bỏ qua", async () => {
    try {
      const base = policyModule.defaultPolicy();
      const bad = { ...base, labels: { ...base.labels, yellow: { ...base.labels.yellow, cancelFreeBeforePickupMinutes: 90 } } };
      assert.ok(policyConfigService.validatePolicy(bad).some((e) => /nhỏ hơn hạn lấy hàng/.test(e)), "hủy miễn phí >= hạn lấy phải bị từ chối");
      await rejects(() => policyConfigService.policyConfigService.save(bad, ACTOR), "VALIDATION_ERROR");
      assert.strictEqual(db.table("order_policy_config").length, 0, "không lưu khi sai");
      assert.ok(policyConfigService.validatePolicy({ ...base, grace_cancel_minutes: 99 }).length > 0);
      assert.ok(policyConfigService.validatePolicy({ ...base, no_show_ban_count: 1 }).length > 0);

      const o1 = await pay(await create("p-yellow"));
      const old = o1.pickup_deadline;
      const good = { ...base, labels: { ...base.labels, yellow: { payMinutes: 10, pickupMinutes: 60, cancelFreeBeforePickupMinutes: 15, finalReminderMinutes: 10 } }, red_ban_days: 14 };
      await policyConfigService.policyConfigService.save(good, ACTOR);
      assert.strictEqual(db.table("order_policy_config").length, 1);
      const audit = db.table("admin_audit_log").find((a) => a.action === "policy.update");
      assert.ok(audit && audit.actor_id === ADMIN && audit.actor_name === "Quản trị A", "ghi nhật ký người sửa");
      assert.strictEqual(audit.detail.before.labels.yellow.pickupMinutes, 90);
      assert.strictEqual(audit.detail.after.labels.yellow.pickupMinutes, 60);
      assert.strictEqual(row(o1.id).pickup_deadline, old, "đơn đã tạo giữ nguyên hạn lấy hàng");

      const o2 = await pay(await create("p-yellow"));
      const win = new Date(o2.pickup_deadline).getTime() - new Date(o2.paid_at).getTime();
      assert.ok(Math.abs(win - 60 * MIN) < 2000, "đơn mới theo hạn 60 phút");
      assert.strictEqual(policyModule.RED_BAN_DAYS, 14, "hằng số động được áp dụng cho nơi khác dùng");

      // Một máy chủ khác sửa DB: sau khi hết hạn nhớ tạm thì máy này đọc lại
      db.table("order_policy_config")[0].config = { ...good, labels: { ...good.labels, yellow: { ...good.labels.yellow, pickupMinutes: 75 } } };
      policyConfigService.policyConfigService.invalidate();
      await policyConfigService.policyConfigService.ensureFresh();
      assert.strictEqual(policyModule.LABEL_POLICY.yellow.pickupMinutes, 75);

      // Dữ liệu hỏng trong DB: bỏ qua, giữ giá trị đang chạy (không làm hỏng đặt hàng)
      db.table("order_policy_config")[0].config = { labels: { yellow: { pickupMinutes: "abc" } } };
      policyConfigService.policyConfigService.invalidate();
      await policyConfigService.policyConfigService.ensureFresh();
      assert.strictEqual(policyModule.LABEL_POLICY.yellow.pickupMinutes, 75, "giữ giá trị hợp lệ gần nhất");
      const o3 = await create("p-yellow");
      assert.ok(o3.id, "vẫn đặt hàng được");

      await policyConfigService.policyConfigService.reset(ACTOR);
      assert.strictEqual(policyModule.LABEL_POLICY.yellow.pickupMinutes, 90);
      assert.strictEqual(policyModule.RED_BAN_DAYS, 30);
    } finally {
      policyModule.applyPolicy(policyModule.defaultPolicy());
      policyConfigService.policyConfigService.invalidate();
    }
  });

  await scenario("Q2. Nhật ký tác vụ tự động: ghi lần chạy thật cho từng tác vụ, lỗi được ghi lại, tổng quan đủ 4 tác vụ", async () => {
    await automationRunService.automationRunService.track("order-automation", "manual", () => orderAutomationService.run("manual"));
    const jobs = db.table("automation_runs").map((r) => r.job).sort();
    assert.deepStrictEqual(jobs, ["complaint-escalation", "order-automation", "push-reminders"]);
    assert.ok(db.table("automation_runs").every((r) => r.trigger === "manual" && r.ok === true && r.finished_at));
    await assert.rejects(() => automationRunService.automationRunService.track("label-automation", "manual", async () => { throw new Error("boom"); }), /boom/);
    const failed = db.table("automation_runs").find((r) => r.job === "label-automation");
    assert.ok(failed && failed.ok === false && failed.error === "boom");
    const overview = await automationRunService.automationRunService.overview();
    assert.deepStrictEqual(overview.map((o) => o.job), ["label-automation", "order-automation", "complaint-escalation", "push-reminders"]);
    assert.strictEqual(overview[0].last_run.ok, false);
    assert.strictEqual(overview[0].failures_7d, 1);
    assert.strictEqual(overview[0].last_failure.error, "boom");
    assert.strictEqual(overview[1].last_run.ok, true);
    assert.strictEqual(overview[1].failures_7d, 0);
  });

  await scenario("Q3. Quản lý nhãn: đếm đúng theo dữ liệu thật, bỏ hàng ẩn / hết kho, đỏ lên đầu", async () => {
    db.seed("products", [
      { id: "p-hidden", store_id: "s-1", name: "Ẩn", price_cents: 1, original_price_cents: 2, stock_quantity: 5, is_active: false, label: "red", expires_at: iso(HOUR) },
      { id: "p-empty", store_id: "s-1", name: "Hết kho", price_cents: 1, original_price_cents: 2, stock_quantity: 0, is_active: true, label: "red", expires_at: iso(HOUR) }
    ]);
    const o = await adminOpsService.adminOpsService.labelOverview();
    assert.deepStrictEqual(o.counts, { green: 1, yellow: 1, red: 1 });
    assert.strictEqual(o.total, 3);
    assert.strictEqual(o.lots[0].label, "red");
    assert.strictEqual(o.lots[0].store_name, "Tiệm Thử");
    assert.ok(!o.lots.some((l) => l.id === "p-hidden" || l.id === "p-empty"));
  });

  await scenario("Q4. Voucher: Admin tạo / bật tắt, cửa hàng chỉ thấy và sửa voucher của mình, mã trùng bị từ chối, voucher dùng được khi đặt đơn", async () => {
    const ops = adminOpsService.adminOpsService;
    const input = { code: "gio-vang10", name: "Giờ vàng", percent_off: 10, starts_at: iso(-HOUR), expires_at: iso(24 * HOUR) };
    const platform = await ops.createVoucher(null, input, ACTOR);
    assert.strictEqual(platform.code, "GIO-VANG10");
    assert.strictEqual(platform.store_id, null);
    await rejects(() => ops.createVoucher(null, { ...input, code: "GIO-VANG10" }, ACTOR), "RESOURCE_CONFLICT");
    await rejects(() => ops.createVoucher(null, { ...input, code: "BOTH", fixed_discount_cents: 5000 }, ACTOR), "VALIDATION_ERROR");
    await rejects(() => ops.createVoucher(null, { ...input, code: "BADTIME", expires_at: iso(-2 * HOUR) }, ACTOR), "VALIDATION_ERROR");
    assert.ok(db.table("admin_audit_log").some((a) => a.action === "voucher.create" && a.target_id === platform.id));

    const mine = await partnerOpsService.partnerOpsService.createVoucher(OWNER, { code: "TIEM10", name: "Tiệm giảm 10%", percent_off: 10, starts_at: iso(-HOUR), expires_at: iso(24 * HOUR), min_order_cents: 50000 });
    assert.strictEqual(mine.store_id, "s-1");
    const ownList = await partnerOpsService.partnerOpsService.listVouchers(OWNER);
    assert.deepStrictEqual(ownList.map((v) => v.code), ["TIEM10"], "cửa hàng không thấy voucher toàn sàn");
    assert.strictEqual((await ops.listVouchers(null)).length, 2, "Admin thấy tất cả");
    await rejects(() => partnerOpsService.partnerOpsService.toggleVoucher(OWNER, platform.id, false), "RESOURCE_NOT_FOUND");
    await rejects(() => partnerOpsService.partnerOpsService.createVoucher(OTHER_OWNER, { code: "NOSTORE", name: "x", percent_off: 5, starts_at: iso(-HOUR), expires_at: iso(HOUR) }), "RESOURCE_NOT_FOUND");

    const withVoucher = (await orderService.createOrder(CUST, { ...body("p-yellow", 2), voucher_code: "TIEM10" })).order;
    assert.strictEqual(withVoucher.discount_cents, 10000, "giảm 10% của 100.000đ");
    const off = await partnerOpsService.partnerOpsService.toggleVoucher(OWNER, mine.id, false);
    assert.strictEqual(off.is_active, false);
    await rejects(() => orderService.createOrder(CUST, { ...body("p-yellow", 2), voucher_code: "TIEM10" }), "RESOURCE_CONFLICT");
    await ops.toggleVoucher(platform.id, false, null, ACTOR);
    assert.ok(db.table("admin_audit_log").some((a) => a.action === "voucher.disable"));
  });

  await scenario("Q5. Xác minh hồ sơ: hàng đợi cửa hàng + tổ chức, duyệt / từ chối thật, bắt buộc có lý do, có nhật ký và thông báo", async () => {
    db.seed("profiles", [{ id: "own-p", role: "partner", full_name: "Chủ Mới", phone: "0900000001", status: "pending" }, { id: "own-c", role: "charity", full_name: "Chủ TC", phone: "0900000002", status: "pending" }]);
    db.seed("stores", [{ id: "s-new", owner_id: "own-p", name: "Tiệm Mới", address: "1 Lê Lợi", status: "pending", created_at: iso(-MIN) }]);
    db.seed("charity_profiles", [{ id: "c-1", owner_id: "own-c", name: "Quỹ Ấm", phone: "0900000002", email: "a@b.c", address: "2 Hai Bà Trưng", status: "pending", created_at: iso(-MIN) }]);
    const ops = adminOpsService.adminOpsService;
    const q = await ops.verificationQueue();
    assert.deepStrictEqual(q.stores.map((s) => s.id), ["s-new"]);
    assert.deepStrictEqual(q.charities.map((c) => c.id), ["c-1"]);

    await rejects(() => ops.decideVerification("charity", "c-1", "reject", "  ", ACTOR), "VALIDATION_ERROR");
    assert.strictEqual(db.table("charity_profiles")[0].status, "pending");
    await ops.decideVerification("charity", "c-1", "approve", undefined, ACTOR);
    const c = db.table("charity_profiles")[0];
    assert.strictEqual(c.status, "active");
    assert.ok(c.reviewed_at);
    assert.strictEqual(db.table("profiles").find((p) => p.id === "own-c").status, "active");
    assert.ok(notes((n) => n.recipient_id === "own-c" && n.type === "verification-result").length === 1);

    await ops.decideVerification("store", "s-new", "reject", "Thiếu giấy phép", ACTOR);
    assert.notStrictEqual(db.table("stores").find((s) => s.id === "s-new").status, "pending");
    assert.ok(notes((n) => n.recipient_id === "own-p" && /Thiếu giấy phép/.test(n.body)).length === 1);

    db.seed("charity_profiles", [{ id: "c-2", owner_id: "own-c", name: "Quỹ Hai", phone: "1", email: "e", address: "a", status: "pending", created_at: iso(-MIN) }]);
    await ops.decideVerification("charity", "c-2", "reject", "Không đủ hồ sơ", ACTOR);
    const c2 = db.table("charity_profiles").find((x) => x.id === "c-2");
    assert.strictEqual(c2.status, "suspended");
    assert.strictEqual(c2.rejection_reason, "Không đủ hồ sơ");
    const actions = db.table("admin_audit_log").map((a) => a.action).sort();
    assert.deepStrictEqual(actions, ["verification.approve", "verification.reject", "verification.reject"]);
    assert.strictEqual((await ops.verificationQueue()).history.length, 3);
    await rejects(() => ops.decideVerification("store", "khong-co", "approve", undefined, ACTOR), "RESOURCE_NOT_FOUND");
  });

  await scenario("Q6. Báo cáo ESG theo tháng: cộng đúng từ sự kiện thật, so với tháng trước, tháng trống = 0, tháng sai bị từ chối", async () => {
    const month = vnMonth();
    const [y, m] = month.split("-").map(Number);
    const prev = new Date(Date.UTC(y, m - 1, 1) - 7 * HOUR - 2 * 24 * HOUR).toISOString();
    let evSeq = 0;
    const ev = (over) => ({ source_id: "ev-" + (evSeq += 1), source_type: "order", store_id: "s-1", food_saved_kg: 1, co2_avoided_kg: 2.5, water_saved_liters: 890, meals_equivalent: 3, money_saved_cents: 20000, occurred_at: iso(-MIN), ...over });
    db.seed("eco_impact_events", [ev({}), ev({ food_saved_kg: 2, co2_avoided_kg: 5, meals_equivalent: 6 }), ev({ source_type: "donation", store_id: null, food_saved_kg: 4 }), ev({ occurred_at: prev, food_saved_kg: 7 })]);
    const o = await pay(await create("p-yellow"));
    await partner(o, "completed");
    const r = await adminOpsService.adminOpsService.esgReport(month);
    assert.strictEqual(r.has_data, true);
    assert.strictEqual(r.total.events, 4, "3 sự kiện thêm tay + 1 sự kiện sinh ra khi hoàn tất đơn");
    assert.strictEqual(r.total.food_saved_kg, 7.7);
    assert.ok(r.total.meals_equivalent >= 12);
    assert.strictEqual(r.by_source.order.food_saved_kg, 3.7);
    assert.strictEqual(r.by_source.donation.food_saved_kg, 4);
    assert.strictEqual(r.previous.food_saved_kg, 7, "tháng trước");
    assert.strictEqual(r.top_stores[0].store_name, "Tiệm Thử");
    assert.strictEqual(r.orders_completed, 1);
    const empty = await adminOpsService.adminOpsService.esgReport("2020-01");
    assert.strictEqual(empty.has_data, false);
    assert.strictEqual(empty.total.food_saved_kg, 0);
    await rejects(() => adminOpsService.adminOpsService.esgReport("2026-13"), "VALIDATION_ERROR");
  });

  await scenario("Q7. Cảnh báo gian lận: phát hiện từ dữ liệu có sẵn, không bịa; Xử lý ghi trạng thái + nhật ký; liệt kê điều chưa phát hiện được", async () => {
    const ord = (i, status, ago, over = {}) => ({ id: "fo-" + i, order_number: "FS-F" + i, customer_id: OTHER, status, payment_status: "paid", total_cents: 50000, created_at: iso(-ago * MIN), ...over });
    db.seed("orders", [
      ord(1, "cancelled", 60), ord(2, "cancelled", 70), ord(3, "no_show", 80), ord(4, "no_show", 90), ord(5, "completed", 100), ord(6, "completed", 110),
      ord(7, "awaiting_payment", 40, { payment_status: "pending" }),
      { id: "fo-ok", order_number: "FS-OK", customer_id: CUST, status: "completed", payment_status: "paid", total_cents: 1, created_at: iso(-50 * MIN) }
    ]);
    db.seed("auth_audit_logs", ["u1", "u2", "u3"].map((u) => ({ user_id: u, ip_address: "10.0.0.9", event_type: "LOGIN_SUCCESS", created_at: iso(-HOUR) })));
    const ops = adminOpsService.adminOpsService;
    const res = await ops.fraudAlerts();
    const keys = res.alerts.map((a) => a.key);
    assert.ok(keys.includes("high_cancel_rate:" + OTHER), "tỷ lệ hủy cao: 4/6 đơn");
    assert.ok(keys.includes("repeat_no_show:" + OTHER), "vắng mặt lặp lại");
    assert.ok(keys.includes("long_pending_payment:fo-7"), "chờ thanh toán quá lâu");
    assert.ok(keys.includes("shared_ip:10.0.0.9"), "nhiều tài khoản cùng IP");
    assert.ok(!keys.some((k) => k.endsWith(":" + CUST)), "khách bình thường không bị cảnh báo");
    const hc = res.alerts.find((a) => a.key === "high_cancel_rate:" + OTHER);
    assert.strictEqual(hc.subject_name, "Khách B");
    assert.strictEqual(hc.metrics.orders_30d, 6);
    assert.strictEqual(hc.status, "open");
    assert.ok(res.not_detected.length >= 3 && res.not_detected.some((t) => /thiết bị/i.test(t)), "nói rõ điều chưa phát hiện được");

    await ops.handleFraudAlert("shared_ip:10.0.0.9", "handled", "wifi quán", ACTOR);
    await ops.handleFraudAlert("shared_ip:10.0.0.9", "dismissed", "kiểm tra lại", ACTOR); // ghi đè, không trùng dòng
    assert.strictEqual(db.table("fraud_alert_status").length, 1);
    const after = await ops.fraudAlerts();
    const ip = after.alerts.find((a) => a.key === "shared_ip:10.0.0.9");
    assert.strictEqual(ip.status, "dismissed");
    assert.strictEqual(ip.note, "kiểm tra lại");
    assert.strictEqual(after.alerts[after.alerts.length - 1].key, "shared_ip:10.0.0.9", "cảnh báo đã xử lý xuống cuối");
    assert.strictEqual(db.table("admin_audit_log").filter((a) => a.action.startsWith("fraud.")).length, 2);
    await rejects(() => ops.handleFraudAlert("rac;drop:1", "handled", undefined, ACTOR), "VALIDATION_ERROR");
  });

  await scenario("Q8. Khách hàng của cửa hàng: chỉ khách đã đặt tại cửa hàng này, số điện thoại che ở máy chủ, thống kê đúng", async () => {
    db.table("profiles").find((p) => p.id === CUST).phone = "0912345678";
    db.table("profiles").find((p) => p.id === OTHER).phone = "0987654321";
    db.seed("profiles", [{ id: "cust-3", role: "customer", full_name: "Khách C", phone: "0933333333", points: 100, rank: "Tin cậy" }]);
    db.seed("stores", [{ id: "s-x", owner_id: OTHER_OWNER, name: "Tiệm Khác" }]);
    const ord = (i, cid, store, status, total, ago) => ({ id: "co-" + i, order_number: "FS-C" + i, customer_id: cid, store_id: store, status, total_cents: total, created_at: iso(-ago * MIN) });
    db.seed("orders", [
      ord(1, CUST, "s-1", "completed", 40000, 300), ord(2, CUST, "s-1", "completed", 60000, 200), ord(3, CUST, "s-1", "no_show", 30000, 100), ord(4, CUST, "s-x", "completed", 99000, 50),
      ord(5, OTHER, "s-1", "cancelled", 20000, 10), ord(6, "cust-3", "s-x", "completed", 10000, 20), ord(7, OTHER, "s-1", "awaiting_payment", 5000, 5)
    ]);
    const r = await partnerOpsService.partnerOpsService.customers(OWNER);
    assert.strictEqual(r.total, 2, "chỉ 2 khách có đơn tại cửa hàng này");
    assert.ok(!r.items.some((i) => i.customer_id === "cust-3"));
    const a = r.items.find((i) => i.customer_id === CUST);
    assert.deepStrictEqual([a.orders, a.completed, a.no_show, a.spent_cents], [3, 2, 1, 100000], "không cộng đơn ở cửa hàng khác");
    assert.strictEqual(a.phone_masked, "091••••678");
    const b = r.items.find((i) => i.customer_id === OTHER);
    assert.deepStrictEqual([b.orders, b.cancelled], [1, 1], "đơn chưa thanh toán không tính");
    const text = JSON.stringify(r);
    assert.ok(!text.includes("0912345678") && !text.includes("0987654321") && !text.includes("phone\""), "không lộ số điện thoại đầy đủ");
    assert.strictEqual(r.items[0].customer_id, OTHER, "khách mua gần nhất đứng đầu");
    assert.deepStrictEqual((await partnerOpsService.partnerOpsService.customers("owner-chua-co-cua-hang")).items, []);
    assert.strictEqual(partnerOpsService.maskPhone("123"), "••••");
    assert.strictEqual(partnerOpsService.maskPhone(null), "");
  });

  await scenario("Q9. Dải việc cần làm của bảng điều khiển đếm đúng từ dữ liệu thật", async () => {
    db.seed("stores", [{ id: "s-p", owner_id: "x", name: "Chờ", status: "pending" }]);
    db.seed("charity_profiles", [{ id: "c-p", owner_id: "y", name: "TC", status: "pending" }]);
    db.seed("complaints", [{ id: "k1", status: "in_review" }, { id: "k2", status: "open" }]);
    db.seed("withdrawals", [{ id: "w1", status: "requested", store_id: "s-1", amount_cents: 1 }, { id: "w2", status: "paid", store_id: "s-1", amount_cents: 1 }]);
    db.seed("store_payout_accounts", []);
    db.seed("payout_accounts", [{ id: "a1", status: "pending_verification" }]);
    db.table("profiles").find((p) => p.id === OTHER).red_ban_until = iso(5 * 24 * HOUR);
    const w = await adminOpsService.adminOpsService.workStrip();
    assert.strictEqual(w.verification_pending, 2);
    assert.strictEqual(w.complaints_waiting_admin, 1);
    assert.strictEqual(w.customers_locked, 1);
    assert.ok(w.withdrawals_pending >= 1);
    assert.strictEqual(typeof w.fraud_open, "number");
  });

  await scenario("A1. App người mua: push 'cửa hàng đã chuẩn bị xong' đúng người, một lần, mở đúng đơn trong app; tắt nhóm Đơn hàng thì không push nhưng vẫn có thông báo trong app", async () => {
    db.table("push_subscriptions").splice(0);
    await pushService.subscribe({ kind: "user", id: CUST }, { endpoint: EP("app1"), keys: KEYS, client: "app" });
    await pushService.subscribe({ kind: "user", id: CUST }, { endpoint: EP("web1"), keys: KEYS, client: "web" });
    await pushService.subscribe({ kind: "user", id: OTHER }, { endpoint: EP("other"), keys: KEYS, client: "app" });
    await withPush(async () => {
      const o = await pay(await create("p-yellow"));
      await partner(o, "confirmed");
      sentPush.length = 0;
      await partner(o, "ready");
      await partner(o, "ready"); // bấm lặp: không báo lần hai
      assert.strictEqual(notes((n) => n.recipient_id === CUST && n.type === "order-ready").length, 1, "đúng một thông báo");
      assert.strictEqual(pushTo("app1").length, 1);
      assert.strictEqual(pushTo("other").length, 0, "không gửi nhầm người");
      assert.ok(pushTo("app1")[0].url === "/FOODSAVE_APP.html#order=" + o.id, "thiết bị app mở đúng đơn trong app");
      assert.ok(pushTo("web1")[0].url === "/FOODSAVE_USER.html#order=" + o.id, "thiết bị web mở bản web");
      assert.ok(/đã chuẩn bị xong đơn/.test(pushTo("app1")[0].title) && /đến nhận trước/.test(pushTo("app1")[0].body));
      // tắt nhóm Đơn hàng
      db.table("profiles").find((p) => p.id === CUST).metadata = { notification_prefs: { orders: false } };
      const o2 = await pay(await create("p-yellow"));
      await partner(o2, "confirmed");
      sentPush.length = 0;
      await partner(o2, "ready");
      assert.strictEqual(sentPush.length, 0, "đã tắt nhóm Đơn hàng: không push");
      assert.strictEqual(notes((n) => n.recipient_id === CUST && n.type === "order-ready").length, 2, "vẫn có thông báo trong app");
      db.table("profiles").find((p) => p.id === CUST).metadata = {};
    });
  });

  await scenario("A2. Voucher mới: báo một lần cho người mua đã bật thông báo, bỏ qua ai tắt nhóm Khuyến mãi; bật/tắt lại không báo thêm; voucher chưa tới ngày thì không báo", async () => {
    db.table("push_subscriptions").splice(0);
    await pushService.subscribe({ kind: "user", id: CUST }, { endpoint: EP("c-app"), keys: KEYS, client: "app" });
    await pushService.subscribe({ kind: "user", id: OTHER }, { endpoint: EP("o-app"), keys: KEYS, client: "app" });
    db.table("profiles").find((p) => p.id === OTHER).metadata = { notification_prefs: { promo: false } };
    await withPush(async () => {
      const before = notes((n) => n.type === "voucher-new").length;
      const v = await adminOpsService.adminOpsService.createVoucher(null, { code: "MOI20", name: "Giảm 20%", percent_off: 20, starts_at: iso(-MIN), expires_at: iso(24 * HOUR) }, null);
      assert.strictEqual(notes((n) => n.type === "voucher-new").length, before + 1, "một thông báo cho mọi người mua (chuông)");
      assert.strictEqual(pushTo("c-app").length, 1);
      assert.strictEqual(pushTo("c-app")[0].url, "/FOODSAVE_APP.html#voucher");
      assert.ok(/MOI20/.test(pushTo("c-app")[0].body));
      assert.strictEqual(pushTo("o-app").length, 0, "đã tắt nhóm Khuyến mãi");
      await adminOpsService.adminOpsService.toggleVoucher(v.id, false, null, null);
      await adminOpsService.adminOpsService.toggleVoucher(v.id, true, null, null);
      assert.strictEqual(pushTo("c-app").length, 1, "bật/tắt lại không báo thêm");
      await adminOpsService.adminOpsService.createVoucher(null, { code: "SAUNAY", name: "Sau này", percent_off: 10, starts_at: iso(48 * HOUR), expires_at: iso(72 * HOUR) }, null);
      assert.strictEqual(pushTo("c-app").length, 1, "chưa tới ngày bắt đầu thì chưa báo");
    });
    db.table("profiles").find((p) => p.id === OTHER).metadata = {};
  });

  const failed = results.filter((r) => !r[0]).length;
  console.log("\n" + (results.length - failed) + "/" + results.length + " kịch bản đạt" + (failed ? ", " + failed + " KHÔNG ĐẠT" : "") + ".\n");
  process.exit(failed ? 1 : 0);
})();
