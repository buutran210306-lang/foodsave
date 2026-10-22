# YÊU CẦU: Thêm tính năng "Ghép đơn từ tổ chức từ thiện"

> **Dành cho Claude Code.** Đọc `HANDOFF.md` trước (quy tắc làm việc: trả lời tiếng Việt, giải thích đơn giản, hỏi trước khi sửa lớn, **không tự chạy SQL trên Supabase**, chỉ viết file SQL để người dùng tự chạy). Sau đó đọc hết file này.
> Người dùng là sinh viên kinh doanh, không chuyên kỹ thuật. **Demo cho giảng viên: 23/10/2026**, nên ưu tiên bản chạy được, gọn, ít rủi ro. Hãy **sao lưu hoặc commit trước khi sửa**.

## 1. Tính năng là gì
Tổ chức từ thiện đăng nhu cầu, ví dụ "cần 50 cái bánh trước 18:00". Không cửa hàng nào có đủ 50 hoặc muốn tặng hết 50. Hệ thống tự ghép nhiều lô tặng của nhiều cửa hàng gần đó cho đủ 50, đề xuất tối đa 3 phương án (đủ số lượng → ít điểm dừng → ít km), tổ chức chọn một phương án để giữ hàng.

"Cửa hàng muốn quyên góp" chính là các lô trong bảng `donations` (cửa hàng bấm tim, chọn số phần). Mỗi lô được nhận **nguyên lô**, không chia nhỏ.

## 2. Tài nguyên có sẵn: thư mục `../guideforbtran/guideforbtran/`
(Nếu thư mục này nằm chỗ khác, hỏi người dùng. Đường dẫn gốc trên máy: `C:\Users\USER\Downloads\guideforbtran\guideforbtran`.)
- `code/core/`: engine ghép đơn TypeScript thuần (`proposePlans` trong `core/matching`). **Không sửa logic trong core**, chỉ chép vào `src/core/`.
- `code/services/candidateBuilder.ts`, `matchingService.ts`, `code/routes/matchingRoutes.ts`: service và route mẫu, viết cho đúng kiểu dự án này (`supabaseAdmin`, `AppError`, `getActor`, `sendSuccess`, `validateRequest`, `asyncHandler`, `uuidParamSchema`).
- `code/sql/015_charity_needs_matching.sql`: SQL mẫu (bảng `charity_needs`, hàm `reserve_donations_for_need`). **Cần chỉnh, xem mục 4.**
- `README.md`, `docs/CACH-HOAT-DONG.md`: giải thích thuật toán. `code/demo/run-demo.ts` chạy được (`npm run demo` trong `code/`, đã kiểm: ra 50 = 20 + 18 + 12).

