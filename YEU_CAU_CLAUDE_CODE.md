# YÊU CẦU CHO CLAUDE CODE — Auto-bot đăng Facebook có AI (FoodSave)

Hạn demo: 23/10 (thầy test trên link Netlify, KHÔNG dùng localhost). Đọc `HANDOFF.md`, `README.md`, `n8n/README.md`, `src/services/marketingService.ts`, `src/services/labelAutomationService.ts`, `src/config/env.ts` trước khi làm.

## 0. Quy tắc an toàn (bắt buộc)
- KHÔNG in, KHÔNG commit, KHÔNG sao chép token / App Secret / key Gemini / SUPABASE_SERVICE_ROLE_KEY ra chat, log, file JSON n8n hay code. Chỉ để trong `.env`, Credentials của n8n, biến môi trường Netlify.
- Không đọc file `httpsgraph.facebook.comv21.0meaccou.txt` (chứa token). Nhắc người dùng xoá hoặc đưa file ra khỏi thư mục dự án và thêm `*.txt` token vào `.gitignore`.
- Không chạy SQL tự động lên Supabase (SQL 024, 025 người dùng đã chạy xong).
- Không đổi tên các file `FOODSAVE_*.html` (vai trò được nhận theo tên file).
- Mọi file n8n JSON xuất ra phải để token/secret dạng chữ giữ chỗ (`DAN_TOKEN_VAO_DAY`).

## 1. Mục tiêu
**Quy tắc tên cửa hàng:** KHÔNG ghi cứng tên tiệm hay cửa hàng nào vào code, caption mẫu, prompt AI, workflow n8n hay giao diện. Tên cửa hàng, màu thương hiệu, địa chỉ luôn lấy từ dữ liệu cửa hàng (bảng `stores`) lúc chạy, vì người dùng sẽ đổi tên cửa hàng trên hệ thống sau này. Tên cửa hàng trong các file giao diện mẫu chỉ là dữ liệu giả.

Khi sản phẩm chuyển sang nhãn VÀNG hoặc ĐỎ (đặc biệt ĐỎ), hệ thống tự đăng bài Facebook có AI viết caption và AI tạo ảnh quảng cáo, đăng lên 2 Fanpage với 2 nội dung/ảnh KHÁC NHAU:

- **Fanpage của cửa hàng (tên và Page ID lấy từ dữ liệu cửa hàng trong hệ thống, hiện đang là Page ID 1309577678916167)** — workflow 2 (webhook `foodsave-promote`). Ảnh mang màu thương hiệu cửa hàng, nói rõ "cửa hàng X đang có món Y sắp hết hạn, đến mua ngay". Nhãn đỏ nhấn mạnh gấp/sắp hết.
- **Fanpage trung tâm FoodSave (Page ID 1350719658135154)** — workflow 1 (n8n kéo `GET /marketing/feed`). Ảnh/bài nói chung: hệ thống đang có các cửa hàng trên sàn có hàng nhãn đỏ/vàng cần người mua trước khi hết hạn, gợi ý vài món. Mục tiêu kinh doanh: người mua biết có hàng cần đến mua trước hạn.
- Nhãn xanh vẫn dùng mẫu hiện có (không gọi AI).

## 2. Kiến trúc 3 tầng (giữ đúng thứ tự)
1. **Tầng AI (trong n8n):** tải ảnh gốc `product.image_url` → Gemini viết caption → Gemini tạo ảnh nền từ ảnh gốc → n8n CHÈN CHỮ lên ảnh → upload `/{page-id}/photos` (multipart `source`) kèm caption.
2. **Tầng mẫu (vẫn trong n8n):** nếu bước AI lỗi/quá giờ → dùng `content.facebook` (caption mẫu backend đã gửi sẵn trong payload) + ảnh gốc, vẫn đăng. Dùng "Continue on fail" + node IF.
3. **Tầng backend:** n8n không gọi được → `postToFacebookDirect` trong `marketingService.ts` đăng thẳng bằng `FACEBOOK_PAGE_TOKENS` (đã có, giữ nguyên).

## 3. Quy tắc ảnh (kiểu poster GrabFood)
- AI chỉ tạo HÌNH: món ăn nổi bật, nền/ánh sáng theo màu cửa hàng (lấy từ cài đặt cửa hàng nếu có, không có thì chọn tông theo nhãn: vàng/đỏ), chừa khoảng trống để chèn chữ. Prompt dặn rõ: KHÔNG vẽ chữ.
- Chữ chèn bằng n8n (node Edit Image) hoặc ghép ảnh trong backend: tên cửa hàng, huy hiệu "GIẢM 80%/50%", giá mới, giờ nhận hàng. Số liệu lấy từ payload thật, không để AI tự bịa giá/giờ. Font hỗ trợ tiếng Việt có dấu.
- KHÔNG ghi "Ảnh minh hoạ" trên bài hay ảnh.
- Nếu model tạo ảnh không dùng được với key hiện có: chỉ dùng AI viết caption + ảnh gốc (có chèn chữ). Ảnh AI chỉ bật khi key hỗ trợ.

