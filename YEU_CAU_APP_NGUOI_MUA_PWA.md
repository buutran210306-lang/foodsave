# YÊU CẦU CLAUDE CODE: APP NGƯỜI MUA (PWA) NỐI DỮ LIỆU THẬT

> Đọc hết file này trước khi viết code. Làm theo từng ĐỢT, xong mỗi đợt dừng lại báo cáo (đã làm gì, file nào, cách test). Không làm sang đợt sau khi chưa được đồng ý.
> Không hỏi lại những gì đã ghi rõ ở đây. Chỗ nào chưa rõ thì chọn phương án đơn giản nhất, ghi lại trong báo cáo.

## 0. Bối cảnh

- Web người mua hiện tại: `FOODSAVE_USER.html` (+ `frontend/*.js`, API Express tại `src/`, Supabase, Netlify).
- Đã có bản **giao diện app mẫu (demo, dữ liệu giả)**: `FOODSAVE_APP_demo.html` (người dùng đã duyệt giao diện). Nhiệm vụ: biến nó thành **app thật** `FOODSAVE_APP.html`, dùng **đúng dữ liệu, API, luật nghiệp vụ như web**.
- Giữ nguyên giao diện/bố cục/màu của bản demo. Chỉ thay dữ liệu giả bằng dữ liệu thật và thêm các tính năng bên dưới.
- Luật nghiệp vụ đơn hàng (thanh toán trước, thời gian theo nhãn Xanh/Vàng/Đỏ, huỷ, no-show, khiếu nại, điểm uy tín, ví/ledger) đã có trong `YEU_CAU_QUY_TRINH_DON_HANG_PWA.md`. **App gọi lại đúng API đó, KHÔNG viết lại luật ở phía client.**

## 1. Nguyên tắc bắt buộc

1. **Một nguồn dữ liệu**: web và app dùng chung API/Supabase. Không tạo bảng mới nếu bảng cũ đã đủ.
2. **Không bí mật trong code/repo**: khóa nằm ở biến môi trường Netlify. `.env` không commit. Không in khóa ra log hay báo cáo.
3. **Không tự chạy SQL lên database.** Cần SQL thì viết file mới trong `database/...` (đánh số tiếp theo), nêu rõ thứ tự chạy, người dùng tự chạy trong Supabase.
4. **Ảnh sản phẩm là ảnh cửa hàng tải lên** (Supabase Storage, trường `image_url`/`image_urls` mà `frontend/foodsave-live-data.js` đã dùng). KHÔNG dùng emoji/sticker/ảnh AI làm ảnh sản phẩm. Chỉ dùng emoji theo danh mục như **ảnh dự phòng** khi cửa hàng chưa tải ảnh hoặc ảnh lỗi (đã có hàm `pic()` trong demo).
5. **Không tự chuyển hướng** người dùng điện thoại từ web sang app (xem Đợt 4).
6. Mọi tiền tệ, thời gian, trạng thái hiển thị lấy từ server. Đồng hồ đếm ngược dựa trên mốc thời gian server trả về (`pay_deadline_at`, `pickup_deadline_at`, ...), không tự cộng trừ ở client.
7. Có xử lý trạng thái: đang tải (skeleton), rỗng, lỗi mạng (nút thử lại), mất mạng (trang `offline.html`).
8. Văn bản giao diện bằng tiếng Việt có dấu.

## 2. Bản đồ màn hình → dữ liệu thật

