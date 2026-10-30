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

## Cập nhật 27/10: ghép đơn từ tổ chức đến nhiều cửa hàng
- Tổ chức đăng nhu cầu (ví dụ 50 phần bánh trước 18:00); hệ thống ghép các lô tặng (`donations`) của nhiều cửa hàng gần đó, đề xuất tối đa 3 phương án, tổ chức chọn một phương án để giữ hàng. Tính theo **số phần** (`donations.quantity`); lô cuối chỉ lấy đúng số phần còn thiếu, phần dư trả về kho sản phẩm.
- SQL mới (chạy sau 026): `database/Charity/027_charity_needs_matching.sql` (bảng `charity_needs` + hàm `reserve_donations_for_need`). Dữ liệu thử (tùy chọn): `database/Seed/seed_ghep_don.sql` (có câu lệnh dọn ở cuối file).
- Backend: `src/core/` (engine ghép, không sửa logic), `src/services/matchingService.ts`, `candidateBuilder.ts`, `matchingCategories.ts`, `src/routes/matchingRoutes.ts`, gắn tại `/api/v1/matching`: `POST/GET /needs`, `GET /needs/:id/plans`, `POST /needs/:id/reserve`, `POST /needs/:id/cancel`.
- Giao diện: mục "Ghép đơn" trong `FOODSAVE_CHARITY.html`, code ở `frontend/foodsave-matching.js`.
- Loại hàng lấy từ `products.category` ("Bánh ngọt / bánh tươi" = bakery, "Bữa ăn / cơm hộp" = meal). Thêm loại mới thì sửa `matchingCategories.ts` và danh sách trong `foodsave-matching.js`.
- Sau khi giữ hàng, các lô đi tiếp luồng cũ: cửa hàng chấp nhận/từ chối -> tổ chức phân TNV -> bàn giao. Nguồn thuật toán: FoodSave v2, engine match-v1.

## Cập nhật 28/10 (Đợt 1): đơn hàng trả trước, vắng mặt, điểm uy tín, chat theo đơn
Đặc tả: `YEU_CAU_QUY_TRINH_DON_HANG_PWA.md`. Đợt 1 gồm quy tắc đơn, điểm người mua, nhắc nhở, chat và giao diện v2 phần Tổng quan/Đơn hàng/Nhận hàng-QR (cửa hàng). Sổ cái tiền (Đợt 2), khiếu nại mới (Đợt 3), PWA + push (Đợt 4) **chưa làm**.

- **SQL (chạy theo thứ tự, thư mục `database/Orders/`):** `028_order_policy_enums.sql` (chạy RIÊNG trước) → `029_order_policy.sql` → `033_order_messages.sql`. Chưa chạy 028+029 thì tạo đơn sẽ lỗi. Hướng dẫn thử từng kịch bản: `database/Orders/HUONG_DAN_THU_DON_HANG.md`; dữ liệu thử: `database/Seed/seed_order_policy.sql`.
- **Quy tắc (một nguồn duy nhất: `src/constants/orderPolicy.ts`):** nhãn của đơn = nhãn khẩn cấp nhất. Hạn thanh toán / hạn lấy sau khi trả / hủy miễn phí trước hạn lấy: xanh 10/120/30 phút, vàng 10/90/20, đỏ 5/60/15. 3 phút đầu sau khi trả luôn hủy miễn phí. Tạo đơn bị từ chối nếu còn < hạn thanh toán + 15 phút tới hạn sản phẩm.
- **Vòng đời:** `awaiting_payment` → (trả) `pending` → `confirmed` → `ready` → `completed`; quá hạn trả → `cancelled (payment_timeout)`; quá hạn lấy **+ 5 phút châm chước** → `no_show` (cùng mốc cửa hàng còn được xác nhận hoàn tất). Cửa hàng **chỉ thấy đơn đã thanh toán**. Hủy sớm hoàn 100%; hủy muộn / vắng mặt không hoàn (tiền thuộc cửa hàng, trừ phí 2.000đ). Bỏ phương thức `cash`.
- **Điểm người mua (`customerReputationService`):** +5 nhận hàng, −5 hủy muộn, −15 vắng mặt, −10 khiếu nại sai (Đợt 3). 3 lần vắng mặt/60 ngày → khóa nhãn đỏ 30 ngày (`RED_LABEL_BANNED`); điểm < 40 → `CUSTOMER_BLOCKED`; admin mở khóa ở trang Admin → Uy tín. Trình duyệt **không** tự cộng điểm nữa (đã gỡ đoạn +5 cục bộ ở `FOODSAVE_USER.html`).
- **API mới:** `POST /orders/:id/cancel`, `GET|POST /orders/:id/messages`, `POST /orders/:id/messages/read`, `GET /orders/chat/unread`, `GET /customers/me/trust`, `POST /admin/order-automation/run`, `GET /admin/order-policy`, `POST /admin/customers/:id/unlock`. Người mua không còn dùng `PATCH /orders/:id/status` để hủy.
- **Tác vụ định kỳ:** `netlify/functions/order-automation.ts` (mỗi 5 phút, khai báo trong `netlify.toml`): hủy đơn quá hạn trả, đánh dấu vắng mặt, nhắc giữa chừng / nhắc cuối (có cờ chống gửi trùng), dọn chat quá 30 ngày. Chạy tay: Admin → Tự động hóa đơn hàng.
- **Chống ghi thẳng database:** đã gỡ `updateOrderPaymentDirect` (live-data) và hàm ghi đơn trực tiếp vào Supabase trong `FOODSAVE_USER.html`. Thanh toán luôn qua `POST /orders/:id/confirm-payment`. MoMo thật sau này chỉ cần gọi `orderService.markPaidBySystem` từ webhook.
- **Giao diện:** `frontend/foodsave-order-flow.js` (người mua: đếm ngược, hủy có nói rõ hoàn tiền hay không, chat), `frontend/partner-v2.js/.css` và `frontend/admin-v2.js/.css` (v2). `?demo=1` ở trang cửa hàng vẫn xem được toàn bộ bản mẫu; ngoài demo chỉ bật các màn đã nối API thật (Ví, Khiếu nại, Khách hàng, Khuyến mãi của v2 chờ Đợt 2-4). Tab "Chờ thanh toán" chỉ có ở demo vì cửa hàng không được thấy đơn chưa trả (đặc tả 2.2).
- **Biến môi trường:** `ORDER_POLICY_TIME_SCALE` (mặc định 1; chỉ có tác dụng khi `DEMO_MODE=true`; ví dụ 0.1 để rút ngắn mọi hạn 10 lần khi thử). Không cần biến nào khác ở Đợt 1.
- **Kiểm thử:** `npm run test:order` (công thức thời gian + 18 kịch bản trên database giả trong bộ nhớ, không chạm Supabase). Vẫn cần thử tay trên Supabase thật theo hướng dẫn.