## 4. Quy tắc caption
Tiếng Việt, thân thiện, emoji vừa phải, hashtag. Giọng điệu theo nhóm món (nấu chín / tươi sống / đóng gói) và nhãn (đỏ gấp hơn vàng). Giữ đúng giá cũ/mới, giờ nhận. KHÔNG nhắc số lượng tồn kho. Gắn link `PUBLIC_SITE_URL` (chỉ khi https). Prompt phải đưa dữ kiện cố định vào và cấm sửa các con số.

## 5. Kỹ thuật bắt buộc
- Workflow 2: node **Respond to Webhook** trả lời ngay ở đầu luồng (backend chỉ chờ 8 giây: `AbortController` 8000ms trong `sendToN8n`), rồi chạy AI + đăng ở phía sau. Node AI đặt timeout ~20s.
- Nếu muốn backend biết kết quả sau khi n8n đăng xong, thêm callback ngược (giống `POST /marketing/feed/:id/posted` của workflow 1) — chỉ làm nếu đơn giản.
- Gemini key lưu trong Credentials của n8n, không viết trong Code node.
- Cập nhật `n8n/build_workflows.js` và xuất `n8n/workflow-2-cua-hang-ai.json`, `n8n/workflow-1-kenh-foodsave-ai.json` (workflow 1 phiên bản AI cho Fanpage trung tâm), có chữ giữ chỗ cho token/secret. Cập nhật `n8n/README.md`.
- n8n Cloud gọi ngược backend: `CONFIG.API` của workflow 1 phải là `https://<site>.netlify.app/api/v1`, không phải localhost.
- `PUBLIC_SITE_URL` phải là URL hợp lệ (schema zod bắt buộc), mặc định localhost.

## 6. Việc cần làm với `.env` (tạo sẵn, KHÔNG điền bí mật)
File `.env` hiện đã có Supabase và các biến cơ bản. Thêm vào cuối `.env` (nếu chưa có) các dòng sau với giá trị chữ giữ chỗ để người dùng tự điền:

```
# --- Marketing Studio / n8n / AI ---
N8N_WEBHOOK_URL=http://localhost:5678/webhook/foodsave-promote
N8N_SECRET=DOI_CHUOI_DAI_NGAU_NHIEN
PUBLIC_SITE_URL=http://localhost:5500/FOODSAVE_USER.html
FACEBOOK_PAGE_TOKENS={"1309577678916167":"DAN_TOKEN_FANPAGE_CUA_HANG","1350719658135154":"DAN_TOKEN_FOODSAVE"}
PHOTO_GPS_MAX_METERS=500
```
Cập nhật luôn `.env.example` nếu có biến mới (ví dụ biến cho Gemini nếu backend cần). `DATABASE_*` trong `env.ts` hiện không được dùng bởi code khác (đã kiểm tra: chỉ nằm trong `src/config/env.ts`) — không bắt người dùng điền. `MOMO_*` còn giá trị mẫu, chỉ cần nếu demo MoMo.
Sau đó chỉ rõ cho người dùng từng dòng cần điền và lấy ở đâu.

## 7. Deploy Netlify (n8n Cloud + link Netlify)
- Liệt kê biến môi trường cần đặt trên Netlify (tên biến, không giá trị): Supabase ×3, `CORS_ORIGINS` (thêm domain Netlify), `SOCKET_CORS_ORIGINS`, `PUBLIC_SITE_URL` (https Netlify), `N8N_WEBHOOK_URL` (webhook PRODUCTION của n8n Cloud, `/webhook/`, không phải `/webhook-test/`), `N8N_SECRET`, `FACEBOOK_PAGE_TOKENS`, `DEMO_MODE`, `PHOTO_REVIEW_MINUTES`, `LABEL_AUTOMATION_INTERVAL_MS`.
- Kiểm tra frontend gọi API Netlify (`/api/v1`) chứ không phải localhost.
- Xác nhận Scheduled Function `label-automation` (mỗi 5 phút) chạy trên bản production.
- Kiểm tra số lần chạy của n8n Cloud: workflow 1 mỗi 10 phút nên cho phép đổi 30–60 phút khi không demo.

