/**
 * Sinh cặp khóa VAPID cho Web Push:
 *   npm run gen:vapid        (hoặc: node scripts/generate-vapid-keys.js)
 *
 * Khóa chỉ được IN RA MÀN HÌNH một lần, KHÔNG ghi vào file nào. Bạn tự:
 *   1. Dán 3 dòng vào file .env (không commit) và vào Netlify → Site settings → Environment variables.
 *      VAPID_PRIVATE_KEY là BÍ MẬT (đánh dấu Secret nếu Netlify cho phép).
 *   2. Cất bản sao ở nơi an toàn khác. ĐỔI khóa = mọi thiết bị đang bật thông báo phải bật lại.
 *   3. Không gửi khóa riêng qua chat/email, không dán vào code hay GitHub.
 * VAPID_SUBJECT là địa chỉ liên hệ của nhóm, dạng mailto:email-của-nhóm@example.com
 */
const webpush = require("web-push");

const keys = webpush.generateVAPIDKeys();
console.log("\nVAPID_PUBLIC_KEY=" + keys.publicKey);
console.log("VAPID_PRIVATE_KEY=" + keys.privateKey);
console.log("VAPID_SUBJECT=mailto:THAY-BANG-EMAIL-CUA-NHOM@example.com\n");
console.log("Dán 3 dòng trên vào .env và Netlify (sửa VAPID_SUBJECT). Khóa riêng là bí mật, đừng commit hay gửi qua chat.\n");