### Giới hạn cần ghi nhận (đưa vào báo cáo)
- **Trả hàng về kho khi hủy muộn / vắng mặt:** vì cửa hàng đã nhận tiền, hàng chỉ **tự trả về kho nếu sản phẩm còn ít nhất 15 phút tới hạn hiệu lực và không bị chặn**. Ngược lại hàng không về kho và lý do được ghi vào bảng `order_events` (nhật ký đơn). Hủy sớm, cửa hàng hủy, quá hạn thanh toán: luôn trả về kho.
- Chat chỉ có văn bản (tối đa 500 ký tự, 20 tin/phút), chưa lọc số điện thoại / đường dẫn trong tin nhắn (việc sau). Cổng cửa hàng đang cập nhật chat bằng polling 6 giây (SQL đã bật Realtime, chưa nối ở trình duyệt). Chưa có push cho cổng cửa hàng.
- Voucher đã dùng không được hoàn lại khi đơn bị hủy (hành vi cũ, chưa đổi).
- Bảng cấu hình chính sách sửa được trên giao diện admin để Đợt 4; hiện chỉ đọc.

## Cập nhật 28/10 (Đợt 2): sổ cái tiền mô phỏng, ví cửa hàng, rút tiền, Tài chính · Sổ cái
- **SQL mới:** `database/Orders/030_wallet_ledger.sql` (chạy sau 029; chạy lại được). Bảng `wallets`, `ledger_entries`, `withdrawals`; hàm `fs_post_ledger` (idempotent, khóa ví theo thứ tự id), `fs_store_wallet`, `fs_request_withdrawal`, `fs_decide_withdrawal`, `fs_ledger_check`, `fs_finance_summary`; cột `orders.ledger_synced_status`. Bảng bật RLS, chỉ service role dùng.
- **Một cổng duy nhất:** `src/services/ledgerService.ts`. Quy ước tiền (VND nguyên): thanh toán `external → escrow`; hoàn tất, hủy muộn, vắng mặt `escrow → ví cửa hàng + doanh thu nền tảng (phí 2.000đ) + quỹ từ thiện` (hủy muộn / vắng mặt ghi `metadata.reason`); hủy sớm / cửa hàng hủy `escrow → external`; hoàn sau giải ngân (khiếu nại, Đợt 3) lấy lại từ ví cửa hàng trước, ví cửa hàng được phép âm; rút tiền `ví cửa hàng → external`. Mỗi bút toán có khóa chống trùng dạng `order:<id>:release:store`.
- **Nối vào đơn:** sau mỗi lần đơn đổi trạng thái tiền (thanh toán, hoàn tất, hủy, vắng mặt), `orderService` gọi `ledgerService.syncOrderSafe`: đưa sổ cái về khớp `settlement_status` của đơn. Nếu lần ghi sổ lỗi, đơn vẫn chạy bình thường và **tác vụ order-automation tự bù** (bước `ledger_sync`), nên **các đơn đã thanh toán ở Đợt 1 sẽ được ghi vào sổ cái ở lần chạy tác vụ đầu tiên sau khi chạy SQL 030** (bấm "Chạy tác vụ đơn hàng ngay" hoặc "Chạy đối soát ngay").
- **API mới:** cửa hàng `GET /partner/wallet`, `GET|POST /partner/withdrawals` (chỉ nhận **4 số cuối** tài khoản); admin `GET /admin/finance/summary`, `POST /admin/finance/reconcile`, `GET /admin/ledger`, `GET /admin/withdrawals`, `PATCH /admin/withdrawals/:id`.
- **Giao diện:** cổng cửa hàng: mục **Ví** (số dư khả dụng, đang giữ chờ, chờ duyệt rút, sổ giao dịch, rút tiền) và ô số dư ở Tổng quan, dữ liệu thật; admin: mục **Tài chính · Sổ cái** (đối soát, duyệt/từ chối rút, sổ cái có lọc). `?demo=1` vẫn xem dữ liệu mẫu.
- **Kiểm thử:** `npm run test:order` (29 kịch bản, gồm sổ cái và hai yêu cầu đồng thời trên database giả). Chứng minh ở **chính hàm SQL** phải tự chạy: `npm run test:ledger-db` (`scripts/test-ledger-concurrency.js`, dùng cửa hàng thử `seed-op-store`, tự cân bằng và dọn).
- **Rủi ro cần biết:** (1) số tài khoản đầy đủ trong hồ sơ đăng ký: ĐÃ XỬ LÝ ở "Phần A" bên dưới (mã hóa vào `store_payout_accounts`; dữ liệu cũ cần chạy script chuyển). (2) Số liệu "đã hoàn / tiền giữ lại" của Admin tính trong SQL từ sổ cái nên chỉ đúng với các đơn đã được ghi sổ.

