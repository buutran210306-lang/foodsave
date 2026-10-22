// ===== SỬA CÁC DÒNG NÀY RỒI LƯU (không dán token vào chat hay Git) =====
const CONFIG = {
  API: 'https://foodsavevn.netlify.app/api/v1', // địa chỉ API của FoodSave (KHÔNG phải localhost khi dùng n8n Cloud)
  SECRET: 'DAN_N8N_SECRET_VAO_DAY',                        // trùng N8N_SECRET trong .env / biến môi trường Netlify
  DEFAULT_PAGE_ID: 'DAN_MA_FANPAGE_MAC_DINH',              // dùng khi cửa hàng chưa nhập mã Fanpage
  // Mỗi Fanpage một token. Khóa là mã Fanpage.
  PAGE_TOKENS: {
    'DAN_MA_FANPAGE_CUA_HANG': 'DAN_TOKEN_VAO_DAY'
  },
  OVERLAY: true // false = không chèn chữ lên ảnh AI
};
// =======================================================================

const input = $input.first().json;
const body = input.body || input;
const headers = input.headers || {};
if (CONFIG.SECRET && headers['x-n8n-secret'] !== CONFIG.SECRET) throw new Error('Sai mật khẩu x-n8n-secret');

const money = (n) => String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + 'đ';
const store = body.store || {};
const product = body.product || {};
const content = body.content || {};
const label = product.label || 'yellow';
const reminder = body.variant === 'reminder';
const pageId = store.facebook_page_id || CONFIG.DEFAULT_PAGE_ID;
const useAi = Boolean(body.ai && body.ai.enabled) && !reminder && (label === 'red' || label === 'yellow');

const price = money(product.price_vnd);
const original = Number(product.original_price_vnd) > Number(product.price_vnd) ? money(product.original_price_vnd) : '';
const time = String(product.deadline_text || '').split(' ')[0];
const groupText = { cooked: 'đồ nấu chín / bánh tươi (nhấn mạnh giờ lấy trong hôm nay)', fresh: 'rau củ, thịt cá, sữa tươi (nhấn mạnh hạn dùng theo ngày)', packaged: 'đồ đóng gói (nhấn mạnh mức giảm và hạn dùng còn đủ)' }[product.food_group] || 'thực phẩm';
const tone = label === 'red' ? 'KHẨN, giải cứu gấp: sắp hết hạn, kêu gọi đến mua ngay' : 'nhẹ nhàng, thân thiện: hôm nay giá mềm, không dùng chữ "giải cứu gấp"';
const linkOk = /^https:/.test(product.url || '');

const facts = [
  `Tên cửa hàng: ${store.name}`,
  `Địa chỉ ngắn: ${store.address || ''}`,
  `Món: ${product.name}`,
  `Nhóm hàng: ${groupText}`,
  `Giá mới: ${price}`,
  original ? `Giá cũ: ${original}` : '',
  `Mức giảm: ${product.discount_percent}%`,
  `Lấy trước: ${product.deadline_text}`,
  linkOk ? `Link đặt hàng: ${product.url}` : ''
].filter(Boolean).join('\n');

const captionPrompt = [
  'Bạn viết bài đăng Facebook tiếng Việt cho một cửa hàng đang bán giải cứu thực phẩm gần hết hạn trên ứng dụng FoodSave.',
  'DỮ KIỆN CỐ ĐỊNH (giữ nguyên từng con số, KHÔNG được sửa, thêm hoặc bịa số liệu):',
  facts,
  `Giọng điệu: ${tone}.`,
  'Quy tắc: thân thiện, emoji vừa phải, 5–7 dòng, tiêu đề và giờ lấy nằm ở 2–3 dòng đầu, hashtag 3–5 cái (có #FoodSave).',
  'TUYỆT ĐỐI KHÔNG nhắc số lượng tồn kho (không viết "còn N phần"). KHÔNG ghi "ảnh minh hoạ". Nêu rõ khách tự đến cửa hàng nhận.',
  linkOk ? 'Gắn đúng link đặt hàng ở trên, chỉ một link.' : 'Không gắn link.',
  'Chỉ trả về nội dung bài đăng, không giải thích.'
].join('\n');

const brand = store.brand_color ? `Tông màu thương hiệu cửa hàng: ${store.brand_color}.` : (label === 'red' ? 'Tông ấm đỏ cam, cảm giác khẩn trương.' : 'Tông vàng ấm, tươi sáng.');
const imagePrompt = [
  `Tạo ảnh nền quảng cáo kiểu poster đồ ăn cho món "${product.name}" (${groupText}).`,
  'Món ăn nổi bật, nhìn ngon, ánh sáng đẹp, nền sạch.',
  brand,
  'Chừa trống khoảng 25% phía dưới và góc trên bên trái để chèn chữ sau.',
  'TUYỆT ĐỐI KHÔNG vẽ chữ, chữ số, logo, hình mờ hay watermark trong ảnh. Nếu có ảnh gốc đi kèm, giữ nhận diện món như ảnh gốc.'
].join('\n');

return [{
  json: {
    mode: 'store',
    useAi,
    overlayEnabled: CONFIG.OVERLAY,
    label,
    pageId,
    pageToken: CONFIG.PAGE_TOKENS[pageId] || '',
    postLogId: body.post_log_id || null,
    callbackUrl: CONFIG.API + '/marketing/callback',
    secret: CONFIG.SECRET,
    imageUrl: reminder ? '' : (product.image_url || ''),
    fallbackCaption: content.facebook,
    captionPrompt,
    imagePrompt,
    mustContain: [price, time].filter(Boolean),
    link: linkOk ? product.url : '',
    overlay: {
      title: store.name,
      badge: `GIẢM ${product.discount_percent}%`,
      line1: price,
      line2: `Lấy trước ${product.deadline_text}`
    }
  }
}];
