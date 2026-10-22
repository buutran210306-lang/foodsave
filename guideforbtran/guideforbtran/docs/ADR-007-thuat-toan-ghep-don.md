# ADR-007: Thuật toán ghép đơn tổ hợp nhỏ

- **Trạng thái:** Accepted
- **Ngày:** 2026-10-07
- **Người quyết định:** Minh
- **Liên quan:** [DATA-MODEL.md §4.6, §4.7, §8.4, §12.3](../DATA-MODEL.md), ADR-004, ADR-005, ADR-006, `src/core/matching`, `src/core/routing`

## Bối cảnh

- Tài liệu định hướng: "Tổ chức A cần 50 bánh, Bách Hóa Xanh chỉ có 20; hệ thống tự tìm 30 còn lại ở cửa hàng gần đó (B 18, C 12) → đủ 50", ưu tiên hàng sắp hết hạn và cửa hàng gần; tổ chức phân công tình nguyện viên tới từng cửa hàng.
- Yêu cầu của plan: tìm **tối ưu chính xác** (không chỉ tham lam) theo thứ tự ưu tiên phủ đủ số lượng → ít điểm dừng → tuyến ngắn; công bằng giữa các tổ chức; chỉ gợi ý lô Đỏ cho tổ chức đến kịp; trả tối đa 3 phương án để so sánh trên bản đồ.
- Quy mô: một nhu cầu có vài chục lô trong bán kính; phải chạy trong một Server Action (≤ 50 ms phần tính toán), không tốn quota API bản đồ, tất định để test.

## Quyết định

### 1. Lọc ứng viên bằng SQL: `match_candidates(p_need_id, p_remaining, p_exclude_site_ids, p_at)`

Hàm `stable`, `security definer`, kiểm người gọi là thành viên `owner/manager/staff` của tổ chức sở hữu nhu cầu (tổ chức `approved`) hoặc admin. Với `cs` = điểm nhận của nhu cầu, `n` = nhu cầu, `o` = lô, `s` = điểm cửa hàng:

| Điều kiện | Biểu thức |
|---|---|
| Bán kính | `ST_DWithin(s.location, cs.location, cs.radius_km * 1000)` (index GIST) |
| Danh mục | `o.category_code = any(n.category_codes)` và (`cs.accepted_categories is null` hoặc chứa danh mục) |
| Đơn vị | `o.unit = n.unit` hoặc `n.unit = 'kg'` (quy đổi qua `unit_weight_kg`) |
| Còn hàng | `o.status = 'open' and o.qty_available > 0` |
| Cửa hàng hợp lệ | tổ chức `approved`, không `is_paused`, cùng `is_demo` với tổ chức nhận, không phải tổ chức của người gọi; `s.is_active`; `s.id <> all(p_exclude_site_ids)` |
| Khả thi | `travel_min = ST_Distance(cs, s)/1000 × 1,4 ÷ 18 × 60 + 10`; `eta_pickup = greatest(now + travel_min, lower(pickup_window)) ≤ effective_deadline`; `eta_dropoff = eta_pickup + travel_min` nằm trong giờ nhận của `cs` (`private.is_open_at`) |

Mỗi dòng trả thêm `available_need_units` (= `qty_available` nếu cùng đơn vị, = `qty_available × unit_weight_kg` nếu nhu cầu tính kg) và `pre_score = 0,4·u + 0,3·p + 0,1·t` (công thức ở mục 2, chưa có thành phần khớp số lượng). Sắp `pre_score desc, distance asc, offer_id asc`, **`limit 15`** (`app_settings.matching_candidate_limit`). Các hằng số 1,4 / 18 km/h / 10 phút đọc từ `app_settings`.

### 2. Chấm điểm (TS, `src/core/matching/score.ts`)

Gộp các lô theo **điểm cửa hàng** (một điểm dừng có thể có nhiều lô). Với mỗi điểm `i`, `R` = phần còn thiếu của nhu cầu (đơn vị nhu cầu):

| Thành phần | Công thức | Trọng số |
|---|---|---|
| Độ gấp `u` | `clamp(1 − giờ_còn_lại / H_xanh(perishability), 0, 1)`, với `giờ_còn_lại` tính tới `effective_deadline` sớm nhất của điểm, `H_xanh` = 12 h (cooked), 72 h (fresh), 168 h (packaged) | 0,4 |
| Gần `p` | `clamp(1 − distance_km / radius_km, 0, 1)` | 0,3 |
| Khớp số lượng `f` | `min(available_need_units_i, R) / R` | 0,2 |
| Uy tín `t` | `trust_score / 100` | 0,1 |

`score_i = 0,4u + 0,3p + 0,2f + 0,1t`. Hàm `u`, `p`, `t` dùng chung fixture với `pre_score` của SQL.

### 3. Tìm tổ hợp chính xác (≤ 3 điểm)

