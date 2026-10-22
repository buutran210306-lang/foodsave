# FoodSave Vietnam: Ghi chú bàn giao

> Dành cho chủ dự án (sinh viên kinh doanh, không chuyên kỹ thuật) và cho Claude ở máy mới.
> **Nếu bạn là Claude:** đọc hết file này trước khi làm gì. Người dùng nói tiếng Việt, hãy trả lời tiếng Việt, giải thích đơn giản, hỏi trước khi sửa lớn. **Không tự chạy SQL trên Supabase**, chỉ viết file SQL để người dùng tự chạy.
>
> Cập nhật lần cuối: 16/10/2026. **Hạn nộp: 19/10/2026.** Nhánh làm việc: `refactor/3ben-flow`.

---

## 1. Dự án là gì
Nền tảng giải cứu thực phẩm cận hạn, có 4 bên:

| Bên | File giao diện | Vai trò |
|---|---|---|
| Người mua | `FOODSAVE_USER.html` | Xem sản phẩm, đặt hàng, nhận hàng bằng mã QR |
| Cửa hàng (Partner) | `FOODSAVE_PARTNER.html` | Đăng sản phẩm, nhận đơn, tặng hàng cho từ thiện |
| Tổ chức từ thiện (Charity) | `FOODSAVE_CHARITY.html` | Nhận lô tặng, phân tình nguyện viên |
| Tình nguyện viên (TNV) | `FOODSAVE_VOLUNTEER.html` | Đi lấy hàng, đưa mã cho cửa hàng |
| Quản trị (Admin) | `ADMIN_FOODSAVE.html` | Duyệt tài khoản, xem hệ thống |
| Trang chủ | `index.html` | Giới thiệu, chọn cổng |

## 2. Kiến trúc và nơi triển khai
- **Frontend** (các file HTML trong `frontend/` + thư mục gốc) → **Netlify** (`foodsavevn.netlify.app`).
- **Backend API** (`src/`, Express + TypeScript) → chạy như **Netlify Function** (`netlify/functions/api.ts`). Đường dẫn `/api/v1/*`.
- **Tác vụ định kỳ 5 phút** (đổi nhãn/giá, gửi thông báo, trả hàng quá hạn): `netlify/functions/label-automation.ts`. **Trên localhost không tự chạy**; dùng nút "Cập nhật nhãn ngay" ở Admin.
- **Dữ liệu + đăng nhập + ảnh**: **Supabase** (project `uqyqayrwhcicuctfnwix`). Deploy lại không làm mất dữ liệu.
- **Nguyên tắc đã chốt:** frontend chỉ đăng nhập Supabase và gọi Backend API; **không ghi thẳng vào database**, không có kiểu "API lỗi thì ghi Supabase trực tiếp".
- Cập nhật dữ liệu bằng **polling** (không Socket.io): cửa hàng và tổ chức làm mới mỗi 15 giây, người mua mỗi 60 giây (10 giây khi đang xem đơn hàng).

## 3. Cách chạy trên máy mới
1. `git clone` rồi `git checkout refactor/3ben-flow`.
2. Chép file **`.env`** từ máy cũ (không nằm trong Git). Mẫu ở `.env.example`. Cần: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CORS_ORIGINS` (có `http://127.0.0.1:5500`).
3. `npm install`
4. **`npm run dev`** (tự biên dịch rồi chạy cổng 8080). **Đừng dùng `npm start`**: nó chạy bản `dist` cũ chưa biên dịch lại → gây lỗi "Route was not found". Mỗi lần sửa backend phải tắt rồi chạy lại.
5. Mở các file HTML bằng Live Server (cổng 5500).
6. Tên file quyết định vai trò: `FOODSAVE_PARTNER`, `FOODSAVE_CHARITY` (code nhận vai trò theo tên file, nên đừng đổi tên).

## 4. Database: thứ tự chạy file SQL (Supabase → SQL Editor)
`database/User/001 → 007`, `database/Seller/008, 009`, `database/Charity/010, 011`, `database/Admin/014, 015`, `database/Product/016`, `database/Charity/017`, `database/Charity/018`.
Cũng có file `database/013_policy admin_view_partners.sql`.
**Bắt buộc phải chạy 016, 017, 018** cho các tính năng hiện tại. Tài khoản Admin chỉ cấp bằng SQL (file 015).
Tiền: mọi cột `*_cents` lưu **VND nguyên** (65.000đ = 65000), không nhân 100.