## 8. Kiểm thử cả 3 tầng (làm xong báo cáo kết quả)
1. Bình thường: AI chạy → bài có ảnh và caption AI lên Fanpage.
2. Tắt/sai key Gemini → bài vẫn lên bằng caption mẫu + ảnh gốc (tầng 2).
3. Tắt n8n / sai `N8N_WEBHOOK_URL` → bài lên qua backend (tầng 3).
4. Nhãn xanh không gọi AI. Nhãn vàng/đỏ gọi AI; nhãn đỏ khác nhãn vàng về giọng điệu.
5. Hai Fanpage nhận hai ảnh/bài khác nhau.
6. Trang Marketing Studio (Báo cáo) hiển thị đúng trạng thái và lỗi.
Cuối cùng liệt kê những gì người dùng phải tự làm (điền token, key Gemini, tạo workflow trên n8n Cloud, đặt biến Netlify, xoá file chứa token).

## 9. Trang Admin: giao diện "AI Agent đăng bài" (CHƯA CÓ, cần làm)
Hiện `ADMIN_FOODSAVE.html` chưa có phần marketing/fanpage nào, và `marketingRoutes.ts` chỉ có API theo từng cửa hàng (`/settings`, `/posts`, `/products/:id/promote`) cho vai trò partner/admin, chưa có API tổng cho admin. Cần thêm:

**Giao diện (trong `ADMIN_FOODSAVE.html`, dùng đúng class/phong cách có sẵn của trang admin, KHÔNG đổi tên file):** mục mới "AI Agent · Fanpage FoodSave" gồm
- Thẻ trạng thái: Fanpage trung tâm (tên + Page ID 1350719658135154), trạng thái n8n (kết nối được hay không), trạng thái Gemini (bật/tắt), chế độ hiện tại (AI / mẫu / đăng trực tiếp).
- Công tắc "Bật AI Agent tự đăng bài" cho Fanpage trung tâm + giới hạn đang áp dụng (5 bài/lượt, 12 bài/ngày).
- Danh sách "hàng nhãn đỏ/vàng đang chờ đăng" (nguồn `centralFeed`), có nút "Đăng ngay" và "Xem trước nội dung/ảnh".
- Lịch sử bài đăng của FANPAGE TRUNG TÂM FoodSave (bài tổng hợp): nội dung (số món, nhãn), các cửa hàng có hàng trong bài, trạng thái (sent/ready/failed), tầng đã dùng (AI / mẫu / direct), link bài Facebook, lỗi nếu có. Có lọc theo nhãn/tầng/trạng thái.
- KPI: số bài hôm nay, tỉ lệ thành công, số bài dùng AI so với dự phòng.
- Nút "Chạy thử ngay" (gọi cùng logic Auto-bot) để demo trước thầy.

**API mới cho admin (vai trò `admin`, đặt trong `marketingRoutes.ts` + `marketingService.ts`):** tổng hợp bài đăng toàn hệ thống, trạng thái tích hợp (n8n/Gemini có cấu hình hay không, KHÔNG trả về giá trị token/key), bật/tắt AI Agent trung tâm, kích hoạt chạy thử, xem trước nội dung. Nếu cần cột mới (ví dụ ghi tầng đã dùng vào `marketing_posts`), tạo file SQL mới `database/Product/026_*.sql` và nhắc tôi tự chạy trong Supabase.

Hạn chế phạm vi: ưu tiên giao diện hiển thị được dữ liệu thật + nút "Chạy thử ngay" trước; phần xem trước ảnh có thể để sau nếu hết thời gian.

**Giao diện mẫu đã có sẵn:** file `ADMIN_AI_AGENT_giao-dien.html` ở thư mục gốc (4 tab: Tổng quan, Hàng chờ & xem trước, Lịch sử đăng bài, Thiết lập đăng bài (chọn nền tảng Facebook/Instagram/TikTok/Zalo OA, mỗi nền tảng một bộ thiết lập riêng; chỉ Facebook đăng tự động, các nền tảng còn lại tạo nội dung sẵn sàng để đăng thủ công); có ngăn kéo chi tiết bài và cửa sổ "Chạy thử ngay"). Hãy đưa nguyên bố cục và style này vào `ADMIN_FOODSAVE.html` (mục sidebar mới nhóm "Marketing"), tái dùng class sẵn có của trang admin (`.K .P .b .bt .DP`...), các class riêng bắt đầu bằng `ag-`, rồi thay dữ liệu mẫu (đối tượng `D`) bằng API thật. Mẫu poster trong tab "Hàng chờ & xem trước" (CSS thuần) là gợi ý bố cục ảnh quảng cáo: Fanpage cửa hàng theo màu cửa hàng, Fanpage FoodSave là ảnh tổng hợp.

