# Hướng dẫn tự thử quy trình đơn hàng trả trước (kịch bản 1-9)

Dành cho người không chuyên kỹ thuật. Làm lần lượt từ trên xuống. Mọi lệnh SQL chạy trong **Supabase → SQL Editor**.

## A. Chuẩn bị (làm một lần)

1. **Chạy SQL theo thứ tự**, mỗi tệp một lần, xong tệp này mới chạy tệp sau:
   1. `database/Orders/028_order_policy_enums.sql` (**chạy riêng**, bấm Run và đợi thành công)
   2. `database/Orders/029_order_policy.sql`
   3. `database/Orders/033_order_messages.sql` (cho chat; có thể chạy ngay sau 029)
2. **Tài khoản cần có:** 1 tài khoản **cửa hàng** đã được duyệt (dùng chính cửa hàng của bạn), và 1 tài khoản **người mua** (tự đăng ký trên `FOODSAVE_USER.html`).
3. **Chạy dữ liệu thử:** mở `database/Seed/seed_order_policy.sql`, sửa dòng `v_owner_email` thành email tài khoản cửa hàng, rồi Run. Kết quả: cửa hàng "[THỬ] Tiệm Đơn Hàng" với 3 sản phẩm **[THỬ] Bánh xanh / vàng / đỏ**, mỗi loại 50 phần. Chạy lại file này bất cứ lúc nào để đặt lại kho và hạn sử dụng (nhãn đỏ chỉ còn ~3 giờ, nên nên chạy lại ngay trước mỗi buổi thử).
4. **Rút ngắn thời gian để thử nhanh** (tùy chọn): trong file `.env` đặt `DEMO_MODE=true` và `ORDER_POLICY_TIME_SCALE=0.1` (60 phút thành 6 phút; hạn thanh toán nhãn đỏ 5 phút thành 30 giây). Tắt lại khi chạy thật.
5. Chạy backend: `npm run dev`. Mở `FOODSAVE_USER.html` (người mua) và `FOODSAVE_PARTNER.html` (cửa hàng) bằng Live Server, mỗi cổng một cửa sổ riêng.
6. Trang Admin → mục **Tự động hóa đơn hàng** có nút **"Chạy tác vụ đơn hàng ngay"**. Trên máy cá nhân tác vụ không tự chạy, nên mỗi lần cần "giả lập thời gian trôi" hãy bấm nút này.

## B. Các kịch bản

**Kịch bản 1: Mua đủ vòng.** Người mua đặt **[THỬ] Bánh vàng** → thấy đồng hồ đếm ngược 10 phút → bấm "Đã thanh toán" → trang đơn hiện "Còn X phút để lấy hàng", mã QR, "Hủy miễn phí đến HH:mm". Bên cửa hàng: đơn xuất hiện **chỉ sau khi thanh toán** → Nhận đơn → Sẵn sàng → nhập mã nhận hàng (hoặc dùng mục *Nhận hàng · QR*) → Hoàn thành. Kiểm tra: điểm người mua +5 (xem Tài khoản → Uy tín).
*(Phần "ví cửa hàng +tiền, doanh thu nền tảng" thuộc Đợt 2, chưa kiểm được.)*

**Kịch bản 2: Không trả tiền.** Đặt **[THỬ] Bánh đỏ**, không bấm thanh toán, đợi hết đồng hồ (5 phút, hoặc đổi sang chạy nhanh bằng lệnh bên dưới rồi bấm "Chạy tác vụ đơn hàng ngay"). Kết quả: đơn tự hủy, kho về lại 50, cửa hàng **không hề thấy** đơn.
```sql
update public.orders set pay_deadline = now() - interval '1 minute'
where order_number = 'MÃ-ĐƠN' and status = 'awaiting_payment';
```