| Màn hình app (demo) | Nguồn dữ liệu thật |
|---|---|
| Trang chủ: Flash Deal, nhãn, bộ lọc | Cùng nguồn với `renderHome/renderMarket` của web (Supabase products + API `customerRoutes`). Số lượng theo nhãn lấy thật. |
| Tìm kiếm | Cùng logic lọc/sắp xếp/khoảng cách của web (`foodsave-matching.js`, nearby location). |
| Chi tiết sản phẩm | Sản phẩm thật: ảnh, NSX/HSD, mô tả, thành phần, cửa hàng. |
| Cửa hàng (thông tin, ESG, đánh giá) | Dữ liệu cửa hàng thật; ESG và đánh giá lấy từ bảng/API hiện có. Nếu thiếu dữ liệu nào thì ẩn khối đó, không bịa số. |
| Giỏ hàng, xác nhận, thanh toán | `foodsave-order-flow.js` và `orderRoutes` (tạo đơn qua backend, giữ hàng, thanh toán qua PaymentProvider đang cấu hình). |
| Đơn hàng (tab) + chi tiết | API đơn hàng của web; trạng thái `awaiting_payment/paid/preparing/ready/completed/cancelled/no_show`. |
| Mã QR nhận hàng | Cùng mã QR/`pickup_code` mà web đang dùng. |
| Huỷ đơn | API huỷ có sẵn. Màn xác nhận hiển thị **kết quả do server tính** (hoàn bao nhiêu, trừ bao nhiêu điểm), không tự tính ở client. Nếu chưa có API "xem trước", thêm endpoint GET preview. |
| Chat với cửa hàng | `order_messages` (SQL 033), polling 6 giây như spec. |
| Khiếu nại | API complaint có sẵn (ảnh bắt buộc, cửa hàng 12h phản hồi). |
| Ví hoàn tiền, voucher | Ledger và voucher thật của người dùng. |
| Điểm uy tín | Dữ liệu `customerReputationService`. |
| Yêu thích | Cùng nguồn với web. |
| Trợ giúp (Chat AI / Yêu cầu / FAQ) | FAQ lấy từ web; Yêu cầu hỗ trợ lưu bảng ticket (nếu chưa có thì tạo SQL mới); Chat AI dùng endpoint AI hiện có, nếu chưa có thì để mục này ẩn và báo lại. |
| Vườn cây uy tín (game) | Dùng lại đúng logic trong `FOODSAVE_USER.html` (`waterTreeForOrder`, `waterTrustTree`, `TREE_*`, khóa `foodsave.treeGame.v1`). **Đợt 1 giữ localStorage**; đề xuất (không tự làm) phương án lưu server ở báo cáo. Nước chỉ được cộng khi đơn **thanh toán thành công thật**, mỗi đơn một lần (chống cộng trùng như web). |

## 3. ĐỢT 1: Dựng `FOODSAVE_APP.html` + đăng nhập thật + dữ liệu thật

1. Tạo `FOODSAVE_APP.html` từ `FOODSAVE_APP_demo.html`: bỏ dữ liệu mẫu (`P`, `STORES`, đơn/thông báo seed…), nối API theo bảng ở mục 2. Dùng chung `frontend/*.js` với web, không sao chép code.
2. **Đăng nhập/đăng ký** (giữ luồng màn hình trong demo):
   - Google, Facebook: dùng OAuth Supabase như web.
   - **SĐT + OTP**: như web.
   - **Gmail + OTP (MỚI)**: nhập email → Supabase `signInWithOtp({ email })` → nhập mã 6 số → `verifyOtp({ email, token, type: 'email' })`. Ghi rõ trong báo cáo các bước người dùng phải bật trong Supabase (Email provider, sửa template email để gửi mã `{{ .Token }}` thay vì link, giới hạn gửi email mỗi giờ, gợi ý gắn SMTP riêng khi chạy thật). Chống gửi lại liên tục (đếm ngược 60 giây).
   - Màn "Thông tin cá nhân": **không có mục chọn vai trò**. App này chỉ dành cho người mua; tài khoản tổ chức từ thiện dùng cổng riêng. Nếu một tài khoản từ thiện đăng nhập nhầm vào app thì hiện thông báo hướng dẫn sang cổng từ thiện.
   - Hồ sơ lưu theo cùng bảng/schema với web (không tạo schema song song).
3. **Ảnh**: ảnh sản phẩm/ cửa hàng từ Storage; thẻ sản phẩm, chi tiết, giỏ, đơn hàng đều hiển thị ảnh thật (tỉ lệ cố định, `object-fit: cover`, lazy load). Ảnh lỗi/thiếu thì dùng ảnh dự phòng theo danh mục.
4. **Ảnh màn chào (splash)**: dùng ảnh thật như trang `index.html` (ảnh chợ thực phẩm đã dùng ở hero), tối ưu kích thước; không dùng ảnh AI/sticker.
5. Báo cáo: danh sách endpoint đã gọi cho từng màn hình, chỗ nào thiếu API.

## 4. ĐỢT 2: Bản đồ thật

