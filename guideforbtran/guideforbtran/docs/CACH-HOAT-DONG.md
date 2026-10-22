# Engine ghép đơn hoạt động thế nào

## Đầu vào và đầu ra

**Đầu vào:**
- **Nhu cầu** (`MatchNeed`): cần bao nhiêu, đơn vị gì, những danh mục chấp nhận được, cần trước mấy giờ, vị trí điểm nhận, bán kính đi lấy.
- **Danh sách ứng viên** (`MatchCandidate[]`): mỗi lô tặng một dòng, kèm cửa hàng, số lượng, hạn hiệu lực, khung giờ lấy, khoảng cách, giờ tới dự kiến, điểm uy tín.

**Đầu ra** (`MatchResult`):
- `plans`: tối đa 3 phương án. Mỗi phương án có các dòng lấy hàng (`lines`), điểm dừng theo thứ tự (`stops`), phần đáp ứng / còn thiếu, km và phút ước tính, số lô Đỏ.
- `candidates.dropped`: lô bị loại và lý do (`out_of_radius`, `category_mismatch`, `expired`, `infeasible_timing`…).
- `siteScores`: điểm thành phần của từng cửa hàng, dùng để giải thích.

Hàm chính: `proposePlans(need, candidates, options?)` trong `core/matching/propose.ts`.

## Từng bước

1. **Sàng lọc** (`candidates.ts`): chuẩn hoá dữ liệu, bỏ trùng, loại theo danh mục, đơn vị, số lượng, bán kính, hạn dùng, và giờ tới lấy so với hạn.
2. **Gộp theo cửa hàng và chấm điểm** (`score.ts`): một cửa hàng có thể có nhiều lô.
   - Độ gấp = 1 − giờ còn lại / H, với H = 12 giờ (nấu chín), 72 giờ (tươi sống), 168 giờ (đóng gói).
   - Độ gần = 1 − khoảng cách / bán kính.
   - Khớp số lượng = min(lượng có, lượng cần) / lượng cần.
   - Uy tín = điểm uy tín / 100.
   - Điểm = 0,4 × gấp + 0,3 × gần + 0,2 × khớp + 0,1 × uy tín.
3. **Duyệt tổ hợp chính xác** (`propose.ts`): với 12 cửa hàng điểm cao nhất, thử mọi tổ hợp 1–3 cửa hàng: C(12,1) + C(12,2) + C(12,3) = 12 + 66 + 220 = 298.
4. **Chia số lượng theo FEFO:** lô hết hạn sớm hơn được lấy trước. Hòa thì lô điểm cao hơn trước.
5. **Mở rộng tham lam:** nếu không tổ hợp nào đủ, thêm dần cửa hàng tới tối đa 5 điểm dừng.
6. **Sắp tuyến** (`routing/order.ts`): tối đa 5 điểm thì thử mọi thứ tự; nhiều hơn thì dùng láng giềng gần nhất rồi cải thiện bằng 2-opt. Thời gian = khoảng cách × 1,4 / 18 km/h + 10 phút mỗi điểm.
7. **Xếp hạng và chọn 3 phương án khác nhau:** đáp ứng đủ → ít điểm dừng → ít km → điểm trung bình cao.

## Vì sao thiết kế như vậy

- **Tất định:** cùng đầu vào luôn ra cùng kết quả, kể cả khi đổi thứ tự dữ liệu. Nhờ vậy test được và giải thích được.
- **Giới hạn 12 cửa hàng:** giữ số tổ hợp nhỏ (298), nên nhanh dù thành phố lớn.
- **Độ gấp nặng nhất:** đồ ăn dư thường chỉ còn vài giờ, lô sắp hỏng phải đi trước.
- **Kiểm thử ở FoodSave v2:** 12 property test (máy tự sinh dữ liệu ngẫu nhiên và so với cách thử hết mọi khả năng), cùng kịch bản "50 ổ = 20 + 18 + 12".