**Kịch bản 3: Hủy miễn phí.** Đặt và thanh toán **Bánh xanh**, bấm "Hủy đơn hàng" ngay → hộp xác nhận ghi "hoàn tiền 100%" → xác nhận. Kết quả: đơn "Đã hủy", kho về lại, điểm không đổi.

**Kịch bản 4: Hủy muộn.** Thanh toán một đơn rồi chạy lệnh dưới để coi như hết thời gian hủy miễn phí, sau đó hủy:
```sql
update public.orders set cancel_free_until = now() - interval '1 minute' where order_number = 'MÃ-ĐƠN';
```
Hộp xác nhận phải ghi **"KHÔNG được hoàn tiền, trừ 5 điểm"**. Kết quả: điểm −5, hàng về kho nếu còn đủ hạn (xem `order_events` bằng lệnh trong file seed nếu hàng không về kho).

**Kịch bản 5: Vắng mặt ×3 và khóa nhãn đỏ.** Lặp 3 lần: đặt + thanh toán **Bánh vàng**, chạy lệnh dưới, bấm "Chạy tác vụ đơn hàng ngay":
```sql
update public.orders set pickup_deadline = now() - interval '6 minutes' where order_number = 'MÃ-ĐƠN';
```
(Vắng mặt chỉ được xác định sau hạn lấy + 5 phút châm chước, nên lệnh này lùi 6 phút.)
Kết quả: đơn "Vắng mặt", điểm −15 mỗi lần (100 → 85 → 70 → 55); lần 2 có thông báo cảnh báo; lần 3 có thông báo "khóa nhãn đỏ 30 ngày". Thử đặt **Bánh đỏ** → bị từ chối ("bị khóa mua hàng nhãn đỏ đến ..."); đặt **Bánh xanh/vàng** vẫn được.

**Kịch bản 6: Điểm dưới 40.** Đặt điểm 30 bằng lệnh trong file seed → đặt hàng bị từ chối. Vào Admin → **Uy tín** → khối "Khách bị hạn chế mua hàng" → **Mở khóa** → đặt lại được (điểm được nâng lên 40).

**Kịch bản 7: Cửa hàng hủy.** Thanh toán một đơn, cửa hàng bấm Hủy/Từ chối. Kết quả: người mua nhận thông báo hoàn 100%, đơn "Đã hủy", kho về lại.

**Kịch bản 8: Nhắc nhở.** Thanh toán một đơn (thông báo 1 ngay lập tức). Sau đó coi như đã qua nửa thời gian và bấm chạy tác vụ → thông báo 2:
```sql
update public.orders set paid_at = now() - interval '50 minutes', pickup_deadline = now() + interval '40 minutes' where order_number = 'MÃ-ĐƠN';
```
Rồi cho còn 10 phút và chạy tác vụ → thông báo 3 (nhắc cuối). Chạy tác vụ thêm lần nữa: **không** có thông báo mới.
```sql
update public.orders set pickup_deadline = now() + interval '10 minutes' where order_number = 'MÃ-ĐƠN';
```

**Kịch bản 9: Hoàn tất quá hạn.** Thanh toán một đơn, đặt `pickup_deadline = now() - interval '10 minutes'`, rồi để cửa hàng bấm Hoàn thành. Kết quả: báo lỗi "Đã quá hạn lấy hàng". (Nếu chỉ quá 3 phút thì vẫn được vì có 5 phút châm chước.)

**Chat (kịch bản 19).** Sau khi thanh toán, mở chi tiết đơn ở cả hai cổng: người mua có khung "Trao đổi với cửa hàng", cửa hàng có khung "Trao đổi với …" kèm 3 câu trả lời nhanh. Sau khi đơn hoàn tất hoặc bị hủy, ô nhập biến mất (chỉ xem lại).

## C. Dọn dẹp
Chạy hai lệnh "Dọn dữ liệu thử" ở cuối `seed_order_policy.sql`. Đặt lại điểm người mua bằng lệnh trong file seed nếu cần.