## 5. Quy tắc nghiệp vụ đã chốt
- Nhãn theo hạn: **xanh −20%, vàng −50%, đỏ −80%** (từ thiện miễn phí). Phí nền tảng **15%**. Phí cố định mỗi đơn 2.000đ.
- Thời gian còn lại = sớm hơn giữa hạn dùng và giờ đóng cửa. Còn dưới 1 giờ thì ngừng bán.
- Thông báo: vàng gửi 1 lần; đỏ gửi ngay rồi nhắc mỗi 30 phút, tối đa 3 lần. Thông báo gửi theo vai trò (toàn bộ người mua).
- Hàng đỏ còn từ 5 phần: tự chia 50% cho từ thiện (cửa hàng có thể tắt), 45 phút không ai nhận thì trả về bán.
- Thanh toán **chỉ là demo**: người mua bấm "Đã thanh toán". Route MoMo giả nên khóa/không dùng.
- Giấy tờ: cửa hàng cần CCCD 2 mặt + giấy phép kinh doanh + ATTP; từ thiện cần CCCD người đại diện + giấy phép hoạt động/quyết định thành lập.
- Bản đồ: dùng **OpenStreetMap + Leaflet + Photon** (không dùng Google Maps vì chưa bật thanh toán; không dùng `openstreetmap.org` hay CARTO vì mạng nhà người dùng không vào được). Code chung: `frontend/foodsave-map.js`.
- Đăng nhập TNV chỉ bằng **số điện thoại** (người dùng đã chấp nhận rủi ro cho bản demo).

## 6. Hai quy trình chính (đã code, CHƯA chạy thử với dữ liệu thật)

### A. Đơn hàng người mua → cửa hàng
1. Người mua đặt hàng → backend tạo đơn (trạng thái `pending`), giữ hàng, **thông báo cửa hàng**.
2. Người mua bấm "Đã thanh toán" → chỉ đổi trạng thái thanh toán; đơn vẫn `pending`.
3. Cửa hàng: **Nhận đơn** (`confirmed`) → **Sẵn sàng** (`ready`) → khách đưa mã QR, **cửa hàng nhập tay mã** → **Hoàn thành** (`completed`).
4. Người mua **không** tự bấm hoàn tất; được thông báo "Nhận hàng thành công". Hủy/từ chối thì hàng trả về kho.

### B. Tặng thực phẩm: cửa hàng ↔ tổ chức ↔ TNV
1. Cửa hàng bấm **tim** ở Kho hàng, chọn số phần (hoặc hệ thống tự tạo lô cho hàng đỏ). Hàng được giữ riêng, hết hạn nhận lời sau 45 phút.
2. Tổ chức (trong bán kính phục vụ) chọn lô trong **Donation Inbox** (ai nhấn trước được).
3. Cửa hàng **Chấp nhận / Từ chối** (từ chối thì lô mở lại).
4. Tổ chức **phân TNV** → hệ thống sinh **mã nhận hàng 6 ký tự**.
5. Cửa hàng bấm **Đã đóng gói xong**.
6. TNV mở `FOODSAVE_VOLUNTEER.html` (đăng nhập bằng số điện thoại), thấy mã + QR, bấm **Bắt đầu đi lấy**.
7. TNV đến đưa mã, **cửa hàng nhập mã** → bàn giao thành công (cộng chuyến và kg cho TNV, ghi nhận tác động môi trường).
- Cửa hàng không thấy mã trước; tổ chức không tự hoàn tất.
- Tổ chức tạo TNV ở mục **Tình nguyện viên → Thêm tình nguyện viên** (lưu thật, kích hoạt ngay).

