# Kiểm thử tay App người mua (FOODSAVE_APP.html) trên điện thoại thật

Cần: bản triển khai HTTPS (Netlify) hoặc `localhost`; SQL 028→037 đã chạy; biến môi trường Netlify đủ (VAPID_*, PAYMENT_PROVIDER...); Supabase đã bật Email OTP (mục "Cấu hình Supabase" trong README). Làm trên **Android (Chrome)** và **iPhone (Safari, iOS ≥ 16.4)**; đánh dấu từng dòng.

## 1. Đăng nhập (4 cách)
- [ ] Google: bấm, chọn tài khoản, quay lại app, vào hồ sơ / trang chủ.
- [ ] Facebook: như trên.
- [ ] Gmail + OTP: nhập email → nhận mã 6 số → nhập → vào app. Nút "Gửi lại" chỉ bấm được sau 60 giây.
- [ ] SĐT + OTP: nhập số → nhận SMS → nhập mã.
- [ ] Tài khoản từ thiện / cửa hàng đăng nhập vào app: bị đăng xuất và hiện hướng dẫn dùng cổng riêng. Không có mục chọn vai trò.
- [ ] Người mới: Thông tin cá nhân → Xác nhận vị trí → Xin quyền thông báo → Trang chủ.

## 2. Vị trí và bản đồ
- [ ] "Vị trí hiện tại": hỏi quyền GPS, ghim đúng chỗ, kéo ghim được, gõ địa chỉ + Tìm được.
- [ ] Từ chối GPS: vẫn nhập địa chỉ tay được.
- [ ] Trang chủ "Gần bạn" có ghim; chạm mở màn Bản đồ; chạm ghim mở cửa hàng; cuộn trang không bị kẹt trong bản đồ nhỏ.
- [ ] Cửa hàng / chi tiết đơn: bản đồ nhỏ + "Chỉ đường Google Maps" mở đúng chỗ.
- [ ] Tắt mạng: màn Bản đồ hiện thông báo thay vì trắng.

## 3. Đặt hàng → thanh toán → QR
- [ ] Thêm sản phẩm (ảnh thật của cửa hàng; sản phẩm không ảnh hiện emoji theo danh mục).
- [ ] Xác nhận → chọn phương thức → "Đặt hàng & thanh toán": đồng hồ đếm theo hạn của server.
- [ ] Mô phỏng: bấm "Tôi đã thanh toán". MoMo thật: mở trang MoMo, thanh toán, app tự chuyển sang chi tiết đơn.
- [ ] Chi tiết đơn có mã QR; cổng cửa hàng quét được bằng camera (Nhận hàng · QR).
- [ ] Huỷ: số hoàn tiền / điểm trừ hiển thị đúng với kết quả thực tế sau khi huỷ.
- [ ] Đơn đã nhận: Khiếu nại có ảnh; Chat với cửa hàng (tin mới sau tối đa 6 giây).

## 4. Thông báo (cần bật thông báo đẩy)
- [ ] Thanh toán thành công: nhận push, bấm mở đúng chi tiết đơn.
- [ ] Cửa hàng bấm "Sẵn sàng": nhận push "đã chuẩn bị xong đơn, đến nhận trước hh:mm", bấm mở đúng đơn.
- [ ] Admin tạo voucher mới: nhận push, bấm mở màn Voucher. Chỉ nhận một lần.
- [ ] Cá nhân → Cài đặt thông báo: tắt nhóm "Đơn hàng", làm lại bước trên: không có push nhưng vẫn có thông báo ở chuông.
- [ ] App đang mở: banner đầu màn hình trong ≤ 20 giây.
- [ ] Từ chối quyền: app vẫn dùng bình thường, thông báo ở chuông.

## 5. Cài app từ web
- [ ] Android/Chrome: mở web trên điện thoại → thấy thanh "Cài app FoodSave" → Cài → app mở ra FOODSAVE_APP.html, vẫn đăng nhập.
- [ ] iPhone/Safari: bấm "Cài" hiện hướng dẫn Chia sẻ → Thêm vào MH chính; mở từ biểu tượng.
- [ ] Sau khi cài: thanh và mục "Cài đặt app" tự ẩn. Đóng thanh: 7 ngày sau mới hiện lại.
- [ ] Web không tự chuyển sang app ở bất kỳ bước nào.
- [ ] Mất mạng khi mở app: hiện trang "Bạn đang mất kết nối".
- [ ] Phát hành bản mới (đổi CACHE_VERSION): app hiện "Có phiên bản mới" → Tải lại.
