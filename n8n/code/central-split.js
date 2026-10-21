// ===== SỬA 2 DÒNG NÀY RỒI LƯU =====
const CONFIG = {
  SECRET: 'DAN_N8N_SECRET_VAO_DAY' // trùng N8N_SECRET (chỉ dùng để kiểm tra lệnh "Chạy thử ngay" từ trang Admin)
};
// ===================================

const first = $input.first().json;
let items = [];
if (first.body && first.body.bundle) {
  // Lệnh "Chạy thử ngay" từ trang Admin FoodSave
  const headers = first.headers || {};
  if (CONFIG.SECRET && headers['x-n8n-secret'] !== CONFIG.SECRET) throw new Error('Sai mật khẩu x-n8n-secret');
  items = [{ post_log_id: first.body.post_log_id, ai: first.body.ai, page_id: first.body.page_id, ...first.body.bundle }];
} else {
  // Lịch chạy: FoodSave trả về danh sách bài tổng hợp
  const data = first.data || first;
  items = (data.items || []).map((it) => ({ ...it, ai: { enabled: data.ai_enabled !== false }, page_id: data.page_id }));
}
return items.map((json) => ({ json }));