## D. Kiểm thử tự động (không cần database)
`npm run test:order` chạy 8 kiểm tra công thức thời gian và 18 kịch bản trên database giả trong bộ nhớ (dùng đúng code thật của backend). Không thay thế được bước thử trên Supabase thật ở trên.

---

# Đợt 2: thử sổ cái, ví cửa hàng và rút tiền

## Chuẩn bị
1. Chạy `database/Orders/030_wallet_ledger.sql` trong Supabase SQL Editor.
2. Khởi động lại backend (`npm run dev`).
3. Admin → **Tài chính · Sổ cái** → bấm **"Chạy đối soát ngay"** một lần: các đơn đã thanh toán ở Đợt 1 sẽ được ghi vào sổ cái (kết quả hiện "bù N đơn · KHỚP").

## Các bước thử
- **Thu tiền / giữ chờ:** người mua thanh toán một đơn (ví dụ 2 Bánh vàng + đóng góp 3.000đ). Admin → Sổ cái: có bút toán "Thu tiền khách" (Bên ngoài → Giữ chờ), thẻ "Giữ chờ (escrow)" tăng đúng tổng đơn.
- **Hoàn tất:** cửa hàng nhập mã nhận hàng. Sổ cái có 3 bút toán "Giải ngân": phần cửa hàng, phí 2.000đ vào Doanh thu nền tảng, 3.000đ vào Quỹ từ thiện; Giữ chờ về 0. Cổng cửa hàng → **Ví**: số dư khả dụng tăng đúng phần cửa hàng.
- **Hủy sớm:** có bút toán "Hoàn tiền" (Giữ chờ → Bên ngoài), mọi ví về 0 cho đơn đó.
- **Hủy muộn / vắng mặt:** có bút toán giải ngân kèm lý do "Hủy muộn" / "Vắng mặt"; ví cửa hàng nhận tiền (trừ phí).
- **Rút tiền:** Ví → **Rút tiền** → nhập số tiền (≥ 50.000đ, không vượt số dư khả dụng), ngân hàng và **4 số cuối** → "Chờ duyệt"; số tiền bị trừ khỏi "khả dụng" ngay. Thử nhập số lớn hơn khả dụng → bị từ chối. Admin → Tài chính → bảng "Lệnh rút tiền" → **Duyệt**: số dư ví cửa hàng giảm, sổ cái có bút toán "Rút tiền". **Từ chối**: số dư không đổi, tiền khả dụng được trả lại.
- **Đối soát:** thẻ "Lệch sổ cái" phải là **Khớp** (tổng số dư mọi ví bằng 0).

## Kiểm tra đồng thời trên Supabase thật
`npm run test:ledger-db` (cần đã chạy `seed_order_policy.sql`). Script gửi 10 yêu cầu cùng lúc với cùng một mã bút toán và 20 yêu cầu ngược chiều cùng lúc; mong đợi toàn bộ "ĐẠT". Script tự cân bằng tiền và xóa bút toán thử của nó.

---

# Phần A: tài khoản nhận tiền mã hóa, lệnh rút nhiều bước, nhà cung cấp thanh toán

## Chuẩn bị (theo thứ tự)
1. **Sao lưu** bảng rút tiền (Supabase → Database → Backups, hoặc chạy `create table if not exists public.withdrawals_backup_035 as table public.withdrawals;`).
2. Sinh khóa mã hóa: `npm run gen:payout-key`. Dán dòng `PAYOUT_ENCRYPTION_KEY=...` vào `.env` (và Netlify) **trước khi** thử. Cất bản sao khóa ở nơi an toàn khác. Đừng gửi khóa cho ai, kể cả mình.
3. Chạy SQL `034_payment_provider.sql` rồi `035_payout_accounts.sql`.
4. Khởi động lại backend.

