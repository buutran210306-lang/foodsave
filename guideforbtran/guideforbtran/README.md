# Ghép đơn từ tổ chức đến nhiều cửa hàng: bộ hướng dẫn cho Trân

Bộ này chứa engine ghép đơn của FoodSave (phiên bản `match-v1`), lớp nối vào source code FoodSave bản cũ (Express + Supabase), file SQL, một demo chạy được và prompt để đưa cho AI.

Engine được tách từ FoodSave v2 (`github.com/bminhnemhoi/FoodSave`, thư mục `src/core`). Nó là TypeScript thuần, không phụ thuộc thư viện nào, nên chép vào dự án nào cũng chạy.

## Tính năng làm gì

Mái ấm đăng "cần 50 ổ bánh mì trước 18:00". Không tiệm nào đủ một mình. Hệ thống làm 4 bước:

1. **Lọc:** bỏ lô ở xa hơn bán kính của mái ấm, khác loại hàng, đã hết hạn, hoặc tới lấy không kịp hạn.
2. **Chấm điểm từng cửa hàng:** `0,4 × độ gấp + 0,3 × độ gần + 0,2 × khớp số lượng + 0,1 × uy tín`. Lô càng sắp hết hạn càng được ưu tiên.
3. **Thử các cách ghép:** lấy 12 cửa hàng điểm cao nhất, thử mọi tổ hợp 1 đến 3 cửa hàng (nhiều nhất 298 tổ hợp). Chia số lượng theo nguyên tắc hết hạn trước lấy trước (FEFO). Chưa đủ thì mở rộng tới 5 cửa hàng.
4. **Đề xuất tối đa 3 phương án**, xếp theo: đáp ứng đủ → ít điểm dừng → ít km → điểm cao. Mỗi phương án có thứ tự đi và giờ tới dự kiến. Lô bị loại đều kèm lý do.

Đây là **thuật toán có quy tắc rõ ràng, không phải AI**: cùng dữ liệu luôn ra cùng kết quả và giải thích được vì sao chọn. Chi tiết: [docs/CACH-HOAT-DONG.md](docs/CACH-HOAT-DONG.md) và quyết định gốc [docs/ADR-007-thuat-toan-ghep-don.md](docs/ADR-007-thuat-toan-ghep-don.md).

## Trong thư mục có gì

| Đường dẫn | Nội dung |
|---|---|
| `code/core/matching/` | Engine ghép đơn: lọc, chấm điểm, duyệt tổ hợp, chia FEFO, xếp hạng |
| `code/core/routing/` | Sắp thứ tự điểm dừng, ước lượng thời gian đi xe máy |
| `code/core/labels/` | Nhãn Xanh / Vàng / Đỏ theo thời gian còn lại |
| `code/core/geo/` | Tính khoảng cách giữa hai tọa độ |
| `code/services/candidateBuilder.ts` | Đổi dữ liệu `donations` + `stores` của bản cũ sang đầu vào của engine |
| `code/services/matchingService.ts` | Service đọc Supabase, gọi engine, giữ hàng |
| `code/routes/matchingRoutes.ts` | 2 API: xem phương án, giữ hàng theo phương án |
| `code/sql/015_charity_needs_matching.sql` | Bảng `charity_needs`, cột mới cho `donations`, hàm giữ hàng nguyên tử |
| `code/demo/run-demo.ts` | Demo 50 ổ bánh = 20 + 18 + 12, chạy không cần database |
| `docs/ket-qua-demo.txt` | Kết quả demo đã chạy thật |
| `PROMPT.md` | Prompt dán cho AI để ghép vào source của Trân |

## Chạy demo trước (5 phút)

Cần Node 18 trở lên.

```bash
cd guideforbtran/code
npm install
npm run demo
```

Kết quả mong đợi (xem đủ trong `docs/ket-qua-demo.txt`):