**PHẠM VI TRANG ADMIN (quan trọng):** trang admin CHỈ phụ trách đăng bài tổng quát của FoodSave (Fanpage trung tâm và các nền tảng của FoodSave). KHÔNG đăng thay từng cửa hàng và KHÔNG có tab quản lý Fanpage của cửa hàng. Mỗi cửa hàng tự quản lý Fanpage/Auto-bot của mình ở `FOODSAVE_PARTNER.html` (đã có). Bài của admin là "bài tổng hợp": gom tối đa 3 món nhãn đỏ/vàng (ưu tiên đỏ, sắp hết hạn trước) từ nhiều cửa hàng vào một bài, ảnh poster tổng hợp liệt kê món + tên cửa hàng bán + % giảm + giờ còn lại. Tab "Hàng chờ & xem trước" cho admin tick chọn tối đa 3 món đưa vào bài.

## 10. Trang Đối tác (cửa hàng): giao diện Marketing Studio mới (ĐÃ viết sẵn dạng patch)
Giao diện mới đã được viết và chụp thử, nằm trong thư mục `marketing-patch/` ở thư mục gốc (KHÔNG sửa tay `FOODSAVE_PARTNER.html` rồi viết lại từ đầu, hãy áp patch):
- `marketing-patch/pmkt-v2.js`: code mới của `pMkt` (4 tab), nối đúng dữ liệu thật (`MKT`, `PRD`, `FS.sync.*`).
- `marketing-patch/pmkt-v2.css`: CSS bổ sung (tiền tố `mx-`, `mk-dp*`).
- `marketing-patch/apply.py`: tự backup rồi thay các hàm `pMkt, mktOverview, mktReport, mktConnect, mktConnPick, mktOpenStudio, mktRenderStudio, mktTab, mktPublish, mktSetTab, mktKpis, mktExportCsv, mktQuickPush, mktSendList` và chỉnh chữ/điều kiện trong `showXaKho`, `mktXaNgay` (bỏ nhắc người mua) và chèn CSS. Chạy: `python marketing-patch/apply.py FOODSAVE_PARTNER.html`. Chạy xong kiểm tra cú pháp script và mở thử trang Marketing.

Giữ nguyên (không đổi): `mktLoad, mktToggleAuto, mktSaveConn, mktToggleChannel, mktCopy, mktShareFb, mktDrawPoster, mktPosterDownload, showXaKho, mktXaNgay, MKT_PLAT, MKT_FIELDS`.

Bố cục 4 tab: Tổng quan | Hàng cần quảng bá (xem trước ngay trên trang, thay modal) | Lịch sử (gộp Báo cáo cũ) | Thiết lập đăng bài.
Quy tắc đã chốt với người dùng, đừng thêm lại:
- KHÔNG có kênh Email. Trang Marketing KHÔNG chạy bài / thông báo trên "Ứng dụng FoodSave": không có nút "Đẩy người mua", không gửi kênh `buyers` từ giao diện này, không tính `buyers` vào số liệu hay lịch sử (backend giữ nguyên, chỉ giao diện ngừng dùng).
- Tổng quan gồm: 4 chỉ số (Sản phẩm cần quảng bá, Bài đăng 7 ngày qua, Bài đăng hôm nay, Đăng thành công 7 ngày), thẻ Auto-bot, và thống kê 7 ngày (cột xếp chồng theo nhãn + bảng chi tiết theo nhãn và theo nền tảng). Không có danh sách kênh đang dùng.
- Không có câu giải thích về hàng nhãn xanh / 2 chiến dịch mỗi ngày trên giao diện.
- Xuất CSV có chọn kỳ: Hôm nay / Tuần này / Tháng này / Quý này / Năm nay / Tất cả.
- Thiết lập chỉ hiện chức năng THẬT: form kết nối (`MKT_FIELDS` + `mktSaveConn`), công tắc "Dùng kênh này" (`mktToggleChannel`), Auto-bot, và phần "Cách kênh hoạt động" chỉ đọc. Không thêm công tắc giọng văn, emoji, tầng AI... khi backend chưa có.
- Chỉ Facebook tự đăng; Instagram, TikTok, Zalo chỉ tạo nội dung sẵn sàng (trạng thái `ready`). Không dùng chữ "demo" / "mô phỏng" trên giao diện.
- Không có nút "Gửi lại" trong Lịch sử, chỉ "Sao chép nội dung". Không hiện tầng AI ở giao diện cửa hàng.
- Phát hành chỉ gửi tới các nền tảng đang bật (Facebook, Instagram, TikTok, Zalo); hiện kết quả thật từng kênh (`results[kênh].status`: sent / ready / failed / skipped).

Việc backend cần làm thêm để biểu đồ và Lịch sử có nhãn + liên kết (bắt buộc, nhỏ): trong `src/services/marketingService.ts`, hàm `listPosts` đổi select thành `id,channel,kind,variant,status,content,error,created_at,external_url,products(name,label),stores(name)`. Cột `external_url` đã có trong SQL 024 và `products.label` đã có sẵn, nên không cần SQL mới.
