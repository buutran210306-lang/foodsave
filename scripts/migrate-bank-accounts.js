/**
 * Chuyển số tài khoản ngân hàng ĐẦY ĐỦ đang lưu trong hồ sơ cửa hàng sang bảng store_payout_accounts (mã hóa AES-256-GCM)
 * rồi CHE các bản cũ chỉ còn 4 số cuối.
 *
 *   node scripts/migrate-bank-accounts.js                      # CHẠY THỬ (mặc định): chỉ đếm và báo cáo, KHÔNG ghi gì
 *   node scripts/migrate-bank-accounts.js --apply              # ghi thật (cần đã chạy SQL 035, có PAYOUT_ENCRYPTION_KEY, đã SAO LƯU)
 *   node scripts/migrate-bank-accounts.js --apply --status=verified   # đánh dấu tài khoản chuyển sang là "đã xác minh"
 *
 * Mặc định tài khoản chuyển sang ở trạng thái "pending_verification": admin phải xác minh lại trước khi cửa hàng rút tiền (an toàn nhất).
 *
 * Làm gì khi --apply:
 *  1. partner_profiles: với mỗi dòng còn số đầy đủ và có cửa hàng, nếu cửa hàng chưa có tài khoản hiện hành thì mã hóa + chèn
 *     vào store_payout_accounts; chỉ SAU KHI chắc chắn đã có tài khoản mã hóa mới che cột cũ (•••••6789).
 *  2. Che mọi bản sao số đầy đủ trong các cột JSON: applications.payload, profiles.metadata, partner_profiles.metadata.
 *  3. Số trong auth.users (user_metadata) chỉ được BÁO CÁO, không sửa (dùng Supabase Dashboard / Admin API nếu cần).
 * Không bao giờ in số tài khoản ra màn hình. Chạy lại nhiều lần an toàn (dòng đã che / đã có tài khoản thì bỏ qua).
 */
require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const statusArg = (args.find((a) => a.startsWith("--status=")) || "--status=pending_verification").split("=")[1];
if (!["pending_verification", "verified"].includes(statusArg)) { console.error("--status chỉ nhận pending_verification hoặc verified"); process.exit(1); }

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) { console.error("Thiếu SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY trong .env"); process.exit(1); }
const sb = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

// Dùng đúng hàm mã hóa của backend (cần đã chạy: npm run build)
let crypto;
try { crypto = require("../dist/utils/payoutCrypto"); } catch (e) { console.error("Chưa có dist. Hãy chạy `npm run build` trước."); process.exit(1); }
if (APPLY && !crypto.isPayoutKeyConfigured()) { console.error("Chưa có PAYOUT_ENCRYPTION_KEY hợp lệ trong .env. Sinh khóa: node scripts/generate-payout-key.js"); process.exit(1); }

const FULL = /^[0-9 ]{6,}$/;
const isFull = (v) => typeof v === "string" && FULL.test(v.trim());
const mask = (v) => crypto.maskAccountNumber(String(v).replace(/\D/g, ""));
const stats = { profiles_seen: 0, profiles_full: 0, migrated: 0, already_has_account: 0, skipped_no_store: 0, skipped_invalid: 0, masked_columns: 0, json_masked: { applications: 0, profiles: 0, partner_profiles: 0 }, auth_users_with_full: 0 };

/** Che mọi khóa bank_account_number / accountNumber còn số đầy đủ trong một đối tượng JSON; trả [đối tượng mới, đã sửa?] */
function maskJson(node) {
  if (Array.isArray(node)) { let changed = false; const out = node.map((x) => { const [v, c] = maskJson(x); changed = changed || c; return v; }); return [out, changed]; }
  if (node && typeof node === "object") {
    let changed = false; const out = {};
    for (const [k, v] of Object.entries(node)) {
      if ((k === "bank_account_number" || k === "accountNumber" || k === "bankNumber") && isFull(v)) { out[k] = mask(v); changed = true; }
      else { const [nv, c] = maskJson(v); out[k] = nv; changed = changed || c; }
    }
    return [out, changed];
  }
  return [node, false];
}

async function pages(table, columns, filterFn) {
  const rows = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await sb.from(table).select(columns).range(from, from + 499);
    if (error) throw new Error(table + ": " + error.message);
    rows.push(...(filterFn ? data.filter(filterFn) : data));
    if (!data || data.length < 500) break;
  }
  return rows;
}