- Dùng **Leaflet + OpenStreetMap** như `frontend/foodsave-map.js` của web (nếu đã cấu hình khóa Google Maps thì dùng lại cách web đang chọn). Không thêm dịch vụ/khóa mới.
- Chèn bản đồ thật vào các chỗ đang có bản đồ giả trong demo:
  1. Trang chủ, mục "Gần bạn" (bản đồ nhỏ, chạm vào mở màn Bản đồ).
  2. Màn **Bản đồ**: ghim cửa hàng có hàng đang bán (hiện số sản phẩm), chấm vị trí của người dùng, danh sách cửa hàng gần nhất bên dưới, chạm ghim thì mở cửa hàng.
  3. Bước **Xác nhận vị trí** khi đăng ký: lấy GPS (`navigator.geolocation`), cho kéo ghim hoặc tìm địa chỉ; lưu vị trí như web (`getNearbyLocation`).
  4. Trang **Cửa hàng** và chi tiết đơn: bản đồ nhỏ vị trí cửa hàng + nút "Chỉ đường Google Maps" (mở URL `https://www.google.com/maps/dir/?api=1&destination=lat,lng`).
- Xử lý khi người dùng từ chối GPS (cho nhập địa chỉ tay), khi mất mạng (hiện danh sách thay cho bản đồ). Bản đồ không làm app cuộn bị kẹt trên điện thoại.
- Cửa hàng không có toạ độ thì không hiện ghim, không bịa toạ độ.

## 5. ĐỢT 3: Thông báo (Web Push) và các chức năng "rìa"

Tận dụng `frontend/foodsave-pwa.js`, `sw.js`, `src/services/pushService.ts`, `src/routes/pushRoutes.ts`, `notificationService.ts` (đã có). Mở rộng, không viết lại.

**Màn "Thông báo" (chuông) + banner thông báo trong app** đọc từ bảng thông báo thật của người dùng. Các sự kiện phải **gửi push thật** (đúng người, một lần mỗi sự kiện, không gửi trùng):

| Sự kiện | Nội dung gợi ý | Khi nào gửi | Bấm vào |
|---|---|---|---|
| Thanh toán thành công | "Thanh toán thành công! Đơn #… đã được ghi nhận" | Khi webhook/xác nhận thanh toán thành công | Chi tiết đơn (hiện QR) |
| **Cửa hàng đã chuẩn bị xong đơn (MỚI)** | "Cửa hàng … đã chuẩn bị xong đơn, đến nhận trước hh:mm" | Khi cửa hàng bấm "Đã chuẩn bị xong/Sẵn sàng" ở cổng đối tác | Chi tiết đơn |
| **Voucher mới (MỚI)** | "Có voucher mới: mã … giảm …" | Khi admin/hệ thống tạo hoặc cấp voucher cho người dùng | Màn Voucher |
| Nhắc giờ nhận hàng | "Còn 15 phút để nhận đơn #…" | Theo luật thời gian của nhãn | Chi tiết đơn |
| Sắp hết hạn nhận / Đơn bị huỷ/ hoàn tiền | Theo spec đơn hàng | Theo trạng thái | Chi tiết đơn / Ví |
| Flash deal gần bạn, món yêu thích sắp hết hạn | Như web hiện có | Như web | Chi tiết sản phẩm |
| Phản hồi khiếu nại, tin nhắn mới từ cửa hàng | Như web hiện có | Như web | Khiếu nại / Chat |

- Cổng đối tác (`FOODSAVE_PARTNER*.html`) cần nút/trạng thái "Đã chuẩn bị xong" nếu chưa có. Thêm trạng thái `ready` (hoặc cột thời gian `ready_at`) bằng SQL mới, KHÔNG đổi ý nghĩa các trạng thái cũ. Đơn chỉ chuyển `ready` khi đã `paid`.
- Có cài đặt bật/tắt từng nhóm thông báo trong "Cá nhân → Thông báo". Màn xin quyền thông báo (đã có trong demo) gọi xin quyền thật; nếu từ chối thì vẫn hiện thông báo trong app.
- Khi app đang mở: hiện banner đầu màn hình (giống demo). Khi app đóng: push hệ thống.
- Các chức năng "rìa" cần mang từ web sang app: chuông + danh sách thông báo, chính sách/điều khoản/quyền riêng tư/trợ giúp (dùng lại nội dung `foodsave-legal-content.js`, đặt trong "Cá nhân → Chính sách & điều khoản"). **KHÔNG làm banner đồng ý cookie trong app** (đó chỉ là của web; app chỉ xin quyền vị trí và thông báo ở lúc cần dùng), trang `offline.html` khi mất mạng, banner nhắc đơn đang chờ nhận ở trang chủ, nhắc cập nhật phiên bản khi có service worker mới.