1. Lấy **12 điểm** có `score` cao nhất (tie-break `site_id`).
2. Duyệt **mọi** tổ hợp 1, 2, 3 điểm: C(12,1) + C(12,2) + C(12,3) = 12 + 66 + 220 = **298 tổ hợp**.
3. Với mỗi tổ hợp, **cấp số lượng**: sắp các lô trong tổ hợp theo `effective_deadline` tăng dần (hàng sắp hết hạn dùng trước), rồi `score` giảm dần; mỗi lô nhận `q = min(qty_available, phần còn thiếu quy đổi)`:
   - cùng đơn vị: `q = min(qty_available, còn_thiếu)` (số nguyên nếu đơn vị không liên tục);
   - nhu cầu kg, lô đơn vị đếm: `q = min(qty_available, ceil(còn_thiếu / unit_weight_kg))` ⇒ có thể vượt nhu cầu **ít hơn một đơn vị** (dung sai được phép).
4. `coverage = min(Σ cấp quy đổi, R) / R`.
5. **Loại tổ hợp không tối giản:** có điểm được cấp 0 (vì các điểm khác đã đủ).
6. Ước lượng tuyến bằng `src/core/routing` (mục 5) ⇒ `route_km`, `route_min`.
7. **Xếp hạng theo khóa từ điển:** (1) `coverage` giảm dần (so ở 6 chữ số thập phân) → (2) số điểm dừng tăng dần → (3) `route_km` tăng dần → (4) `score` trung bình giảm dần → (5) danh sách `site_id` đã sắp (tất định).

### 4. Mở rộng tham lam tới 5 điểm và chọn 3 phương án

- Nếu tổ hợp tốt nhất chưa phủ đủ (`coverage < 1`): lấy **3 tổ hợp đứng đầu**, với mỗi tổ hợp lặp: thêm điểm (trong toàn bộ ứng viên, kể cả ngoài top 12) làm tăng `coverage` nhiều nhất, hòa thì `score` cao hơn, rồi `site_id`; dừng khi `coverage = 1` hoặc đủ **5 điểm** (`app_settings.max_pickup_stops`). Cấp lại số lượng và tuyến cho tổ hợp mở rộng.
- *Bổ sung khi cài đặt (P3-03, 08/10):* ngoài 3 tổ hợp đầu, chạy thêm một lượt mở rộng từ **tập rỗng**. Khi thời gian không ràng buộc, lượt này đạt phủ tối đa với ≤ 5 điểm (chọn các điểm khả dụng lớn nhất), nên phủ của phương án 1 đơn điệu khi thêm ứng viên (P10) kể cả khi điểm đủ hàng nằm ngoài top 12. Tổ hợp không có thứ tự đi khả thi bị loại khỏi phương án (mục 5 chỉ trả "thứ tự trễ ít nhất" khi lập chuyến). Chi tiết: ARCHITECTURE §4.1.
- Gộp tổ hợp chính xác và tổ hợp mở rộng, bỏ trùng tập điểm, xếp theo khóa mục 3.7, **trả 3 phương án đầu** (có thể ít hơn). Mỗi phương án gồm: dòng cấp (`offer_id`, `qty`), điểm dừng có thứ tự, `coverage`, `stop_count`, `route_km/min` ước lượng, điểm thành phần (lưu vào `need_bundles.inputs_snapshot` khi được chọn).
- Ghép lại phần thiếu: chạy lại đúng thuật toán với `R` = phần còn thiếu, `p_exclude_site_ids` = các điểm đã có phân bổ sống cho nhu cầu.
- Phiên bản thuật toán `match-v1` ghi vào `need_bundles.algorithm_version`.

### 5. Tuyến (`src/core/routing`)

- Điểm đầu và cuối là điểm nhận của tổ chức (hoặc vị trí TNV khi phân công). Khoảng cách giữa hai điểm = haversine × 1,4; thời gian ở 18 km/h + 10 phút mỗi điểm dừng.
- **Duyệt mọi hoán vị** khi ≤ 5 điểm lấy (tối đa 5! = 120); chỉ giữ hoán vị khả thi (tới mỗi điểm trước `effective_deadline` của nó, chờ nếu tới trước `lower(pickup_window)`); chọn tổng km nhỏ nhất, hòa thì thứ tự `site_id`. Không có hoán vị khả thi ⇒ chọn hoán vị trễ ít nhất và gắn cờ cảnh báo.
- **Chỉ gọi API chỉ đường thật** (`MapsProvider.route`, xe máy) cho **phương án tổ chức chọn** (trước `reserve_bundle`) và khi lập chuyến (`assign_pickup`); kết quả lưu `need_bundles.route`, `pickups.route`.

### 6. Công bằng nằm ở phía lô