## 7. Việc đã làm (tóm tắt)
- Giao diện tối giản cho cả 4 trang, giữ màu từng bên (Charity hồng/xanh/trắng; Partner xanh/vàng; User xanh/vàng cam; Admin thanh bên xanh tối). File style chung: `frontend/foodsave-minimal.css` (phần cuối file có khối màu riêng theo class `role-charity`, `role-partner`, `role-user` trên `<body>`).
- Màn đăng ký Charity và Partner: nửa trái cố định, nửa phải cuộn, nút điều hướng dính ở đáy.
- Sửa lỗi: gửi hồ sơ Partner chậm/bấm nhiều lần, lặp lỗi 401, bỏ in mật khẩu ra console, nút "Quản lý Cookie" bị lặp, chữ lệch ở trang người mua.
- Đơn hàng thật cho Partner; tặng thực phẩm thật; quy trình TNV; trang TNV kiểu điện thoại; người mua thấy trạng thái đơn đúng.
- Backend mới: `POST /donations/from-product`, các lệnh `store-response`, `assign-volunteer`, `packed`, `handover`, `POST /orders/:id/confirm-payment`, nhóm `/volunteer/*` (login, tasks, start); trả hàng về kho khi hủy đơn.

## 8. Việc còn lại / cần kiểm tra
**Ưu tiên cao (trước 19/10)**
- [ ] **Chạy thử cả hai quy trình ở mục 6 với tài khoản thật** (3 tài khoản: người mua, cửa hàng đã duyệt, tổ chức đã duyệt + 1 TNV). Mọi code ở mục 6 mới chỉ được kiểm tra cú pháp và giao diện bằng dữ liệu mẫu.
- [ ] Người dùng báo "đăng nhập TNV lỗi Route was not found": nguyên nhân là backend đang chạy bản cũ. **Tắt backend cũ, chạy `npm run dev`.** (Đã kiểm tra bản mới đăng nhập được với số 0363050455.)
- [ ] **Ảnh minh chứng từ thiện** (tổ chức chụp ảnh và phản hồi sau khi nhận): **chưa làm**, là mục duy nhất còn thiếu của phạm vi nộp bài.
- [ ] **Commit** toàn bộ thay đổi (hiện còn rất nhiều file chưa commit) và push GitHub → Netlify. Đặt biến môi trường trên Netlify (khóa Supabase...). Mở web một lần trước ngày demo (Supabase gói free tạm dừng sau 7 ngày không truy cập).
- [ ] Chuẩn bị tài khoản demo đủ 4 vai trò và kịch bản demo.

**Nên làm nếu còn thời gian**
- [ ] TNV mở được bằng điện thoại thật (cần deploy Netlify); thêm "cài lên màn hình chính" (PWA); nút "Tôi đã đến cửa hàng".
- [ ] Đợt 3: bản đồ thật ở trang từ thiện, khoảng cách ở trang người mua; thông báo "xả kho nhanh" qua Gmail/Brevo.
- [ ] Số "40" ghi cứng ở thanh bên Admin (số giả).
- [ ] Dọn thêm: gộp các khối `<style>` thừa trong từng trang, xóa code chết.

**Đã hoãn (sau deadline):** Web Push, đăng Facebook Fanpage, chia 50/50 chi tiết và chống lạm dụng, ví phí, tách nhỏ file lớn (`foodsave-auth-client.js` 223 KB).

## 9. Bài học và lưu ý kỹ thuật
- Sửa backend xong phải **biên dịch và chạy lại** (`npm run dev`). Lỗi "Route was not found" gần như luôn là do backend cũ.
- Khi sửa HTML lớn, đừng gỡ cả khối `<style>`/`<script>` mà không đọc: từng có lần cắt nhầm CSS thật của form đăng ký.
- Dữ liệu `Supabase` xem bằng tài khoản dịch vụ ở backend; trình duyệt dùng khóa `anon` công khai (không nhạy cảm).
- File `.env` **không** commit. Khóa dịch vụ (service role) tuyệt đối không đưa vào frontend.

## 10. Tài liệu liên quan
- `FoodSave_3ben_TongHop.docx`: tài liệu yêu cầu 3 bên.
- `README.md`: giới thiệu chung.

## Cập nhật 19/10: đội TNV nhiều người + ảnh minh chứng + báo cáo lô