## 6. ĐỢT 4: Cài app (PWA) từ web, không tự chuyển hướng

1. **Manifest cho app**: tạo `manifest-app.webmanifest` (hoặc sửa `manifest-user.webmanifest` nếu hợp lý) với `start_url` trỏ vào `/FOODSAVE_APP.html`, `scope` phù hợp, `display: standalone`, `orientation: portrait`, `theme_color` `#14613b`, bộ icon trong `icons/` (192, 512, maskable-512, apple-touch-180; **không chạy `scripts/make-icons.js`** vì sẽ ghi đè logo mới). Gắn `<link rel="manifest">`, `apple-touch-icon`, meta iOS vào `FOODSAVE_APP.html`.
2. **Service worker** `sw.js`: cache vỏ app (HTML, CSS, JS, icon), trang `offline.html`, xử lý push và `notificationclick` mở đúng màn (đơn hàng, voucher…). Tăng phiên bản cache khi phát hành. Không cache dữ liệu đơn hàng/thanh toán.
3. **Trên web (`FOODSAVE_USER.html`)**:
   - **KHÔNG tự động chuyển** người dùng điện thoại sang giao diện app.
   - Khi người dùng mở web bằng **điện thoại** và chưa cài app: hiện một banner/thanh nhỏ ở dưới màn hình: "Cài app FoodSave để dùng tiện hơn – bấm để cài" kèm nút Cài và nút đóng (nhớ lựa chọn "để sau" 7 ngày bằng localStorage).
   - Bấm nút: Android/Chrome gọi `beforeinstallprompt.prompt()` (lưu sự kiện từ trước). iOS Safari không có hộp thoại cài: hiện hướng dẫn từng bước "Chia sẻ → Thêm vào MH chính".
   - Thêm mục **"Cài đặt app"** cố định trong menu/footer/tài khoản của web, cùng hành vi như trên (hiện cả trên máy tính nếu trình duyệt hỗ trợ).
   - Sau khi cài (sự kiện `appinstalled` hoặc `display-mode: standalone`) thì ẩn banner và mục cài đặt.
   - Việc cài app mở ra `FOODSAVE_APP.html` (do `start_url`), đăng nhập giữ nguyên phiên Supabase nếu cùng origin.
4. Trên máy tính, `FOODSAVE_APP.html` vẫn hiển thị trong khung điện thoại ở giữa (như demo).

## 7. ĐỢT 5: Kiểm thử và hoàn thiện

- Chạy `npm run typecheck` và các test hiện có (`test:order`, `test:ledger-db` nếu có DB). Thêm test cho: gửi push đúng sự kiện/đúng người/không trùng, trạng thái `ready`, xem trước kết quả huỷ.
- Kiểm thử tay trên điện thoại thật (Android + iPhone): đăng nhập 4 cách, bản đồ + GPS, đặt hàng → thanh toán → QR, nhận 3 loại thông báo (thanh toán thành công, cửa hàng chuẩn bị xong, voucher mới), cài app từ web (Android + iOS), mất mạng.
- Cập nhật `README.md`/`HANDOFF.md`: cách chạy, biến môi trường, bước cấu hình Supabase (Email OTP), cách cài app.
- Báo cáo cuối: bảng "màn hình → endpoint", danh sách file thêm/sửa, SQL mới và thứ tự chạy, việc người dùng cần làm tay, rủi ro còn lại.

## 8. Việc KHÔNG làm

- Không viết lại luật đơn hàng/ledger ở client; không dùng dữ liệu giả; không dùng ảnh AI/sticker cho sản phẩm.
- Không tự chuyển hướng người dùng vào app.
- Không chạy SQL lên database; không ghi khóa vào code.
- Không đụng `FOODSAVE_USER.html` ngoài phần banner/mục "Cài đặt app" ở Đợt 4.
