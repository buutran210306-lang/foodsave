# Prompt cho AI

Mở AI (Claude, ChatGPT, Cursor…) ngay trong thư mục source FoodSave của Trân. Đính kèm hoặc cho AI đọc cả thư mục `guideforbtran`, rồi dán prompt 1. Làm xong thì dùng prompt 2 nếu cần giao diện.

## Prompt 1: ghép engine vào backend

```text
Bạn là lập trình viên TypeScript/Express. Dự án của tôi là FoodSave bản cũ: backend Express + TypeScript
(strict) + Supabase, cấu trúc src/routes, src/controllers, src/services, src/schemas (zod), src/middlewares.
Bảng chính: stores (có latitude, longitude, rating), charity_profiles (có latitude, longitude,
service_radius_km, owner_id), donations (store_id, charity_id, weight_kg, expires_at, pickup_start,
pickup_end dạng "HH:MM", status).

Tôi muốn thêm tính năng GHÉP ĐƠN: một tổ chức từ thiện đăng nhu cầu (ví dụ 25 kg bánh mì trước 18:00),
hệ thống ghép từ nhiều cửa hàng gần đó và đề xuất tối đa 3 phương án, rồi tổ chức chọn một phương án để giữ hàng.

Trong thư mục guideforbtran đã có sẵn:
- code/core/: engine ghép đơn TypeScript thuần (hàm proposePlans trong core/matching). KHÔNG sửa logic
  trong core, chỉ chép nguyên vào src/core/.
- code/services/candidateBuilder.ts: đổi dòng donations + stores sang MatchCandidate.
- code/services/matchingService.ts và code/routes/matchingRoutes.ts: service và route mẫu, viết theo đúng
  kiểu của dự án (supabaseAdmin, AppError, getActor, sendSuccess, validateRequest, asyncHandler).
- code/sql/015_charity_needs_matching.sql: bảng charity_needs, cột category_code/perishability cho
  donations, hàm reserve_donations_for_need giữ hàng nguyên tử.
- README.md và docs/CACH-HOAT-DONG.md giải thích thuật toán.

Hãy làm lần lượt, mỗi bước xong thì chạy `npm run build` và sửa hết lỗi trước khi sang bước sau:
1. Chép code/core vào src/core, chép 2 file service vào src/services, chép route vào src/routes,
   gắn route vào src/routes/index.ts tại "/matching".
2. Đọc file SQL, giải thích ngắn từng phần, rồi đưa tôi chạy trong Supabase SQL Editor.
3. Thêm API tạo nhu cầu: POST /api/matching/needs (charity_id, title, category_codes, quantity_kg,
   needed_by, note), kiểm bằng zod, chỉ chủ charity_profiles đó hoặc admin được tạo.
   Thêm GET /api/matching/needs để tổ chức xem các nhu cầu của mình.
4. Khi cửa hàng tạo lô tặng (donationService.createDonation), nhận thêm category_code và perishability
   (cooked | fresh | packaged), mặc định 'other' và 'cooked'.
5. Viết một script seed dữ liệu thử: 1 tổ chức, 4 cửa hàng quanh đó, các lô bánh mì 8 kg, 7 kg, 5 kg
   và 1 lô ở xa 15 km, cùng 1 nhu cầu 20 kg. Gọi GET /api/matching/needs/:id/plans và in kết quả.

Yêu cầu:
- Không đổi tên cột hay bảng đang có. Không xóa dữ liệu.
- Giữ TypeScript strict, không dùng any.
- Mọi lỗi trả về theo AppError của dự án.
- Giải thích bằng tiếng Việt, ngắn gọn, sau mỗi bước.
```

## Prompt 2: giao diện cho trang tổ chức

```text
Trong trang CHARITY.html của FoodSave bản cũ, thêm mục "Nhu cầu & phương án ghép":
1. Form đăng nhu cầu: loại hàng (bakery, cooked_meal, vegetables, drinks, dry_food), số kg, cần trước
   (ngày + giờ), ghi chú. Gửi tới POST /api/matching/needs bằng token đăng nhập hiện có.
2. Danh sách nhu cầu của tôi (GET /api/matching/needs). Mỗi nhu cầu có nút "Xem phương án ghép".
3. Bấm nút thì gọi GET /api/matching/needs/:id/plans và hiện tối đa 3 thẻ phương án. Mỗi thẻ ghi:
   đáp ứng X/Y kg (đủ hoặc thiếu bao nhiêu), số điểm dừng, ~km, ~phút, danh sách cửa hàng theo thứ tự
   kèm số kg và giờ tới. Thẻ đầu gắn nhãn "Đề xuất".
4. Nếu có Leaflet trong trang thì vẽ các điểm dừng lên bản đồ theo thứ tự 1, 2, 3 và nối thành tuyến.
5. Nút "Chọn phương án này" gọi POST /api/matching/needs/:id/reserve với donationIds của thẻ.
   Thành công thì báo "Đã giữ hàng ở N cửa hàng". Lỗi 409 thì báo "Một lô vừa được nơi khác nhận,
   đang tính lại" và tự gọi lại API phương án.
6. Hiện thêm phần "Lô không được chọn và lý do" từ trường dropped
   (out_of_radius = ngoài bán kính, category_mismatch = khác loại hàng, expired = đã hết hạn,
   infeasible_timing = tới không kịp hạn).
Giữ đúng style CSS hiện có của trang (foodsave-forest-theme.css), giao diện tiếng Việt, chạy được trên điện thoại.
```

## Prompt 3: viết phần công nghệ cho báo cáo môn học

```text
Dựa trên README.md và docs/CACH-HOAT-DONG.md trong thư mục guideforbtran, viết phần "Giải pháp công nghệ:
thuật toán ghép đơn" cho báo cáo môn Thương mại điện tử, khoảng 2 trang:
- bài toán ghép cung cầu nhiều cửa hàng cho một nhu cầu, so sánh với gom hàng nhiều kho trong TMĐT;
- 4 bước của thuật toán và công thức chấm điểm, kèm ví dụ 50 ổ = 20 + 18 + 12 (kết quả trong docs/ket-qua-demo.txt);
- vì sao chọn thuật toán tất định thay vì AI;
- giữ hàng nguyên tử để hai tổ chức không nhận trùng;
- giới hạn hiện tại và hướng phát triển (tuyến đường thật từ bản đồ, chia nhỏ lô, thêm sức chứa và kho lạnh).
Ghi nguồn: FoodSave v2, engine match-v1. Văn phong học thuật, tiếng Việt, không phóng đại.
```
