// Kiểm thử các hàm tính hạn của quy trình đơn hàng (không cần database).
// Chạy: npm run build && node scripts/test-order-policy.js
// Thử hệ số demo:  DEMO_MODE=true ORDER_POLICY_TIME_SCALE=0.05 node scripts/test-order-policy.js
const assert = require("assert");
const p = require("../dist/constants/orderPolicy");

const scale = p.timeScale();
const M = 60_000;
let passed = 0;
const t = (name, fn) => { fn(); passed += 1; console.log("  OK  " + name); };

t("hệ số thời gian đúng theo môi trường", () => {
  if (process.env.DEMO_MODE === "true" && process.env.ORDER_POLICY_TIME_SCALE) assert.strictEqual(scale, Number(process.env.ORDER_POLICY_TIME_SCALE));
  else assert.strictEqual(scale, 1);
});

t("bảng thời hạn theo nhãn đúng đặc tả 2.1", () => {
  assert.deepStrictEqual([p.LABEL_POLICY.green.payMinutes, p.LABEL_POLICY.green.pickupMinutes, p.LABEL_POLICY.green.cancelFreeBeforePickupMinutes], [10, 120, 30]);
  assert.deepStrictEqual([p.LABEL_POLICY.yellow.payMinutes, p.LABEL_POLICY.yellow.pickupMinutes, p.LABEL_POLICY.yellow.cancelFreeBeforePickupMinutes], [10, 90, 20]);
  assert.deepStrictEqual([p.LABEL_POLICY.red.payMinutes, p.LABEL_POLICY.red.pickupMinutes, p.LABEL_POLICY.red.cancelFreeBeforePickupMinutes], [5, 60, 15]);
});

t("nhãn của đơn = nhãn khẩn cấp nhất (đỏ > vàng > xanh)", () => {
  assert.strictEqual(p.mostUrgentLabel(["green", "yellow"]), "yellow");
  assert.strictEqual(p.mostUrgentLabel(["green", "red", "yellow"]), "red");
  assert.strictEqual(p.mostUrgentLabel(["green"]), "green");
  assert.strictEqual(p.mostUrgentLabel([]), "green");
});

t("hạn lấy hàng = min(paid_at + hạn nhãn, hạn sản phẩm)", () => {
  const paid = new Date("2026-10-28T10:00:00Z");
  const far = paid.getTime() + 1000 * 60 * M; // sản phẩm còn rất lâu
  const yellow = p.computePaymentTimeline("yellow", paid, far);
  assert.strictEqual(yellow.pickupDeadline.getTime(), paid.getTime() + 90 * M * scale);
  // sản phẩm hết hạn sớm hơn -> lấy hạn sản phẩm
  const soon = paid.getTime() + 40 * M * scale;
  assert.strictEqual(p.computePaymentTimeline("yellow", paid, soon).pickupDeadline.getTime(), soon);
  // không có hạn sản phẩm -> theo nhãn
  assert.strictEqual(p.computePaymentTimeline("red", paid, null).pickupDeadline.getTime(), paid.getTime() + 60 * M * scale);
});

t("hủy miễn phí = max(paid_at + 3 phút, hạn lấy - hạn tự hủy theo nhãn)", () => {
  const paid = new Date("2026-10-28T10:00:00Z");
  const green = p.computePaymentTimeline("green", paid, null);
  assert.strictEqual(green.cancelFreeUntil.getTime(), paid.getTime() + (120 - 30) * M * scale);
  const red = p.computePaymentTimeline("red", paid, null);
  assert.strictEqual(red.cancelFreeUntil.getTime(), paid.getTime() + (60 - 15) * M * scale);
  // hạn sản phẩm rất gần: luôn còn tối thiểu 3 phút đầu để sửa đặt nhầm
  const tight = p.computePaymentTimeline("red", paid, paid.getTime() + 10 * M * scale);
  assert.strictEqual(tight.cancelFreeUntil.getTime(), paid.getTime() + 3 * M * scale);
});

t("tạo đơn: cần >= hạn thanh toán + 15 phút tới hạn sản phẩm", () => {
  const now = Date.now();
  // nhãn đỏ: 5 + 15 = 20 phút
  assert.strictEqual(p.hasEnoughTimeToOrder("red", now, now + 19 * M * scale), false);
  assert.strictEqual(p.hasEnoughTimeToOrder("red", now, now + 20 * M * scale), true);
  // nhãn xanh/vàng: 10 + 15 = 25 phút
  assert.strictEqual(p.hasEnoughTimeToOrder("yellow", now, now + 24 * M * scale), false);
  assert.strictEqual(p.hasEnoughTimeToOrder("green", now, now + 25 * M * scale), true);
  assert.strictEqual(p.hasEnoughTimeToOrder("red", now, null), true);
});

t("hạn hiệu lực sớm nhất của nhiều sản phẩm", () => {
  assert.strictEqual(p.earliestDeadline(["2026-10-28T12:00:00Z", null, "2026-10-28T11:00:00Z"]), new Date("2026-10-28T11:00:00Z").getTime());
  assert.strictEqual(p.earliestDeadline([null, undefined]), null);
});

t("điểm uy tín: mức điểm đúng đặc tả 2.5-2.6", () => {
  const c = p.CUSTOMER_REPUTATION;
  assert.deepStrictEqual([c.pickupSuccessDelta, c.noShowDelta, c.lateCancelDelta, c.falseComplaintDelta, c.blockedBelow], [5, -15, -5, -10, 40]);
  assert.deepStrictEqual([p.NO_SHOW_BAN_COUNT, p.NO_SHOW_WINDOW_DAYS, p.RED_BAN_DAYS], [3, 60, 30]);
});

console.log(`\n${passed} kiểm thử đạt.`);