## Cập nhật 29/10 (Phần A): sẵn sàng thanh toán / chi trả thật, tài khoản nhận tiền mã hóa
**Hiện tại vẫn là MÔ PHỎNG hoàn toàn: không có tiền thật, không nối MoMo hay ngân hàng.** Phần A chỉ làm sao cho sau này chuyển sang thật chỉ cần thay hai lớp nhà cung cấp (xem đặc tả mục 15).

- **SQL mới (chạy theo thứ tự sau 030):** `034_payment_provider.sql` (cột `orders.payment_provider/payment_ref`, bảng `payment_events`), `035_payout_accounts.sql` (**CẦN SAO LƯU `withdrawals` trước**: bảng `store_payout_accounts`, `payout_access_log`, trạng thái lệnh rút mới, hàm mới; lệnh rút cũ "approved" được chuyển thành "paid"). Chạy 034/035 **trước** khi triển khai backend mới, nếu không lệnh rút sẽ lỗi.
- **Lớp thu tiền:** `src/services/payments/` (`PaymentProvider`, `SimulatedPaymentProvider`, khung `MomoPaymentProvider`), webhook `POST /api/v1/payments/webhook/:provider` (`paymentWebhookService`), chọn bằng `PAYMENT_PROVIDER` (mặc định `simulated`). Khi dùng cổng thật, người mua không tự bấm "Đã thanh toán" được.
- **Lớp chi trả:** `src/services/payouts/` (`PayoutProvider`, `ManualPayoutProvider`, khung `BankApiPayoutProvider`), chọn bằng `PAYOUT_PROVIDER` (mặc định `manual`). Lệnh rút: `requested → approved → processing → paid` (hoặc `rejected`/`failed`); chỉ `paid` mới trừ ví, cần mã giao dịch ngân hàng; mọi bước idempotent.
- **Tài khoản nhận tiền:** `payoutAccountService` + `utils/payoutCrypto.ts` (AES-256-GCM, khóa `PAYOUT_ENCRYPTION_KEY`). API chỉ trả tên ngân hàng, chủ tài khoản, 4 số cuối. Admin xem số đầy đủ để chi có ghi `payout_access_log`. Đổi tài khoản phải được admin xác minh lại; chưa xác minh thì không rút được. Đăng ký cửa hàng gửi số đầy đủ qua `POST /partner/payout-account`; hồ sơ/metadata chỉ lưu dạng che. `PATCH /partner/profile` không còn nhận thông tin ngân hàng.
- **Dữ liệu cũ cần chuyển (CHƯA chạy):** số tài khoản đầy đủ đang nằm ở `partner_profiles.bank_account_number`, và bản sao trong JSON của `applications.payload`, `profiles.metadata` (`partner_registration.finance`), `partner_profiles.metadata`, `auth.users` (user_metadata). Chạy `database/Orders/INSPECT_bank_data.sql` (chỉ đọc) để đếm, sao lưu, rồi `npm run migrate:bank-dry` (chạy thử, không ghi) và `node scripts/migrate-bank-accounts.js --apply`. Phần `auth.users` chỉ được báo cáo, không tự sửa.
- **Giao diện:** cổng cửa hàng: Ví có tài khoản nhận tiền + trạng thái xác minh, lệnh rút chỉ nhập số tiền, nút "Tài khoản nhận tiền" trong Cài đặt thay cho sửa số tài khoản; Admin → Tài chính: bảng tài khoản chờ xác minh (cảnh báo tên lệch), lệnh rút theo trạng thái (Duyệt / Bắt đầu chi / Xem số TK để chi / Đã chi kèm mã giao dịch / Thất bại / Từ chối).
- **Biến môi trường mới:** `PAYMENT_PROVIDER`, `PAYOUT_PROVIDER`, `PAYOUT_ENCRYPTION_KEY` (bí mật; sinh bằng `npm run gen:payout-key`, cất bản sao an toàn, **mất khóa = không đọc được số tài khoản đã mã hóa**). Khung MoMo dùng `MOMO_PARTNER_CODE`, `MOMO_ACCESS_KEY`, `MOMO_SECRET_KEY` (không đặt giá trị thật vào repo).
- **Giới hạn: mỗi chủ tài khoản chỉ hỗ trợ MỘT cửa hàng cho ví, tài khoản nhận tiền và lệnh rút** (hệ thống lấy cửa hàng đầu tiên của chủ tài khoản; chủ tài khoản có nhiều cửa hàng cần làm thêm phần chọn cửa hàng). Quyết định ngày 29/10: tài khoản chuyển từ dữ liệu cũ để ở trạng thái "chờ xác minh" (không dùng `--status=verified`), admin duyệt lại từng cửa hàng.
- **Giới hạn:** `MomoPaymentProvider` và `BankApiPayoutProvider` chỉ là khung (ném lỗi "chưa cấu hình"); chữ ký MoMo thật chưa được kiểm thử; hoàn tiền sau khi lệnh đã `paid` (ngân hàng trả lại tiền) chưa có giao diện; mô hình giữ hộ tiền cần tham vấn pháp lý trước khi chạy thật.