## Thử trên giao diện
- **Tài khoản nhận tiền:** cổng cửa hàng → Cài đặt → "Tài khoản nhận tiền" → nhập ngân hàng, số tài khoản, chủ tài khoản → Gửi. Số tài khoản không hiển thị lại (chỉ thấy 4 số cuối). Vào Ví: nút Rút tiền báo "chưa xác minh".
- **Xác minh:** Admin → Tài chính → "Tài khoản nhận tiền chờ xác minh": thấy cột "Đối chiếu" (Tên khớp / Tên lệch). Tên lệch thì nhập ghi chú rồi Xác minh. Sau đó cửa hàng rút được.
- **Rút tiền:** cửa hàng gửi lệnh (chỉ nhập số tiền). Admin: Duyệt → "Xem số TK để chi" (hộp xác nhận nói rõ sẽ ghi nhật ký) → chuyển khoản ngoài → "Đã chi" nhập mã giao dịch ngân hàng. Chỉ lúc này ví cửa hàng mới giảm. Thử "Thất bại" (phải nhập lý do): số dư khả dụng được trả lại.
- **Kiểm tra nhật ký xem số:** `select * from public.payout_access_log order by created_at desc;`: mỗi lần bấm "Xem số TK để chi" có đúng một dòng.

## Chuyển dữ liệu cũ (CHƯA làm cho đến khi bạn đồng ý)
1. Chạy `database/Orders/INSPECT_bank_data.sql` (chỉ đọc) và gửi mình các con số.
2. Sao lưu, rồi `npm run migrate:bank-dry` (chạy thử: chỉ in số lượng, không ghi).
3. Khi đồng ý: `node scripts/migrate-bank-accounts.js --apply` (mặc định tài khoản chuyển sang ở trạng thái chờ xác minh, admin duyệt lại trước khi cửa hàng rút).

## Kiểm thử tự động
`npm run test:order` giờ gồm 47 kịch bản (thêm: webhook sai chữ ký / gọi trùng / lệch tiền / đến muộn, vòng đời lệnh rút, API không lộ số tài khoản, nhật ký giải mã, tài khoản chưa xác minh không rút được).

---

# Đợt 3: thử khiếu nại

## Chuẩn bị
1. Chạy SQL `database/Orders/031_complaint_flow.sql` (chạy lại được; đọc ghi chú đầu file). Khởi động lại backend.
2. Đã có đơn **đã hoàn tất** (làm theo kịch bản 1 ở phần Đợt 1).

## Các bước thử
- **Gửi khiếu nại:** người mua → Đơn hàng → mở đơn đã hoàn tất: thấy khối "Có vấn đề với đơn hàng? Còn lại để báo vấn đề (đếm ngược)" → bấm **Khiếu nại** → chọn lý do, mô tả, **chọn ít nhất 1 ảnh** → Gửi. Không có ảnh thì không gửi được. Gửi lần 2 cho cùng đơn bị chặn.
- **Cửa hàng đồng ý:** cổng cửa hàng → Khiếu nại → thẻ có đếm ngược 12 giờ và ảnh → **Đồng ý hoàn tiền 100%**. Kiểm tra: người mua nhận thông báo hoàn tiền; Admin → Tài chính: có 3 bút toán "Thu hồi sau giải ngân"; ví cửa hàng giảm; điểm uy tín cửa hàng −15 (xem bảng `seller_violations` loại `COMPLAINT_UPHELD`).
- **Cửa hàng không đồng ý → Admin:** bấm **Không đồng ý** (nhập lý do, ảnh tùy chọn). Admin → Trung tâm khiếu nại: hồ sơ nằm ở cột "Chờ Admin quyết định" → mở: thấy ảnh người mua, phản hồi cửa hàng, **lịch sử chat của đơn** → chọn Hoàn đủ / Hoàn một phần (nhập số tiền) / Bác bỏ (+ tích "khiếu nại sai" thì người mua −10 điểm) → ghi chú → Chốt.
- **Quá 12 giờ không phản hồi:** đặt `update public.complaints set response_due_at = now() - interval '1 minute' where id = '...';` rồi Admin → Tự động hóa đơn hàng → **Chạy tác vụ đơn hàng ngay**: khiếu nại tự chuyển sang "Chờ Admin quyết định".
- **Ngoài hạn khiếu nại:** `update public.orders set complaint_deadline_at = now() - interval '1 minute' where order_number = 'FS-...';` rồi người mua thấy "Đã hết thời gian báo vấn đề".
- **Tranh chấp:** Admin → Tranh chấp: bảng điều khiển (5 ô bấm để lọc, phân bố, 3 cửa hàng bị khiếu nại nhiều nhất, danh sách cần xử lý trước).

