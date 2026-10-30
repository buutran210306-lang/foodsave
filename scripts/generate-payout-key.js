/**
 * Sinh khóa mã hóa số tài khoản nhận tiền (PAYOUT_ENCRYPTION_KEY): 32 byte ngẫu nhiên an toàn, dạng base64.
 *   node scripts/generate-payout-key.js
 *
 * Khóa chỉ được IN RA MÀN HÌNH một lần, KHÔNG ghi vào file nào. Bạn tự:
 *   1. Dán vào file .env (không commit) và vào Netlify → Site settings → Environment variables (đánh dấu Secret nếu có).
 *   2. Cất bản sao ở nơi an toàn khác (trình quản lý mật khẩu). MẤT KHÓA = KHÔNG GIẢI MÃ ĐƯỢC các số tài khoản đã mã hóa.
 *   3. Không gửi khóa qua chat/email, không dán vào code hay GitHub. Thay khóa = phải giải mã bằng khóa cũ và mã hóa lại.
 */
const crypto = require("crypto");

const key = crypto.randomBytes(32).toString("base64");
console.log("\nPAYOUT_ENCRYPTION_KEY=" + key + "\n");
console.log("Dán dòng trên vào .env và Netlify. Cất bản sao an toàn. Đừng commit, đừng gửi qua chat.\n");
