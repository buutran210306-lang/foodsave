// ===== SỬA CÁC DÒNG NÀY RỒI LƯU (không dán token vào chat hay Git) =====
const CONFIG = {
  API: 'https://DAN_TEN_MIEN_NETLIFY.netlify.app/api/v1', // địa chỉ API của FoodSave (KHÔNG phải localhost khi dùng n8n Cloud)
  SECRET: 'DAN_N8N_SECRET_VAO_DAY',
  PAGE_ID: 'DAN_MA_FANPAGE_FOODSAVE',     // mã Fanpage trung tâm FoodSave (nếu FoodSave đã gửi page_id thì dùng giá trị đó)
  PAGE_TOKEN: 'DAN_TOKEN_VAO_DAY',        // token Fanpage trung tâm FoodSave
  OVERLAY: true
};
// =======================================================================

const bundle = $('Lặp từng bài').first().json;
const money = (n) => String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + 'đ';
const items = bundle.items || [];
const useAi = Boolean(bundle.ai && bundle.ai.enabled);
const linkOk = /^https:/.test(bundle.link || '');
const maxDiscount = Math.max(0, ...items.map((i) => Number(i.discount_percent) || 0));
const minPrice = Math.min(...items.map((i) => Number(i.price_vnd) || 0));
const earliest = items.slice().sort((a, b) => a.hours_left - b.hours_left)[0] || {};
const hasRed = items.some((i) => i.label === 'red');

const facts = items.map((i, n) => `${n + 1}. ${i.name} (cửa hàng ${i.store_name}): giảm ${i.discount_percent}%, giá mới ${money(i.price_vnd)}${Number(i.original_price_vnd) > Number(i.price_vnd) ? ', giá cũ ' + money(i.original_price_vnd) : ''}, lấy trước ${i.deadline_text}, nhãn ${i.label === 'red' ? 'ĐỎ (sắp hết)' : 'VÀNG'}`).join('\n');
const captionPrompt = [
  'Bạn quản lý Fanpage FoodSave, ứng dụng giải cứu thực phẩm gần hết hạn. Viết MỘT bài đăng Facebook tiếng Việt tổng hợp các món sau (từ nhiều cửa hàng khác nhau) để người mua biết đang có hàng cần mua trước khi hết hạn.',
  'DỮ KIỆN CỐ ĐỊNH (giữ nguyên từng con số và tên cửa hàng, KHÔNG sửa, thêm hay bịa):',
  facts,
  bundle.more_count > 0 ? `Ngoài ra còn ${bundle.more_count} món khác trên sàn (có thể nhắc "…và ${bundle.more_count} món khác").` : '',
  `Giọng điệu: ${hasRed ? 'khẩn trương nhưng thân thiện, nhắc giờ lấy cuối cùng' : 'nhẹ nhàng, giá mềm hôm nay'}.`,
  'Quy tắc: 6–8 dòng, emoji vừa phải, hashtag 3–5 cái (có #FoodSave). KHÔNG nhắc số lượng tồn kho. KHÔNG ghi "ảnh minh hoạ". Nêu khách tự đến cửa hàng nhận, không giao hàng.',
  linkOk ? `Gắn đúng một link: ${bundle.link}` : 'Không gắn link.',
  'Chỉ trả về nội dung bài đăng, không giải thích.'
].filter(Boolean).join('\n');

const imagePrompt = [
  'Tạo ảnh nền poster quảng cáo cho Fanpage FoodSave: bàn ăn với vài món đồ ăn hấp dẫn, tươi, màu sắc ấm.',
  hasRed ? 'Tông đỏ cam khẩn trương.' : 'Tông vàng ấm tươi sáng.',
  'Chừa trống khoảng 25% phía dưới và góc trên bên trái để chèn chữ sau.',
  'TUYỆT ĐỐI KHÔNG vẽ chữ, chữ số, logo hay watermark. Nếu có ảnh gốc đi kèm, lấy cảm hứng và giữ nhận diện món ăn.'
].join('\n');

const pageId = bundle.page_id || CONFIG.PAGE_ID;
return [{
  json: {
    mode: 'central',
    useAi,
    overlayEnabled: CONFIG.OVERLAY,
    label: hasRed ? 'red' : 'yellow',
    pageId,
    pageToken: CONFIG.PAGE_TOKEN,
    postLogId: bundle.post_log_id || null,
    callbackUrl: CONFIG.API + '/marketing/callback',
    secret: CONFIG.SECRET,
    imageUrl: bundle.hero_image_url || '',
    fallbackCaption: bundle.message,
    captionPrompt,
    imagePrompt,
    mustContain: items.map((i) => money(i.price_vnd)),
    link: linkOk ? bundle.link : '',
    overlay: {
      title: 'FOODSAVE · HÀNG SẮP HẾT HẠN',
      badge: `GIẢM TỚI ${maxDiscount}%`,
      line1: items.slice(0, 3).map((i) => i.name).join(' · '),
      line2: `Từ ${money(minPrice)} · lấy trước ${earliest.deadline_text || ''}`
    }
  }
}];