## Cập nhật 29/10 (Đợt 3): khiếu nại có ảnh, cửa hàng phản hồi 12 giờ, Admin quyết định, hoàn tiền + điểm
- **SQL mới:** `database/Orders/031_complaint_flow.sql` (chạy sau 029; chạy lại được). Chỉ THÊM cột vào `complaints` (không đổi dữ liệu cũ), chỉ mục "mỗi đơn một khiếu nại" (bỏ qua kèm thông báo nếu đang có đơn trùng), và **gỡ hai policy cho phép ghi trực tiếp** (`complaints_customer_insert`, `complaints_store_owner_update`) để mọi thay đổi đi qua backend. Quay lại: chạy lại hai lệnh `create policy` trong `database/User/001_foodsave_schema.sql`.
- **Quy trình (`src/services/complaintService.ts`):** người mua gửi khiếu nại cho đơn **đã hoàn tất**, trong hạn (12 giờ nếu có món nấu chín, 24 giờ nếu không), **bắt buộc ≥ 1 ảnh** (tải qua `POST /orders/complaints/upload-url`, lưu trong kho `partner-assets/complaints/`, backend chỉ nhận đường dẫn ảnh của chính FoodSave) và chọn lý do (`wrong_item`, `spoiled_expired`, `missing_items`, `other`); mỗi đơn một khiếu nại. Cửa hàng có 12 giờ: `POST /orders/complaints/:id/respond` với `accept` (hoàn 100%, xong) hoặc `dispute` (bắt buộc lý do, kèm ảnh tùy chọn, chuyển Admin). Quá 12 giờ không phản hồi: `order-automation` tự chuyển Admin. Admin quyết định `POST /admin/complaints/:id/decision`: `refund_full`, `refund_partial` (số tiền > 0 và < tổng đơn), `reject` (+ `is_false_claim`), kèm ghi chú bắt buộc. Mọi chuyển trạng thái chiếm quyền bằng điều kiện trạng thái nên bấm lặp / đồng thời chỉ có một lần thắng.
- **Hệ quả:** hoàn tiền qua sổ cái (lấy lại từ ví cửa hàng, hoàn một phần trừ từ phần cửa hàng trước) và `PaymentProvider.refund` (kết quả ghi vào `order_events`); khiếu nại đúng (cả hoàn một phần) trừ **15 điểm cửa hàng** và ghi `seller_violations` loại `COMPLAINT_UPHELD` (qua `sellerComplaintPenalty.ts`, **dùng Supabase client nên chạy được cả khi chưa đặt `DATABASE_URL`**); khiếu nại sai (bác bỏ + đánh dấu) trừ **10 điểm người mua**. Trừ điểm / gọi nhà cung cấp có khóa chống trùng theo `order_events`. Nếu lần xử lý bị lỗi giữa chừng, `order-automation` (bước `complaints_complete`) hoàn tất phần còn dang dở. Thông báo cho các bên ở mỗi bước (`createNotification`).
- **Khiếu nại CŨ** (tạo trước Đợt 3, `reason_code` null): vẫn chạy luồng cũ qua `PATCH /orders/complaints/:id`; khiếu nại mới không dùng được luồng cũ và ngược lại. Không sửa dữ liệu cũ.
- **Giao diện:** người mua (`foodsave-order-flow.js`): đếm ngược "còn bao lâu để báo vấn đề", form có lý do + tải ảnh thật, xem trạng thái / phản hồi cửa hàng / quyết định / số tiền hoàn. Cổng cửa hàng (`partner-v2.js`): trang Khiếu nại nối API thật (Đồng ý hoàn tiền 100% / Không đồng ý + lý do + ảnh), đã bỏ dữ liệu mẫu ngoài `?demo=1`. Admin (`admin-v2.js`): **Trung tâm khiếu nại** (3 cột), **Tranh chấp** (bảng điều khiển 5 ô lọc được, phân bố, 3 cửa hàng bị khiếu nại nhiều nhất, danh sách cần xử lý trước, bảng lọc), hồ sơ khiếu nại có ảnh, phản hồi cửa hàng, **lịch sử chat của đơn (chỉ đọc)** và biểu mẫu quyết định; dữ liệu mẫu cũ của mục Tranh chấp đã được thay bằng dữ liệu thật.
- **Giới hạn / rủi ro:** ảnh minh chứng nằm trong kho `partner-assets` ở dạng công khai (đường dẫn khó đoán, chưa phải ảnh riêng tư); nếu muốn riêng tư cần bucket riêng + link tạm thời. Điểm uy tín cửa hàng ngưỡng hạn chế/cấm (`checkAndApplyPenalties`) vẫn cần `DATABASE_URL`; khi thiếu thì chỉ trừ điểm và ghi vi phạm, chưa tự hạn chế cửa hàng. Chưa có thông báo đẩy (Đợt 4). Chưa có bước admin "yêu cầu thêm bằng chứng".
- **Kiểm thử:** `npm run test:order` gồm các kịch bản 10–13 (khiếu nại), phân quyền, dữ liệu cũ, đồng thời, khôi phục khi dang dở, danh sách theo vai trò và tải ảnh (xem `scripts/test-order-flow.js`).

