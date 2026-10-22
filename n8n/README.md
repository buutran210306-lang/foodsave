# AI Agent đăng bài Facebook bằng n8n (FoodSave)

Có **2 workflow**, mỗi workflow có 3 tầng dự phòng. Nhập từng file bằng n8n: **Workflows → Import from file**.

| File | Đăng lên | Nội dung | Khi nào chạy |
|---|---|---|---|
| `workflow-2-cua-hang-ai.json` | **Fanpage của cửa hàng** (mã Fanpage lấy từ dữ liệu cửa hàng) | Bài về đúng một món của cửa hàng đó, ảnh mang tên cửa hàng | Khi cửa hàng bấm "Phát hành" hoặc Auto-bot bắt đầu (webhook `foodsave-promote`) |
| `workflow-1-kenh-foodsave-ai.json` | **Fanpage trung tâm FoodSave** | Bài **tổng hợp** tối đa 3 món nhãn đỏ/vàng từ nhiều cửa hàng | Mỗi 30 phút (chỉnh được) và nút **Chạy thử ngay** trên trang Admin (webhook `foodsave-central`) |

Nhãn xanh **không** gọi AI. Nhãn vàng và đỏ gọi AI, nhãn đỏ viết giọng gấp hơn.

## 3 tầng (giữ đúng thứ tự)
1. **AI (trong n8n):** tải ảnh gốc → Gemini viết caption → Gemini tạo ảnh nền từ ảnh gốc → chèn chữ (tên cửa hàng, % giảm, giá, giờ nhận lấy từ dữ liệu thật) → đăng ảnh kèm caption lên Fanpage. Mỗi bước AI chờ tối đa 20 giây.
2. **Mẫu (vẫn trong n8n):** AI lỗi, quá giờ, sai key, hoặc caption AI **sai giá/giờ** hay **nhắc số lượng tồn** → dùng caption mẫu do FoodSave soạn + ảnh gốc, vẫn đăng.
3. **Trực tiếp (trong backend):** n8n không gọi được → backend FoodSave tự đăng bằng `FACEBOOK_PAGE_TOKENS`.

Tầng nào đã dùng được ghi vào lịch sử (cột "Tầng" trên trang Admin). Số liệu trong caption AI luôn được kiểm tra: AI không được sửa giá, giờ, nhãn.

## Việc bạn cần làm (không cần nhờ ai)
1. **Tạo tài khoản n8n Cloud** (n8n.io). Bản dùng thử có giới hạn số lần chạy: workflow 1 mặc định 30 phút/lần. Khi demo có thể đổi node "Mỗi 30 phút" xuống 10 phút, xong đổi lại.
2. **Nhập 2 file JSON** (Import from file).
3. **Tạo 2 Credentials** trong n8n (loại *Header Auth*):
   - Tên **`Gemini API key`**: Name = `x-goog-api-key`, Value = *key Gemini của bạn* (lấy ở Google AI Studio).
   - Tên **`FoodSave n8n secret`**: Name = `x-n8n-secret`, Value = *cùng giá trị với `N8N_SECRET`* trong `.env` / Netlify.
   Mở từng node có biểu tượng cảnh báo (các node *Gemini*, *Lấy bài tổng hợp từ FoodSave*, *Báo kết quả về FoodSave*) và chọn đúng credential vừa tạo.
4. **Sửa khối `CONFIG` ở đầu các node Code** (không dán token vào chat hay Git):
   - `Chuẩn bị` của workflow 2: `API` (địa chỉ `https://<tên-site>.netlify.app/api/v1`), `SECRET`, `PAGE_TOKENS` (mã Fanpage → token).
   - `Chuẩn bị` của workflow 1: `API`, `SECRET`, `PAGE_ID`, `PAGE_TOKEN` của Fanpage FoodSave.
   - `Tách từng bài` của workflow 1: `SECRET`.
   - Node HTTP *Lấy bài tổng hợp từ FoodSave*: kiểm tra địa chỉ đang là `https://foodsavevn.netlify.app`, đổi nếu site thật có tên khác.
5. **Bật Active** cả hai workflow. Lấy địa chỉ **Production URL** của hai webhook (đường dẫn `/webhook/...`, không phải `/webhook-test/...`):
   - `.../webhook/foodsave-promote` → biến `N8N_WEBHOOK_URL`
   - `.../webhook/foodsave-central` → biến `N8N_CENTRAL_WEBHOOK_URL`
6. **Điền biến môi trường** (xem `.env.example`). Trên Netlify đặt cùng các biến này (Site settings → Environment variables).
7. Trên Admin (mục *AI Agent đăng bài*) bấm **Chạy thử ngay** để kiểm tra.

## Giới hạn cần biết
- **Chèn chữ lên ảnh** dùng node *Edit Image* của n8n. Font mặc định của n8n có thể **thiếu dấu tiếng Việt**. Nếu chữ trên ảnh bị lỗi dấu, đặt `OVERLAY: false` trong khối CONFIG (bài vẫn đăng bằng ảnh AI/ảnh gốc, giá và giờ nằm trong caption), hoặc cấu hình font hỗ trợ tiếng Việt cho node.
- **Model tạo ảnh Gemini** (`gemini-2.5-flash-image`) phụ thuộc key/gói của bạn. Nếu không dùng được, node tự lỗi và workflow chuyển sang caption mẫu + ảnh gốc.
- Hai workflow này mình chưa chạy được trên n8n thật (cần key và Fanpage của bạn). Phần logic các node Code đã được kiểm thử tự động bằng `node n8n/test-tiers.js`.
- Instagram và TikTok hiện chỉ tạo sẵn nội dung ("Nội dung sẵn sàng"), chưa tự đăng.

## Kiểm thử logic 3 tầng trên máy
```
npm run build
node n8n/test-tiers.js
```
