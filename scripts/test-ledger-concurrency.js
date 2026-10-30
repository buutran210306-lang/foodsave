/**
 * Kiểm thử ĐỒNG THỜI hàm SQL fs_post_ledger trên Supabase THẬT (bạn tự chạy sau khi đã chạy SQL 030).
 *   node scripts/test-ledger-concurrency.js
 *
 * An toàn: chỉ dùng ví của cửa hàng thử "seed-op-store" (từ seed_order_policy.sql) và ví "external",
 * mọi bút toán thử đều có khóa bắt đầu bằng "test-concurrency:", được cân bằng tổng bằng 0 rồi XÓA khi xong.
 * Không đụng đơn hàng hay tiền thật.
 *
 * Chứng minh: (1) gọi 10 lần ĐỒNG THỜI cùng một khóa chỉ ghi MỘT bút toán, (2) số dư chỉ đổi một lần,
 * (3) 20 yêu cầu chạy ngược chiều nhau cùng lúc không bị khóa chéo (deadlock), (4) đối soát tổng số dư vẫn bằng 0.
 */
require("dotenv").config();
const assert = require("assert");
const { createClient } = require("@supabase/supabase-js");

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Thiếu SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY trong .env"); process.exit(1); }
const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const post = (k, from, to, amount) => sb.rpc("fs_post_ledger", { p_key: k, p_order: null, p_type: "adjustment", p_from: from, p_to: to, p_amount: amount, p_meta: { test: true } });
const balance = async (id) => Number((await sb.from("wallets").select("balance_cents").eq("id", id).single()).data.balance_cents);

(async () => {
  const stamp = "test-concurrency:" + Date.now();
  let failed = 0;
  const check = (name, fn) => { try { fn(); console.log("  ĐẠT   " + name); } catch (e) { failed += 1; console.log("  KHÔNG ĐẠT   " + name + "\n         " + e.message); } };

  const { data: store } = await sb.from("stores").select("id").eq("slug", "seed-op-store").maybeSingle();
  if (!store) { console.error('Chưa có cửa hàng thử "seed-op-store". Hãy chạy database/Seed/seed_order_policy.sql trước.'); process.exit(1); }
  const storeWallet = (await sb.rpc("fs_store_wallet", { p_store: store.id })).data;
  const external = (await sb.from("wallets").select("id").eq("owner_type", "external").is("store_id", null).single()).data.id;
  assert.ok(storeWallet && external, "không lấy được ví");

  const b0 = { s: await balance(storeWallet), e: await balance(external) };
  console.log("\nKiểm thử đồng thời fs_post_ledger (Supabase thật)\n");

  // 1) 10 yêu cầu đồng thời, CÙNG một khóa
  const same = await Promise.all(Array.from({ length: 10 }, () => post(stamp + ":same", external, storeWallet, 1000)));
  check("10 lệnh đồng thời cùng khóa: không có lệnh nào lỗi", () => assert.strictEqual(same.filter((r) => r.error).length, 0, JSON.stringify(same.find((r) => r.error))));
  const { data: rows } = await sb.from("ledger_entries").select("id").eq("idempotency_key", stamp + ":same");
  check("chỉ có MỘT bút toán được ghi", () => assert.strictEqual(rows.length, 1));
  check("mọi lệnh trả về cùng một bút toán", () => assert.strictEqual(new Set(same.map((r) => r.data && r.data.id)).size, 1));
  const b1 = { s: await balance(storeWallet), e: await balance(external) };
  check("số dư ví cửa hàng chỉ tăng đúng 1.000", () => assert.strictEqual(b1.s - b0.s, 1000));
  check("số dư ví external chỉ giảm đúng 1.000", () => assert.strictEqual(b1.e - b0.e, -1000));

  // 2) 10 chiều xuôi + 10 chiều ngược, khóa khác nhau, chạy cùng lúc (kiểm tra khóa chéo)
  const forward = Array.from({ length: 10 }, (_, i) => post(stamp + ":f" + i, external, storeWallet, 500));
  const backward = Array.from({ length: 10 }, (_, i) => post(stamp + ":b" + i, storeWallet, external, 500));
  const mixed = await Promise.all([...forward, ...backward]);
  check("20 lệnh ngược chiều cùng lúc: không lỗi, không khóa chéo", () => assert.strictEqual(mixed.filter((r) => r.error).length, 0, JSON.stringify(mixed.find((r) => r.error))));
  const b2 = { s: await balance(storeWallet), e: await balance(external) };
  check("10 xuôi + 10 ngược triệt tiêu nhau", () => assert.deepStrictEqual(b2, b1));

  // 3) hoàn lại 1.000 ban đầu rồi dọn bút toán thử
  await post(stamp + ":undo", storeWallet, external, 1000);
  const b3 = { s: await balance(storeWallet), e: await balance(external) };
  check("sau khi hoàn lại, số dư về đúng ban đầu", () => assert.deepStrictEqual(b3, b0));
  const del = await sb.from("ledger_entries").delete().like("idempotency_key", "test-concurrency:%");
  check("đã dọn bút toán thử", () => assert.ok(!del.error, del.error && del.error.message));

  // 4) đối soát tổng
  const recon = (await sb.rpc("fs_ledger_check")).data;
  const r = Array.isArray(recon) ? recon[0] : recon;
  check("đối soát: tổng số dư mọi ví = 0 và không ví nào lệch bút toán", () => { assert.strictEqual(Number(r.total_balance), 0); assert.strictEqual(Number(r.mismatched_wallets), 0); });

  console.log("\n" + (failed ? failed + " kiểm tra KHÔNG ĐẠT." : "Tất cả đạt.") + "\n");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