Một nhu cầu thuộc một tổ chức nên ghép đơn không phân xử giữa các tổ chức. Công bằng áp khi **thông báo lô mới**: tổ chức đủ điều kiện được sắp theo `kg đã nhận 30 ngày ÷ số người phục vụ` tăng dần (tổ chức nhận ít trên đầu người được báo trước), chia 3 đợt cách nhau 5 phút; lô Đỏ báo tất cả cùng lúc (DATA-MODEL §12.3). Admin xem chỉ số công bằng của từng tổ chức.

### 7. Kiểm thử bắt buộc (Vitest + fast-check, `src/core/matching/*.property.test.ts`)

Bộ sinh dữ liệu ngẫu nhiên: 0–20 ứng viên, nhiều lô mỗi điểm, đơn vị trộn lẫn, một số ứng viên cố tình ngoài bán kính hoặc quá hạn (core phải tự lọc phòng thủ).

| # | Thuộc tính |
|---|---|
| P1 | **Không cấp vượt lô:** với mọi lô, tổng `qty` trong một phương án ≤ `qty_available` |
| P2 | **Không vượt nhu cầu:** tổng quy đổi ≤ `R` khi cùng đơn vị; ≤ `R + max(unit_weight_kg)` khi quy đổi kg |
| P3 | **Tôn trọng bán kính:** mọi điểm trong phương án có `distance_km ≤ radius_km` |
| P4 | Khả thi thời gian: mọi lô được chọn có `eta_pickup ≤ effective_deadline` |
| P5 | Số nguyên cho đơn vị không liên tục; `qty > 0` cho mọi dòng |
| P6 | ≤ 5 điểm dừng; ≤ 3 phương án; các phương án có tập điểm khác nhau |
| P7 | Tất định: hoán vị thứ tự đầu vào cho cùng kết quả |
| P8 | Tối ưu: với ≤ 8 điểm, phương án 1 bằng kết quả của bộ duyệt vét cạn tham chiếu (cài đặt ngây thơ riêng) theo cùng khóa xếp hạng |
| P9 | Tối giản: phương án phủ đủ (từ phần vét cạn) không chứa điểm nào bỏ đi mà vẫn phủ đủ |
| P10 | Đơn điệu: thêm một ứng viên không làm `coverage` của phương án 1 giảm |
| P11 | Tuyến: `bestOrder` là một hoán vị của đầu vào và bằng min vét cạn tham chiếu |
| P12 | Kịch bản ví dụ "50 bánh: A 20, B 18, C 12" trả phương án 1 = {A, B, C}, phủ 100% |

Ngoài ra: fixture SQL/TS cho `pre_score`; pgTAP cho `match_candidates` (bán kính, khả thi, giới hạn 15, B8: tổ chức chưa duyệt bị từ chối).

## Hệ quả

**Tích cực**
- Kết quả tối ưu chính xác trong không gian ≤ 3 điểm (trường hợp phổ biến: một xe máy đi 1–3 cửa hàng), giải thích được ("vì sao chọn phương án này").
- Chi phí cố định nhỏ (298 tổ hợp × ≤ 6 hoán vị), không gọi API bản đồ khi đề xuất ⇒ nhanh và không tốn quota.
- Tách SQL (lọc, quyền, không gian) và TS (tổ hợp, test thuộc tính) đúng thế mạnh từng tầng.

**Tiêu cực**
- Phần 4–5 điểm dùng tham lam nên không đảm bảo tối ưu.
- Ước lượng đường chim bay × 1,4 có thể lệch với đường thực ở khu nhiều sông/cầu; chấp nhận vì tuyến thật được tính lại cho phương án chọn.
- Kết quả có thể cũ vài giây so với lúc bấm chọn; `reserve_bundle` kiểm lại toàn bộ dưới khóa và trả lỗi rõ ràng nếu lô vừa hết.

## Phương án đã cân nhắc

| Phương án | Lý do không chọn |
|---|---|
| Chỉ tham lam (gần nhất/gấp nhất trước) | Dễ ra 4–5 điểm dừng trong khi 2 điểm là đủ; không đạt yêu cầu "tối ưu chính xác" |
| Vét cạn tới 5 điểm trên 15 ứng viên (4.943 tổ hợp × 120 hoán vị) | Chạy được nhưng chậm hơn hai bậc, lợi ích biên nhỏ vì khóa xếp hạng ưu tiên ít điểm dừng; có thể bật lại nếu dữ liệu pilot cho thấy cần |
| ILP/MIP (OR-Tools, GLPK) | Thêm phụ thuộc native/WASM nặng cho serverless; khó giải thích; quy mô không cần |
| API tối ưu tuyến/VRP của nhà cung cấp | Tốn quota mỗi lần đề xuất; phụ thuộc mạng; khó test tất định |
| pgRouting trong Postgres | Không có dữ liệu mạng đường; nặng cho Supabase Free |