## 3. Dữ liệu thật của người dùng (đã kiểm trong Supabase)
- `products.category` chỉ có 2 giá trị: `Bánh ngọt / bánh tươi` và `Bữa ăn / cơm hộp`; `food_group` đều là `cooked`.
- Chỉ có **1 cửa hàng** (có tọa độ) và **1 tổ chức** ("VIỆN DƯỠNG LÃO AN NHIÊN", lat 10.7395826, lng 106.7079532, `service_radius_km` = 5). Cần **seed thêm dữ liệu thử** để demo ghép được.
- Tsconfig của dự án: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`. Mọi code mới phải build sạch (`npm run build`).
- `donations` của dự án: có `weight_kg`, `quantity` (số phần, có thể null với lô cũ), `expires_at`, `pickup_start`, `pickup_end` (ISO), `offer_expires_at` (hạn nhận lời 45 phút), `status` (open/accepted/in_route/completed/rejected/cancelled), `charity_id`, `store_confirmed_at`, `assigned_volunteer_id`, `accepted_at`, `product_id`, `is_auto`.
- Luồng hiện có sau khi tổ chức nhận lô: cửa hàng Chấp nhận/Từ chối → tổ chức phân TNV (sinh mã) → cửa hàng đóng gói → TNV đến, cửa hàng nhập mã. Xem `acceptDonation` trong `src/services/donationService.ts` (khoảng dòng 330-395): nó đặt `status='accepted'`, `charity_id`, `assigned_volunteer_id=null`, `store_confirmed_at=null`, `accepted_at=now`, rồi gửi thông báo cho cửa hàng. **Giữ hàng theo phương án phải cho kết quả tương đương** để các lô đi tiếp đúng luồng cũ.
- API gắn dưới `/api/v1/*`. `src/routes/index.ts` gắn route kèm `authMiddleware` bằng cách `apiRoutes.use("/donations", authMiddleware, donationRoutes)`.

## 4. Việc cần làm (theo thứ tự)

### 4.1 Backend
1. Chép `core/` vào `src/core/`. Chép `candidateBuilder.ts`, `matchingService.ts` vào `src/services/`, `matchingRoutes.ts` vào `src/routes/`. Gắn `apiRoutes.use("/matching", authMiddleware, matchingRoutes)` trong `src/routes/index.ts`. Chạy `npm run build`, sửa lỗi.
2. **Ghép theo số phần/cái** (người dùng đã chốt), không theo kg: dùng `donations.quantity` làm số lượng, đơn vị `portion` (kiểm `core/matching/units.ts` xem mã đơn vị nào phù hợp, thêm nếu cần mà không đổi logic engine). Lô không có `quantity` thì bỏ qua hoặc quy đổi từ `weight_kg`, nói rõ lựa chọn cho người dùng.
3. **Loại hàng lấy từ sản phẩm, không thêm cột vào `donations`:** join `donations.product_id → products(category, food_group)`. Map `category` của sản phẩm sang mã loại của engine, `food_group` sang `perishability`. Nhu cầu chọn 1 hoặc cả 2 loại. Lô không có `product_id` (cửa hàng tạo tay) thì xử lý hợp lý (ví dụ loại `other`, nấu chín) và nói rõ.
4. Lọc lô ứng viên: `status='open'`, `charity_id is null`, `expires_at > now`, **và `offer_expires_at is null hoặc > now`** (không đưa vào phương án lô đã hết hạn nhận lời). Cửa hàng phải `status='active'`, có tọa độ.
5. API (tất cả chỉ cho role `charity` và `admin`, chủ nhu cầu hoặc admin; kiểm bằng zod; lỗi dùng `AppError`):
   - `POST /api/v1/matching/needs`: tạo nhu cầu (`charity_id`, `title`, `category` (1-2 loại), `quantity` (số phần), `needed_by`, `note`). Chỉ chủ `charity_profiles` đó hoặc admin; tổ chức phải `status='active'` và có tọa độ.
   - `GET /api/v1/matching/needs`: danh sách nhu cầu của tổ chức mình.
   - `GET /api/v1/matching/needs/:id/plans`: tối đa 3 phương án (chỉ đọc).
   - `POST /api/v1/matching/needs/:id/reserve` body `{ donationIds }`: giữ hàng. Lỗi 409 khi một lô vừa bị nơi khác nhận.
   - (Tuỳ chọn) `POST .../cancel`: hủy nhu cầu.
6. Sau khi giữ hàng thành công: **gửi thông báo cho từng cửa hàng có lô được giữ** (giống `acceptDonation`, bảng `notifications`), nội dung rõ "tổ chức X đã chọn lô của bạn trong một đơn ghép".

### 4.2 SQL (chỉ viết file, người dùng tự chạy)
- `database/Charity/024_charity_needs_matching.sql` dựa trên `015_charity_needs_matching.sql` của bộ hướng dẫn, **nhưng chỉnh**:
  - Bỏ `alter table donations add category_code/perishability` (không cần, lấy từ `products`).
  - `charity_needs`: dùng cột `quantity` (số phần, integer) thay `quantity_kg`; `category_codes text[]` giữ như mẫu; thêm RLS giống mẫu.
  - Hàm `reserve_donations_for_need`: khóa các lô theo thứ tự id trong một giao dịch; **chỉ nhận khi tất cả lô** `status='open'`, `charity_id is null`, `expires_at > now()` **và (`offer_expires_at is null or offer_expires_at > now()`)**; khi nhận phải đặt đúng như `acceptDonation`: `status='accepted'`, `charity_id`, `assigned_volunteer_id=null`, `store_confirmed_at=null`, `accepted_at=now()`, `updated_at=now()`; đánh dấu nhu cầu `matched`. Hết hàng thì `raise exception 'not_available'`. Chỉ `service_role` được gọi.
  - Không đổi tên, không xóa cột/bảng hiện có.
- `database/Seed/seed_ghep_don.sql` (idempotent, an toàn chạy lại): thêm 3-4 cửa hàng giả quanh Viện An Nhiên (trong 5 km, có tọa độ), mỗi cửa hàng 1 sản phẩm bánh + 1 lô `donations` đang `open` (ví dụ 20, 18, 12 phần), thêm 1 lô ở xa >5 km và 1 lô loại khác (để thấy "lô bị loại"), thêm 1 nhu cầu 50 phần. Kiểm schema thật (`database/User/001_foodsave_schema.sql`, `008_split_customer_partner_profiles.sql`) để biết ràng buộc `stores.owner_id`, `profiles` khi tạo cửa hàng giả. Tên cửa hàng lấy từ dữ liệu, **không hardcode trong code**.

### 4.3 Giao diện tổ chức
Trong `FOODSAVE_CHARITY.html` (đọc kỹ trước; **không gỡ cả khối `<style>`/`<script>` khi chưa đọc**), thêm mục "Nhu cầu & phương án ghép" đúng style và màu hiện có (hồng/xanh/trắng, `foodsave-minimal.css`), tiếng Việt, dùng được trên điện thoại:
1. Form đăng nhu cầu: loại hàng (2 loại), số phần/cái, cần trước (ngày + giờ), ghi chú.
2. Danh sách nhu cầu của tôi, mỗi nhu cầu có nút "Xem phương án ghép". Frontend chỉ gọi Backend API qua cơ chế đăng nhập sẵn có (xem `frontend/foodsave-auth-client.js`), **không ghi thẳng database**.
3. Tối đa 3 thẻ phương án: đủ X/Y hay thiếu bao nhiêu, số điểm dừng, ~km, ~phút, danh sách cửa hàng theo thứ tự kèm số phần và giờ tới. Thẻ đầu gắn "Đề xuất".
4. Nút "Chọn phương án này". Thành công: "Đã giữ hàng ở N cửa hàng". Lỗi 409: "Một lô vừa được nơi khác nhận, đang tính lại" rồi tự gọi lại phương án.
5. Hiện "Lô không được chọn và lý do" từ `dropped` (`out_of_radius` ngoài bán kính, `category_mismatch` khác loại hàng, `expired` hết hạn, `infeasible_timing` tới không kịp).
6. (Chỉ làm nếu còn thời gian) Vẽ các điểm dừng lên bản đồ bằng `frontend/foodsave-map.js` (Leaflet).

## 5. Kiểm tra trước khi báo xong
- `npm run build` sạch lỗi. Chạy `npm run dev` (không dùng `npm start`), gọi thử `/api/v1/matching/needs/:id/plans` với token tổ chức.
- Hướng dẫn người dùng chạy theo thứ tự trong Supabase: `024`, rồi `seed_ghep_don.sql`.
- Kịch bản test: nhu cầu 50 phần → ra phương án đủ 50 từ nhiều cửa hàng; chọn phương án → các lô thành `accepted`, cửa hàng nhận thông báo, các lô đi tiếp được luồng cũ (cửa hàng xác nhận, phân TNV). Thử bấm giữ hàng lần 2 hoặc từ tài khoản tổ chức khác để thấy lỗi 409.
- Báo lại người dùng bằng tiếng Việt đơn giản: đã sửa file nào, việc nào họ cần làm tay (chạy SQL, đăng nhập thử), và điều gì chưa kiểm được.
- Ghi chú vào `HANDOFF.md` một mục ngắn về tính năng ghép đơn (file SQL mới, route mới).

## 6. Không được làm
- Không tự chạy SQL trên Supabase; không commit/push nếu người dùng chưa đồng ý; không đổi tên file `FOODSAVE_*.html`.
- Không sửa logic trong `src/core/`; không đổi `donationService.ts` nếu không cần (nếu cần, hỏi trước).
- Không đưa khóa Supabase service role vào frontend; không hardcode tên cửa hàng.
- Nguồn khi ghi báo cáo: "FoodSave v2, engine match-v1".