```text
Phương án 1: 50/50 ổ (đủ) · 3 điểm dừng · ~10.9 km · ~76 phút
   1. Tiệm bánh Mây: lấy 20 ổ lúc khoảng 14:16 (nhãn Đỏ)
   2. Bếp Xanh: lấy 18 ổ lúc khoảng 14:36 (nhãn Vàng)
   3. Lò bánh Sớm Mai: lấy 12 ổ lúc khoảng 15:00 (nhãn Vàng)
Lô bị loại:
   - lo-banh-kem: khác loại hàng
   - lo-xa: ngoài bán kính
```

## Ghép vào source FoodSave bản cũ

Đã kiểm: chép đúng như dưới đây thì `npm run build` (tsc, cấu hình strict của dự án) biên dịch không lỗi.

1. Chép `code/core/` thành `src/core/`.
2. Chép `code/services/candidateBuilder.ts` và `code/services/matchingService.ts` vào `src/services/`.
3. Chép `code/routes/matchingRoutes.ts` vào `src/routes/`, rồi trong `src/routes/index.ts` thêm:
   ```ts
   import { matchingRoutes } from "./matchingRoutes";
   apiRoutes.use("/matching", matchingRoutes);
   ```
4. Chạy `code/sql/015_charity_needs_matching.sql` trong Supabase SQL Editor.
5. Thêm dữ liệu thử:
   - lô tặng có `category_code` (ví dụ `bakery`) và `stores.latitude/longitude`;
   - `charity_profiles.latitude/longitude` và `service_radius_km`;
   - một dòng `charity_needs`.
6. Gọi API bằng token của tài khoản tổ chức:
   - `GET /api/matching/needs/<needId>/plans` trả tối đa 3 phương án.
   - `POST /api/matching/needs/<needId>/reserve` với body `{ "donationIds": ["…", "…"] }` để giữ hàng.

## Khác biệt so với FoodSave v2, nên ghi rõ trong báo cáo

- **Đơn vị:** bản cũ lưu `weight_kg`, nên service ghép theo **kg**. Engine hỗ trợ cả ổ, hộp, suất… (demo dùng ổ). Muốn dùng thì thêm cột số lượng và đơn vị cho `donations`.
- **Nhận nguyên lô:** bản cũ không chia nhỏ một lô, nên khi giữ hàng, tổ chức nhận cả lô. Engine của v2 cho phép lấy một phần.
- **Khoảng cách:** tính theo đường chim bay × 1,4, tốc độ xe máy 18 km/h, cộng 10 phút mỗi điểm. v2 lấy tuyến đường thật từ bản đồ Goong; bản này không gọi API bản đồ.
- **Nhóm hạn dùng:** `perishability` (`cooked` nấu chín, `fresh` tươi sống, `packaged` đóng gói) quyết định ngưỡng nhãn. Ví dụ đồ nấu chín còn dưới 4 giờ là Đỏ.
- **Giữ hàng an toàn:** hàm SQL `reserve_donations_for_need` khóa các lô trong một giao dịch. Hai mái ấm bấm cùng lúc thì chỉ một nơi nhận được, nơi còn lại nhận lỗi 409 và tính lại phương án.

## Gợi ý trình bày trong môn Thương mại điện tử

- **Bài toán:** ghép cung cầu nhiều–một (many-to-one matching), giống gom hàng nhiều kho cho một đơn trong thương mại điện tử. Khác ở chỗ hàng có hạn rất ngắn, nên độ gấp nặng trọng số nhất.
- **Vì sao không dùng AI:** phân phối đồ ăn cho trẻ em, người già phải giải thích được lý do chọn. Thuật toán tất định thì kiểm thử và kiểm toán được.
- **Độ phức tạp:** tối đa 298 tổ hợp với 12 ứng viên, tính trong vài mili giây. Mở rộng thành phố không làm chậm, vì luôn chỉ xét 12 cửa hàng tốt nhất trong bán kính.
- **Bản quyền:** code thuộc nhóm FoodSave. Khi đưa vào báo cáo, ghi nguồn "FoodSave v2, engine match-v1".