## Cập nhật 29/10 (Đợt 4a): ứng dụng cài được (PWA) + thông báo đẩy (Web Push) cho người mua và tình nguyện viên
- **SQL**: `database/Orders/032_push_subscriptions.sql` (chạy lại được; có ghi chú hoàn tác). Tạo bảng `push_subscriptions` và cột `donation_assignments.reminder_sent_at`. Thứ tự SQL từ 028: 028, 029, 030, 031, 032, 033, 034, 035.
- **Biến môi trường mới (Netlify + .env)**: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (BÍ MẬT), `VAPID_SUBJECT` (dạng `mailto:email@nhom.com`). Sinh khóa bằng `npm run gen:vapid` (chỉ in ra màn hình, không ghi file). Thiếu khóa thì push tự tắt, hệ thống vẫn chạy bình thường. Đổi khóa = mọi thiết bị phải bật lại thông báo.
- **Ai có push**: chỉ người mua (FOODSAVE_USER) và tình nguyện viên (FOODSAVE_VOLUNTEER). Cổng cửa hàng và tổ chức KHÔNG có push (vẫn có chuông trong app).
- **Sự kiện gửi push cho người mua**: đã thanh toán, cửa hàng nhận/sẵn sàng/hoàn tất/hủy (hoàn tiền), nhắc giữa chừng và nhắc cuối hạn lấy, vắng mặt, cảnh báo lần 2, khóa nhãn đỏ, tin chat mới, khiếu nại có phản hồi/quyết định. **Tình nguyện viên**: có nhiệm vụ mới, nhắc nhiệm vụ lấy hàng còn ≤ 30 phút (đúng một lần).
- Mọi thông báo đi qua `createNotification()` (src/services/notificationService.ts); push lỗi không làm hỏng nghiệp vụ. Thiết bị trả 404/410 tự bị xóa.
- Bấm thông báo mở đúng đơn / khiếu nại / nhiệm vụ (qua `#order=`, `#complaint=`, `#task=`).
- **Giới hạn PWA (spec §9.4)**: iPhone chỉ nhận push khi iOS ≥ 16.4 VÀ đã "Thêm vào Màn hình chính" bằng Safari; phải bấm "Bật thông báo" và cho phép quyền; Android bật tiết kiệm pin có thể trễ thông báo; không có app trên Play Store/App Store; không theo dõi GPS nền; chỉ chạy trên HTTPS (file:// và http thường không đăng ký được service worker). Service worker không cache /api/.
- **Giới hạn đã biết khác**: ảnh bằng chứng khiếu nại đang để công khai; khi triển khai thật chuyển bucket riêng + link tạm thời. `DATABASE_URL` đã được đặt trên Netlify.
- **Kiểm thử**: `npm run test:order` 67/67 kịch bản (9 kịch bản push P1–P9); typecheck sạch; hai trang mở không lỗi JS.

## Cập nhật 30/10 (Đợt 4b): Admin và cổng cửa hàng dùng dữ liệu thật
- **SQL mới**: `database/Orders/036_admin_ops.sql` (chạy lại được, **không cần sao lưu**, có ghi chú hoàn tác). Tạo `order_policy_config`, `admin_audit_log`, `automation_runs`, `fraud_alert_status` và 2 cột `charity_profiles.rejection_reason / reviewed_at`. Chạy SQL 036 **trước** khi triển khai backend mới (backend vẫn chạy nếu thiếu bảng, nhưng màn Admin mới sẽ báo lỗi và không lưu được cấu hình).
- **Chính sách đơn chỉnh được** (`policyConfigService`): Admin sửa hạn thanh toán / lấy hàng / hủy miễn phí / nhắc cuối theo nhãn, hủy cực ngắn, thời gian tối thiểu tới HSD, số lần vắng mặt, số ngày tính, số ngày khóa nhãn đỏ. Kiểm tra hợp lệ ở máy chủ (ví dụ hủy miễn phí < hạn lấy hàng). Backend đọc DB, nhớ tạm 30 giây, **không đọc được / dữ liệu sai thì dùng giá trị đang chạy (mặc định trong `src/constants/orderPolicy.ts`)**. Đơn đã tạo giữ nguyên các hạn đã lưu (`pickup_deadline`, `cancel_free_until`); chỉ đơn mới theo giá trị mới. Mỗi lần lưu ghi `admin_audit_log` (trước/sau, người sửa). Chưa chỉnh được: điểm uy tín, hạn khiếu nại, phí nền tảng 2.000đ, rút tối thiểu, giới hạn chat (vẫn là hằng số).
- **Tự động hóa**: bảng `automation_runs`. Ghi mỗi lần chạy của `label-automation`, `order-automation` và hai bước con `complaint-escalation`, `push-reminders` (chạy trong order-automation, mỗi bước có dòng nhật ký riêng). Admin thấy lần chạy gần nhất, lỗi gần nhất, số lần chạy/lỗi 7 ngày; nút "Chạy ngay" cho từng tác vụ (`POST /admin/automation/:job/run`).
- **Quản lý nhãn / Xác minh hồ sơ / Voucher / ESG / Cảnh báo gian lận / Uy tín / Dashboard / Nhật ký**: API `GET /admin/labels`, `/verification` + `POST /admin/verification/:kind/:id/decision`, `/vouchers` (GET, POST, PATCH), `GET /admin/esg?month=YYYY-MM`, `/fraud-alerts` + `POST /admin/fraud-alerts/handle`, `GET /admin/dashboard/work`, `GET /admin/audit-log`; mở khóa khách vẫn `POST /admin/customers/:id/unlock` (nay ghi nhật ký). Duyệt/từ chối hồ sơ gửi thông báo cho chủ hồ sơ; từ chối bắt buộc có lý do.
- **Cảnh báo gian lận tự tính**, không bịa số: (1) khách hủy/vắng mặt ≥ 50% trong 30 ngày (từ 5 đơn), (2) vắng mặt ≥ 2 lần trong 60 ngày, (3) đơn chờ thanh toán > 30 phút, (4) ≥ 3 tài khoản đăng nhập cùng IP trong 7 ngày (tín hiệu yếu: wifi chung cũng trùng). Mức cảnh báo là Cao/Trung bình/Thấp, **không có điểm rủi ro số**. "Xử lý"/"Bỏ qua" chỉ ghi trạng thái + người xử lý + nhật ký, không tự khóa ai. **KHÔNG phát hiện được** (đã ghi trên màn hình): dùng chung thiết bị (chưa thu thập vân tay thiết bị), dùng chung thẻ/ví thanh toán (thanh toán đang mô phỏng), đánh giá giả, hoàn tiền bất thường theo cửa hàng.
- **Cổng cửa hàng** (`/partner/customers`, `/partner/vouchers`): Khách hàng tổng hợp từ đơn của chính cửa hàng (không tính đơn chờ thanh toán), **số điện thoại che ở máy chủ** (3 số đầu + 3 số cuối), không có cột đánh giá vì chưa có dữ liệu đánh giá theo từng khách. Khuyến mãi: tạo / bật / tắt voucher của cửa hàng (chỉ cửa hàng đầu tiên của chủ tài khoản; xem giới hạn một cửa hàng ở Phần A). Nhận hàng · QR: thêm quét bằng camera (`BarcodeDetector` của trình duyệt, cùng cách với quét barcode sản phẩm); quét xong hỏi xác nhận trước khi hoàn tất. Trình duyệt không có `BarcodeDetector` (ví dụ Safari cũ, Firefox) vẫn nhập mã tay.
- **Dữ liệu mẫu**: ở Admin, dashboard / cảnh báo gian lận / nhật ký / uy tín và số đếm trên menu chỉ còn dữ liệu mẫu khi thêm `?demo=1`. Ở cổng cửa hàng, Khách hàng / Khuyến mãi mẫu chỉ ở `?demo=1`. **Các màn Admin chưa nằm trong Đợt 4b vẫn hiển thị dữ liệu mẫu của bản thiết kế** (Người dùng, Quản trị viên, Cửa hàng, Tổ chức, Lô tồn kho, Đơn hàng, Thanh toán, Chi trả, Marketing mẫu, Cấu hình): chưa nối API thật.
- **Kiểm thử**: `npm run test:order` 76/76 kịch bản (thêm Q1–Q9 cho 4b); `node scripts/test-order-policy.js` 8/8; headless Chrome mở không lỗi JS: Admin 10 màn (dashboard, chính sách, tự động hóa, nhãn, xác minh, voucher, ESG, gian lận, uy tín, nhật ký), cổng cửa hàng 7 màn, cổng người mua 11 trang. Chưa kiểm thử: quét camera thật (cần điện thoại + HTTPS), quyền `requireRoles("admin")` ở tầng HTTP (kiểm thử gọi thẳng service).

## Rà soát cuối (30/10): đặc tả so với mã
Đặc tả: `YEU_CAU_QUY_TRINH_DON_HANG_PWA.md`. Bộ kiểm thử tự động (76 kịch bản trên database giả, gồm các kịch bản 1–19 của đặc tả: đơn, sổ cái, rút tiền, khiếu nại, chat, thanh toán/chi trả) được chạy lại sau khi hoàn tất Đợt 4b; kịch bản 20–22 (giao diện) kiểm bằng headless Chrome với API giả. Không hồi quy. **Chỗ khác với đặc tả** (cố ý, nêu rõ để không bị bất ngờ):
1. §14.4 Chính sách: lưu ở bảng mới `order_policy_config` (SQL 036), vì SQL 029 không có bảng `order_policy` như đặc tả mô tả.
2. §14.4 Cảnh báo gian lận: đặc tả có điểm rủi ro, 5 ô theo ngưỡng điểm và các hành động điều tra / đóng băng / thử thách / cấm. Mã làm: tự tính từ dữ liệu thật, mức Cao/Trung bình/Thấp, chỉ "Xử lý"/"Bỏ qua" (theo yêu cầu 30/10), không đóng băng/cấm tự động.
3. §14.4 Tranh chấp: chỉ có luồng quyết định (hoàn đủ / một phần / bác bỏ + đánh dấu khiếu nại sai). Các hành động "nhận xử lý", "yêu cầu bằng chứng", "leo thang tay" không làm (đã chốt 29/10: bỏ "yêu cầu thêm bằng chứng").
4. §14.4 Dashboard: dải 5 ô đúng như đặc tả (khiếu nại chờ Admin, rút tiền/tài khoản chờ duyệt, tiền giữ chờ, khách bị khóa nhãn đỏ, hồ sơ chờ xác minh); cảnh báo gian lận hiển thị dạng dòng nhắc bên dưới.
5. §14.4 Tự động hóa: khiếu nại quá hạn và push là hai bước con của `order-automation` (cùng lịch 5 phút), mỗi bước có dòng nhật ký riêng; chưa có lịch riêng cho từng bước.
6. §14.2 Khách hàng của cửa hàng: không có "đánh giá" theo khách; "khách quay lại" = khách có ≥ 2 đơn hoàn tất. Khuyến mãi dùng `/partner/vouchers` (không phải `/vouchers`).
7. §14.4 Xác minh hồ sơ: chưa hiển thị giấy tờ / giấy phép (hệ thống chưa lưu tệp giấy tờ); Admin duyệt dựa trên thông tin đã nhập.
8. §14.4 Voucher: giao diện Admin chỉ tạo voucher toàn sàn (API hỗ trợ `store_id` nhưng chưa có ô chọn cửa hàng).
9. §9: push chỉ cho người mua và tình nguyện viên (đúng đặc tả); cổng cửa hàng / tổ chức không có.
10. Mã còn các khóa MoMo **sandbox công khai** làm giá trị mặc định trong `src/config/env.ts`; phải đặt biến môi trường thật hoặc bỏ mặc định trước khi chạy thật.

## Kiểm tra trước khi triển khai
1. **Sao lưu** bảng `withdrawals` trước SQL 035 (đã làm ở Phần A); SQL 036 không cần sao lưu.
2. **Thứ tự SQL (Supabase → SQL Editor)**: `028` (chạy riêng) → `029` → `030` → `031` → `032` → `033` → `034` → `035` → `036`. Tất cả chạy lại được. Seed thử: `database/Seed/seed_order_policy.sql` (chỉ môi trường thử).
3. **Biến môi trường trên Netlify** (không đặt giá trị thật vào repo): `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `CORS_ORIGINS`; `PAYMENT_PROVIDER` (`simulated` cho tới khi nối MoMo thật), `PAYOUT_PROVIDER` (`manual`), `PAYOUT_ENCRYPTION_KEY` (bí mật, `npm run gen:payout-key`, cất bản sao); `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (bí mật), `VAPID_SUBJECT` (`npm run gen:vapid`). **Môi trường thật: `DEMO_MODE=false` và KHÔNG đặt `ORDER_POLICY_TIME_SCALE`** (hệ số rút ngắn thời gian chỉ dành cho thử nghiệm).
4. Sau khi triển khai: Netlify → Functions → xác nhận `label-automation` và `order-automation` chạy mỗi 5 phút; Admin → Tự động hóa phải hiện "lần chạy gần nhất" trong vòng ~10 phút.
5. Admin → Tài chính → "Chạy đối soát ngay" phải báo KHỚP (tổng số dư mọi ví = 0).
6. Thử trên điện thoại thật: cài PWA, bật thông báo, thanh toán một đơn (mô phỏng) khi đã tắt app; thử quét QR bằng camera ở cổng cửa hàng.
7. Admin → Chính sách: bấm "Lưu cấu hình" một lần thử, kiểm tra Nhật ký hoạt động ghi đúng, rồi "Khôi phục mặc định".
8. Nhắc lại các giới hạn đã biết: tiền vẫn mô phỏng; ảnh bằng chứng khiếu nại đang công khai (khi triển khai thật chuyển bucket riêng + link tạm thời); một cửa hàng mỗi chủ tài khoản; PWA/push theo giới hạn ở mục Đợt 4a; các màn Admin chưa nối API vẫn là dữ liệu mẫu.

## App người mua (PWA) — Đợt 1 (30/10)

- File mới: `FOODSAVE_APP.html` (từ `FOODSAVE_APP_demo.html`, giữ giao diện). Dùng chung `frontend/foodsave-live-data.js` (FS.sync: sản phẩm, cửa hàng, đơn, thông báo, khiếu nại, tác động) và `frontend/foodsave-auth-client.js` (phiên đăng nhập, OAuth). Không copy code của web.
- API thêm (không cần SQL): `GET /api/v1/catalog/policy` (luật hiện hành: số phút theo nhãn, điểm uy tín, giờ khiếu nại; công khai, chỉ đọc) và `GET /api/v1/orders/:id/cancel-preview` (xem trước hủy: hoàn bao nhiêu, trừ bao nhiêu điểm; dùng chung hàm `cancelOutcome` với hủy thật).
- Đăng nhập: Google/Facebook (OAuth Supabase, redirect về chính `FOODSAVE_APP.html`), SĐT + OTP (backend), Gmail + OTP (`signInWithOtp` / `verifyOtp type:'email'`).
  - Việc cần làm trong Supabase: Authentication → Providers → Email bật; Authentication → Email Templates → "Magic Link" và "Confirm signup": thay link bằng mã `{{ .Token }}`; Authentication → URL Configuration → thêm `https://<tên miền>/FOODSAVE_APP.html` vào Redirect URLs; Rate Limits: mặc định chỉ vài email/giờ, khi chạy thật nên gắn SMTP riêng.
- Tài khoản không phải người mua (từ thiện, cửa hàng, admin) đăng nhập vào app: bị đăng xuất và hiện hướng dẫn dùng cổng riêng. Kiểm tra vai trò xảy ra TRƯỚC khi ghi hồ sơ.
- Mã QR nhận hàng là mã QR THẬT (thư viện `qrcode-generator@1.4.4` từ cdnjs) mã hóa `orders.qr_code`, để cổng cửa hàng quét bằng camera được. (QR trên web hiện là họa tiết trang trí, không quét được.)
- Vườn cây: dùng cùng khóa `foodsave.treeGame.v1` / `foodsave.treeGame.creditedOrders.v1` và cùng khóa chống trùng `#<order_number>` với web. Chỉ cộng nước cho đơn `payment_status = paid` và `paid_at` trong 2 giờ gần nhất.

## App người mua (PWA) — Đợt 2: bản đồ (30/10)

- Dùng Leaflet 1.9.4 + `frontend/foodsave-map.js` của web (ảnh bản đồ OpenStreetMap France, tự chuyển Esri khi lỗi; tra địa chỉ Photon). Không thêm khóa/dịch vụ mới. `FOODSAVE_GOOGLE_MAPS_KEY` đang rỗng ở web nên app chỉ dùng Leaflet.
- Chỗ có bản đồ: Trang chủ "Gần bạn" (nhỏ, chạm mở màn Bản đồ), màn Bản đồ (ghim có số sản phẩm + chấm vị trí, chạm ghim mở cửa hàng), bước "Xác nhận vị trí" khi đăng ký (GPS / tìm địa chỉ / kéo ghim), trang Cửa hàng và Chi tiết đơn (bản đồ nhỏ + "Chỉ đường Google Maps").
- Vị trí lưu ở khóa `foodsave.nearby.location` (giống web); tên địa chỉ hiển thị ở `foodsave.app.locLabel`. Cửa hàng không có tọa độ thì không ghim. Mất mạng / chưa tải được Leaflet: hiện thông báo, danh sách cửa hàng vẫn dùng được.

## App người mua (PWA) — Đợt 3: thông báo (30/10)

- SQL mới `database/Orders/037_push_client.sql` (chạy SAU 032, không cần sao lưu, chạy lại được): cột `push_subscriptions.client` ('web' | 'app'). Chưa chạy thì vẫn hoạt động, chỉ là bấm thông báo sẽ mở bản web.
- Push đúng người, một lần mỗi sự kiện, qua `createNotification()`. Loại mới: `order-ready` ("Cửa hàng … đã chuẩn bị xong đơn, đến nhận trước hh:mm", gửi khi cửa hàng bấm "Sẵn sàng" ở cổng đối tác; trạng thái `ready` đã có sẵn nên KHÔNG cần SQL cho phần này) và `voucher-new`.
- Voucher mới: báo đúng một lần khi voucher được TẠO (không báo khi bật/tắt lại, không báo voucher chưa tới ngày bắt đầu). Voucher toàn hệ thống (Admin): 1 thông báo cho mọi người mua + push cho ai đã bật. Voucher của cửa hàng: chỉ người đã yêu thích hoặc đã đặt ở cửa hàng đó (tối đa 300 người). Hệ thống chưa có "cấp voucher riêng cho từng người".
- Cài đặt thông báo (Cá nhân → Cài đặt thông báo): 3 nhóm Đơn hàng / Tin nhắn & khiếu nại / Khuyến mãi & voucher, lưu ở `profiles.metadata.notification_prefs`. Chỉ tắt push; thông báo trong app (chuông) vẫn ghi.
- Bấm thông báo mở đúng màn trong app: `/FOODSAVE_APP.html#order=<id>`, `#chat=<id>`, `#complaint=<id>`, `#voucher`.
- App dùng `frontend/foodsave-pwa.js` với `FSPwa.init({client:'app', ui:false})` (không hiện thanh nút nổi của web). Banner trong app: kiểm tra thông báo mới mỗi 20 giây. Nhắc cập nhật khi service worker mới. Chính sách/điều khoản/hoàn tiền/trợ giúp dùng `foodsave-legal-content.js` (không có banner cookie).
- Cần cho push thật: biến môi trường VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT (đã nêu ở Đợt 4a). iPhone: iOS ≥ 16.4 và đã "Thêm vào Màn hình chính".

## App người mua (PWA) — Đợt 4: cài app từ web (30/10)

- `manifest-app.webmanifest`: `start_url` và `id` = `/FOODSAVE_APP.html`, `display: standalone`, `orientation: portrait`, `theme_color #14613b`, icon 192 / 512 / maskable-512 / apple-touch-180 (dùng icon sẵn có trong `icons/`; KHÔNG chạy `scripts/make-icons.js`). `FOODSAVE_APP.html` và `FOODSAVE_USER.html` đều trỏ manifest này, nên app cài từ web mở ra `FOODSAVE_APP.html`; cùng origin nên giữ phiên Supabase.
- `sw.js` lên `fs-v2`: cache vỏ app (icon, manifest, các tệp `frontend/*.js` dùng chung) + thư viện CDN cố định (Leaflet, Supabase JS, Tabler icons, qrcode-generator) ở kho riêng `fs-cdn-v1` (stale-while-revalidate). Không cache `/api/`, đơn hàng, thanh toán. Trang HTML vẫn mạng trước, mất mạng → `offline.html`. Mỗi lần phát hành đổi `CACHE_VERSION`.
- Web (`FOODSAVE_USER.html`), chỉ thêm: manifest, `frontend/foodsave-install.js`, mục "Cài đặt app" (chân trang + menu tài khoản). Không tự chuyển hướng ai sang app.
  - Điện thoại chưa cài: thanh "Cài app FoodSave để dùng tiện hơn – bấm để cài" (nút Cài + nút đóng; đóng = để sau 7 ngày, `localStorage foodsave.install.dismissedAt`).
  - Android/Chrome: `beforeinstallprompt.prompt()`. iPhone/Safari và trình duyệt không có hộp thoại: bảng hướng dẫn "Chia sẻ → Thêm vào MH chính".
  - Mục "Cài đặt app" hiện cả trên máy tính khi trình duyệt cho cài; ẩn khi đã cài (`appinstalled` hoặc đang chạy standalone, nhớ ở `foodsave.install.installed`). Gỡ app xong muốn hiện lại banner thì xóa khóa này.
  - Nút "Cài ứng dụng" nổi cũ của `foodsave-pwa.js` bị ẩn trên web để không trùng.

## App người mua (PWA) — Đợt 5: kiểm thử và hoàn thiện (30/10)

- `npm run typecheck` sạch; `npm run test:order` 79/79 (có kịch bản mới: xem trước huỷ khớp huỷ thật, push "cửa hàng chuẩn bị xong" đúng người / một lần / đúng đường dẫn app, tắt nhóm thông báo, voucher mới một lần). `test:ledger-db` cần database thật, chưa chạy.
- Giao diện đã thử bằng Chrome không đầu với API giả: không lỗi JS ở các luồng đăng nhập (Gmail, SĐT, tài khoản từ thiện bị chặn), người mới, đặt hàng, đơn, chat, huỷ, khiếu nại, bản đồ, thông báo, chính sách; banner cài app (điện thoại có / máy tính không); service worker + cache.
- CHƯA thử trên máy thật (cần bạn làm): GPS, Google/Facebook OAuth, OTP email/SMS thật, thanh toán MoMo thật, push thật, cài trên Android/iPhone, quét QR bằng camera. Danh sách từng bước: `HUONG_DAN_THU_APP_NGUOI_MUA.md`.
- Rủi ro còn lại: ảnh khiếu nại công khai; vị trí nhập tay không có toạ độ; không có API ví / voucher riêng / ticket hỗ trợ có lịch sử / Chat AI cho người mua; ESG và đánh giá cửa hàng chưa có API công khai (app ẩn các khối này); vườn cây còn lưu localStorage (đề xuất lưu server: bảng `tree_game_state(user_id, state jsonb, credited_orders text[])` + endpoint GET/PUT, cộng nước phía server khi `markPaid`, để đồng bộ web/app và chống gian lận).