- SQL mới (chạy theo thứ tự sau 020): `021_volunteer_roles_active.sql`, `022_volunteer_login_avatar.sql`, `023_team_assignments_photos.sql`.
- `donation_assignments`: mỗi dòng = 1 TNV ở 1 giai đoạn (`pickup` = số sản phẩm, `distribute` = số suất). Cột cũ `assigned_volunteer_id`, `distribute_volunteer_id`, `portions` vẫn được giữ đồng bộ (người đầu tiên / tổng suất).
- Một mã nhận hàng cho cả lô. Giai đoạn phát hoàn tất khi tất cả người phát đã báo xong (mỗi người >= 2 ảnh; người lấy hàng >= 1 ảnh).
- `donation_photos`: ảnh TNV chụp trong app (camera trực tiếp, chặn ảnh mờ/tối, đóng dấu giờ + mã lô + GPS). Tổ chức duyệt hoặc yêu cầu chụp lại; quá hạn `PHOTO_REVIEW_MINUTES` tự gửi sang cửa hàng (trừ ảnh lệch GPS). Ảnh nộp sau 20:00 tính hạn từ 8:00 sáng hôm sau (giờ VN). Tự duyệt chạy "lười" khi có người tải danh sách lô / xem ảnh.
- `DEMO_MODE=true` trong `.env` mới cho TNV tải ảnh từ thư viện (nút nhỏ "chế độ demo"); ảnh demo bỏ qua GPS và được gắn nhãn.
- API mới: `PUT /donations/:id/team`, `GET /donations/:id/photos`, `GET /donations/:id/report`, `PATCH /donations/photos/:id/review`; TNV: `POST /volunteer/tasks/:id/photos/upload-url`, `POST /volunteer/tasks/:id/photos`, `POST /volunteer/tasks/:id/complete`, `PATCH /volunteer/me/active`, `POST /volunteer/me/avatar-upload-url`.
- Dữ liệu thử: `database/Seed/test_seed_plan.sql` (xóa bằng 2 lệnh ở cuối file).
- Chưa làm: báo cáo ngày/tuần/tháng + xuất Excel, chuông và banner người mua, Marketing Studio, kênh n8n/Facebook.

## Cập nhật 19/10 (Gói 2): chuông + banner người mua, Marketing Studio, báo cáo theo kỳ, n8n

- SQL: `database/Product/024_marketing.sql` (cột `stores.marketing_auto/facebook_page_id/facebook_page_name`, bảng `marketing_posts`).
- Người mua: chuông thông báo dùng dữ liệu thật (`/notifications`, tự tải lại mỗi 20 giây), banner lớn hàng nhãn vàng/đỏ ở đầu trang chủ, banner nổi khi có khuyến mãi mới, hỗ trợ Notification của trình duyệt khi người dùng cho phép.
- Cửa hàng: menu "Marketing · Auto-bot" (`pMkt`): bật Auto-bot, nhập mã Fanpage, tạo bài đăng Facebook/Instagram/TikTok viết sẵn, poster tải về (canvas), "Đẩy người mua" (thông báo hàng loạt cho role customer, chống spam 20 phút), "Đẩy + đăng Fanpage" qua n8n.
- Backend `/api/v1/marketing/*` (`src/services/marketingService.ts`): nội dung bài đăng theo nhãn; `GET /marketing/feed` + `POST /marketing/feed/:id/posted` cho n8n (header `x-n8n-secret`); Auto-bot được gọi từ `labelAutomationService` khi hàng chuyển vàng/đỏ.
- n8n: thư mục `n8n/` có 2 workflow import được và `README.md` hướng dẫn (token Facebook chỉ nằm trong n8n).
- Tổ chức: thẻ "Báo cáo hoạt động theo kỳ" trong trang Báo cáo ESG (hôm nay / 7 ngày / 30 ngày / tất cả) + xuất CSV mở bằng Excel.
- `.env`: `N8N_WEBHOOK_URL`, `N8N_SECRET`, `PUBLIC_SITE_URL` (xem `.env.example`).

## Cập nhật 20/10: Marketing v3
- SQL: `database/Product/025_marketing_channels.sql` (cột `stores.marketing_channels`, `marketing_posts.variant`, trạng thái `ready`, kênh zalo/email). Chạy sau 024.
- Cài đặt kênh lưu trong hệ thống: công tắc Auto-bot chung + "Dùng kênh này" từng kênh ở tab Kết nối kênh. Kênh chưa điền thông tin thì không dùng được.
- Nội dung bài đăng theo nhóm hàng (cooked / fresh / packaged) × nhãn (đỏ, vàng, xanh); KHÔNG ghi số lượng còn lại (kể cả thông báo trong app).
- Bài nhắc cho hàng đỏ khi còn 1-2 giờ (một lần mỗi sản phẩm). Fanpage chung: 5 bài mỗi lượt, 12 bài mỗi ngày. Hàng xanh: chỉ thủ công, tối đa 2 chiến dịch mỗi ngày mỗi cửa hàng.
- Instagram / TikTok / Zalo / Email: tạo sẵn nội dung ("Nội dung sẵn sàng"), chưa tự đăng. Facebook: n8n, dự phòng đăng trực tiếp bằng `FACEBOOK_PAGE_TOKENS`.
- "Xả kho nhanh" nay là lối tắt của Marketing (không còn giảm giá giả).