(async () => {
  console.log("\n" + (APPLY ? "CHẠY THẬT (--apply)" : "CHẠY THỬ (không ghi gì)") + " · trạng thái tài khoản chuyển sang: " + statusArg + "\n");
  if (APPLY) console.log("Nhắc: bạn đã SAO LƯU database chưa? (Supabase → Database → Backups). Đợi 5 giây rồi bắt đầu...\n");
  if (APPLY) await new Promise((r) => setTimeout(r, 5000));

  // 1) partner_profiles -> store_payout_accounts
  const profiles = await pages("partner_profiles", "profile_id,store_id,bank_name,bank_account_number,bank_account_holder");
  stats.profiles_seen = profiles.length;
  for (const p of profiles) {
    if (!isFull(p.bank_account_number)) continue;
    stats.profiles_full += 1;
    if (!p.store_id) { stats.skipped_no_store += 1; continue; }
    const digits = crypto.normalizeAccountNumber(p.bank_account_number);
    if (!digits || !p.bank_name || !p.bank_account_holder) { stats.skipped_invalid += 1; continue; }

    const { data: existing, error } = await sb.from("store_payout_accounts").select("id").eq("store_id", p.store_id).in("status", ["pending_verification", "verified"]).limit(1);
    if (error) throw new Error("store_payout_accounts: " + error.message + " (đã chạy SQL 035 chưa?)");
    let safeToMask = existing && existing.length > 0;
    if (safeToMask) stats.already_has_account += 1;
    else if (APPLY) {
      const row = {
        store_id: p.store_id, bank_name: p.bank_name, account_holder_name: p.bank_account_holder,
        account_last4: crypto.last4Of(digits), account_number_encrypted: crypto.encryptAccountNumber(digits), status: statusArg,
        ...(statusArg === "verified" ? { verified_at: new Date().toISOString(), admin_note: "Chuyển từ hồ sơ cũ (migrate-bank-accounts)" } : {})
      };
      const { error: insertError } = await sb.from("store_payout_accounts").insert(row);
      if (insertError) { console.error("Không chèn được tài khoản của cửa hàng " + p.store_id + ": " + insertError.message); continue; }
      stats.migrated += 1; safeToMask = true;
    } else { stats.migrated += 1; } // thử: tính là sẽ chuyển

    if (APPLY && safeToMask) {
      const { error: maskError } = await sb.from("partner_profiles").update({ bank_account_number: mask(digits) }).eq("profile_id", p.profile_id);
      if (maskError) console.error("Không che được partner_profiles " + p.profile_id + ": " + maskError.message); else stats.masked_columns += 1;
    }
  }

  // 2) che bản sao trong JSON
  for (const [table, idCol, jsonCol, key] of [["applications", "id", "payload", "applications"], ["profiles", "id", "metadata", "profiles"], ["partner_profiles", "profile_id", "metadata", "partner_profiles"]]) {
    const rows = await pages(table, `${idCol},${jsonCol}`);
    for (const row of rows) {
      const [next, changed] = maskJson(row[jsonCol]);
      if (!changed) continue;
      stats.json_masked[key] += 1;
      if (APPLY) {
        const { error } = await sb.from(table).update({ [jsonCol]: next }).eq(idCol, row[idCol]);
        if (error) console.error(`Không che được ${table}.${jsonCol} (${row[idCol]}): ${error.message}`);
      }
    }
  }

  // 3) báo cáo auth.users
  for (let page = 1; ; page += 1) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    if (error) { console.error("Không đọc được auth.users: " + error.message); break; }
    for (const u of data.users) { const [, changed] = maskJson(u.user_metadata || {}); if (changed) stats.auth_users_with_full += 1; }
    if (data.users.length < 200) break;
  }

  console.log("KẾT QUẢ" + (APPLY ? "" : " (chạy thử, chưa ghi gì)") + ":");
  console.log(JSON.stringify(stats, null, 2));
  if (stats.auth_users_with_full) console.log("\nLưu ý: còn " + stats.auth_users_with_full + " tài khoản đăng nhập có số đầy đủ trong user_metadata (script không sửa phần này).");
  if (stats.skipped_no_store) console.log("Lưu ý: " + stats.skipped_no_store + " hồ sơ có số đầy đủ nhưng CHƯA có cửa hàng nên chưa chuyển/che (không mất dữ liệu).");
  if (!APPLY) console.log("\nĐể ghi thật: node scripts/migrate-bank-accounts.js --apply   (sau khi sao lưu và chạy SQL 035)\n");
})().catch((e) => { console.error(e); process.exit(1); });