## Thử cài ứng dụng và nhận thông báo trên Android (Đợt 4a)
1. Chạy SQL `032_push_subscriptions.sql` trong Supabase. Chạy `npm run gen:vapid`, dán 3 biến VAPID vào Netlify rồi deploy lại.
2. Trên điện thoại Android, mở bằng Chrome địa chỉ https của trang người mua (FOODSAVE_USER.html) và đăng nhập.
3. Bấm nút "📲 Cài ứng dụng" ở góc dưới trái (hoặc menu Chrome → Cài đặt ứng dụng). Mở ứng dụng từ màn hình chính.
4. Bấm "🔔 Bật thông báo" → chọn Cho phép. Nút đổi thành "Thông báo: Bật".
5. Đặt một đơn và thanh toán (mô phỏng) → điện thoại báo "Đã thanh toán". Khóa màn hình rồi nhờ cửa hàng bấm "Nhận đơn" → vẫn thấy thông báo; bấm vào sẽ mở đúng đơn.
6. Tình nguyện viên: làm tương tự ở FOODSAVE_VOLUNTEER.html; khi được giao nhiệm vụ sẽ có thông báo.
7. Không thấy thông báo? Kiểm tra quyền thông báo của Chrome, tắt tiết kiệm pin cho Chrome, và xem bảng `push_subscriptions` có dòng mới không.

## Thử các màn Admin và cổng cửa hàng mới (Đợt 4b)
1. Chạy SQL `036_admin_ops.sql` trong Supabase.
2. Admin → **Chính sách nhãn & đơn**: đổi "Hạn lấy hàng" nhãn vàng từ 90 sang 60, bấm "Lưu cấu hình". Thử đặt "Hủy miễn phí" ≥ hạn lấy hàng: phải bị từ chối. Đặt một đơn nhãn vàng mới: hạn lấy hàng 60 phút; đơn cũ giữ nguyên. Admin → **Nhật ký hoạt động** có dòng "Sửa chính sách đơn". Bấm "Khôi phục mặc định" để trả lại.
3. Admin → **Tự động hóa**: bấm "Chạy ngay" ở từng tác vụ; cột "Lần chạy gần nhất" đổi theo giờ vừa chạy.
4. Admin → **Xác minh hồ sơ**: đăng ký một cửa hàng mới (hoặc tổ chức), Duyệt hoặc Từ chối (bắt buộc lý do); chủ hồ sơ nhận thông báo; lịch sử hiện ở cuối trang.
5. Admin → **Voucher**: tạo voucher toàn sàn; khách nhập mã khi thanh toán. Cổng cửa hàng → **Khuyến mãi**: tạo voucher của cửa hàng, thử Tắt/Bật.
6. Admin → **Cảnh báo gian lận** / **Uy tín**: bấm "Xử lý"; khách bị khóa nhãn đỏ có nút "Mở khóa".
7. Cổng cửa hàng → **Khách hàng**: chỉ thấy khách đã đặt ở cửa hàng bạn, số điện thoại bị che. → **Nhận hàng · QR**: bấm "Quét bằng camera" (Chrome Android, HTTPS), đưa mã QR của khách vào khung; xác nhận để hoàn tất.