## Cập nhật 21/10: sửa nhập mã QR chậm, chuông cửa hàng thật, bỏ Email
- **Lỗi nhập mã QR của người mua bị chậm rồi báo lỗi:** điểm uy tín cửa hàng dùng kết nối PostgreSQL trực tiếp (`DATABASE_URL`), máy chưa cấu hình thì bị từ chối sau ~4.5 giây và làm hỏng luôn bước hoàn tất đơn. Nay `isPostgresAvailable()` (src/config/postgres.ts) kiểm tra nhanh và tự bỏ qua phần điểm uy tín khi chưa có kết nối; các bước phụ của đơn hàng nằm trong try/catch nên không làm hỏng đơn. Muốn điểm uy tín hoạt động thật: đặt `DATABASE_URL` (chuỗi kết nối Supabase, chế độ pooler) trong `.env` và trên Netlify.
- Chuông thông báo trang Cửa hàng dùng dữ liệu thật (đơn mới, tổ chức nhận/giao việc, ảnh minh chứng, khiếu nại), có chấm đỏ, đánh dấu đã đọc, bấm là chuyển tới đúng mục.
- Marketing: thông báo trong ứng dụng FoodSave luôn bật mặc định (không có công tắc); bỏ kênh Email/Gmail. "Xả kho nhanh" và "Đẩy người mua" luôn gửi thông báo trong app.

## Cập nhật 21/10 (tối): AI Agent đăng bài 3 tầng + trang Admin + giao diện Marketing mới
- **SQL mới:** `database/Product/026_ai_agent.sql` (cột `marketing_posts.tier/meta`, bảng `app_settings`). Chạy sau 025.
- **3 tầng** (xem `n8n/README.md`): n8n (AI Gemini viết caption + ảnh) → caption mẫu + ảnh gốc → backend đăng trực tiếp (`FACEBOOK_PAGE_TOKENS`). Workflow xuất bằng `node n8n/build_workflows.js` ra `n8n/workflow-1-kenh-foodsave-ai.json` (Fanpage FoodSave, bài tổng hợp) và `n8n/workflow-2-cua-hang-ai.json` (Fanpage cửa hàng). Mã Node của workflow nằm ở `n8n/code/*.js`. Kiểm thử: `node n8n/test-tiers.js`.
- **Backend:** n8n báo kết quả về `POST /marketing/callback`; feed của Fanpage FoodSave trả bài tổng hợp (tối đa 3 món/bài, 5 bài/lượt, 12 bài/ngày); API admin `/marketing/admin/{overview,settings,preview,run}`.
- **Trang Admin:** mục "AI Agent đăng bài" (Tổng quan, Hàng chờ & xem trước, Lịch sử, Thiết lập). Chỉ đăng bài tổng hợp của FoodSave, không đăng thay cửa hàng.
- **Trang Đối tác:** giao diện Marketing 4 tab (patch `marketing-patch/apply.js`, bản Node của apply.py vì máy không có Python). Không còn "Đẩy người mua" hay kênh `buyers` trong giao diện này; thông báo trong app người mua do tác vụ đổi nhãn gửi tự động.
- **Bảo mật:** không lưu token trong code. File chứa token (`httpsgraph*.txt`) đã được thêm vào `.gitignore`: hãy xóa file đó khỏi thư mục dự án.
- **Quy tắc thông báo trong app (chốt 21/10):** nút "Xả kho nhanh" (trang Cửa hàng) LUÔN đẩy thông báo + banner cho người mua (kênh `buyers`, không có công tắc), cộng thêm các nền tảng đang bật. Mỗi sản phẩm chỉ nhắc lại sau 20 phút. Giao diện "Phát hành chiến dịch" trong Marketing thì chỉ đăng các nền tảng mạng xã hội, không gửi thông báo trong app. Hàng đổi nhãn vàng/đỏ vẫn được hệ thống tự thông báo cho mọi người mua.
