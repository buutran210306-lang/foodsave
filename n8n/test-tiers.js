// Kiểm thử 3 tầng đăng bài AI (không gọi mạng thật, không cần token). Chạy:  npm run build && node n8n/test-tiers.js
// - Tầng 1 và 2 chạy đúng các đoạn code trong n8n/code/*.js với dữ liệu giả của Gemini.
// - Tầng 3 chạy hàm thật của backend (dist/) với fetch giả: n8n hỏng -> đăng thẳng bằng token Fanpage.
const fs = require('fs');
const path = require('path');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

let pass = 0, fail = 0;
const ok = (cond, name, extra) => { cond ? pass++ : fail++; console.log((cond ? '  ✓ ' : '  ✗ ') + name + (cond ? '' : '  → ' + (extra || ''))); };

// Chạy một node Code của n8n với môi trường giả
async function runNode(file, { input = {}, binary, nodes = {} } = {}) {
  const src = fs.readFileSync(path.join(__dirname, 'code', file), 'utf8');
  const fn = new AsyncFunction('$input', '$', 'ctx', 'with(ctx){ return (async function(){' + src + '\n}).call(this) }');
  const $ = (name) => {
    const n = nodes[name];
    return { first: () => ({ json: (n && n.json) || {} }), isExecuted: Boolean(n) };
  };
  const helpers = {
    getBinaryDataBuffer: async () => Buffer.from('ANH-GOC'),
    prepareBinaryData: async (buf, name, mime) => ({ fileName: name, mimeType: mime, data: buf.toString('base64') })
  };
  const result = await fn.call({ helpers }, { first: () => ({ json: input, binary }) }, $, {});
  return result;
}

const payload = (label, extra = {}) => ({
  headers: { 'x-n8n-secret': 'DAN_N8N_SECRET_VAO_DAY' },
  body: {
    event: 'product.promote', variant: 'main', post_log_id: 'p-1', ai: { enabled: true },
    store: { id: 's1', name: 'Cửa hàng mẫu A', address: '5 Lê Lợi, Q.7', facebook_page_id: 'DAN_MA_FANPAGE_CUA_HANG' },
    product: { id: 'x1', name: 'Bánh mì ngọt', label, food_group: 'cooked', price_vnd: 12000, original_price_vnd: 60000, discount_percent: 80, deadline_text: '21:30 hôm nay', image_url: 'https://example.com/a.jpg', url: 'https://example.com/?product=x1' },
    content: { facebook: 'CAPTION MẪU 12.000đ lấy trước 21:30' },
    ...extra
  }
});

(async () => {
  console.log('\n[1] Bình thường: AI chạy -> bài có ảnh và caption AI');
  const prep = (await runNode('store-prepare.js', { input: payload('red') }))[0].json;
  ok(prep.useAi === true, 'nhãn đỏ gọi AI');
  ok(!/còn \d+ phần/i.test(prep.captionPrompt) && /KHÔNG nhắc số lượng/.test(prep.captionPrompt), 'prompt cấm nhắc số lượng tồn kho');
  ok(prep.captionPrompt.includes('12.000đ') && prep.captionPrompt.includes('60.000đ'), 'prompt có đúng giá cũ / mới');
  ok(/KHÔNG vẽ chữ/.test(prep.imagePrompt), 'prompt ảnh dặn không vẽ chữ');
  const req = (await runNode('build-ai-request.js', { binary: { orig: { mimeType: 'image/jpeg' } }, nodes: { 'Chuẩn bị': { json: prep } } }))[0].json;
  ok(req.imageRequest.contents[0].parts[0].inline_data, 'gửi kèm ảnh gốc cho Gemini');
  const aiCaption = '🔥 GIẢI CỨU GẤP: Bánh mì ngọt giảm 80%\nCửa hàng mẫu A · 12.000đ, lấy trước 21:30 hôm nay\n#FoodSave';
  const geminiOk = { candidates: [{ content: { parts: [{ text: aiCaption }] } }] };
  const imageOk = { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: Buffer.from('ANH-AI').toString('base64') } }] } }] };
  const merged = (await runNode('merge-ai.js', { nodes: { 'Dựng yêu cầu AI': { json: req }, 'Gemini · viết caption': { json: geminiOk }, 'Gemini · tạo ảnh nền': { json: imageOk } } }))[0];
  ok(merged.json.tier === 'ai' && merged.json.aiImage === true, 'tier = ai, dùng ảnh AI', JSON.stringify(merged.json.tier));
  ok(merged.json.caption.includes('12.000đ') && merged.binary && merged.binary.data, 'có caption AI và ảnh');
  ok(merged.json.caption.includes('https://example.com/?product=x1'), 'tự gắn link https vào bài AI');
  ok(merged.json.overlay.title === 'Cửa hàng mẫu A' && merged.json.overlay.badge === 'GIẢM 80%', 'chữ chèn lên ảnh lấy từ dữ liệu thật của cửa hàng, không để AI bịa');

  console.log('\n[2] Tắt/sai key Gemini -> vẫn đăng bằng caption mẫu + ảnh gốc (tầng 2)');
  const errRes = { error: { message: 'API key not valid' } };
  const t2 = (await runNode('merge-ai.js', { nodes: { 'Dựng yêu cầu AI': { json: req }, 'Gemini · viết caption': { json: errRes }, 'Gemini · tạo ảnh nền': { json: errRes } } }))[0];
  ok(t2.json.tier === 'template' && t2.json.caption === 'CAPTION MẪU 12.000đ lấy trước 21:30', 'Gemini lỗi -> caption mẫu', t2.json.tier);
  ok(t2.json.aiImage === false && t2.binary && Buffer.from(t2.binary.data.data || t2.binary.data, 'base64').toString() !== '', 'vẫn có ảnh gốc');
  const stock = { candidates: [{ content: { parts: [{ text: 'Bánh mì 12.000đ lấy trước 21:30, còn 5 phần thôi nhé, nhanh tay lên bạn ơi hôm nay' }] } }] };
  const t2b = (await runNode('merge-ai.js', { nodes: { 'Dựng yêu cầu AI': { json: req }, 'Gemini · viết caption': { json: stock }, 'Gemini · tạo ảnh nền': { json: imageOk } } }))[0];
  ok(t2b.json.tier === 'template', 'caption AI nhắc số lượng tồn -> bị loại, dùng mẫu');
  const wrongPrice = { candidates: [{ content: { parts: [{ text: 'Bánh mì giảm sâu chỉ còn 9.000đ, lấy trước 21:30 hôm nay nhé cả nhà ơi #FoodSave' }] } }] };
  const t2c = (await runNode('merge-ai.js', { nodes: { 'Dựng yêu cầu AI': { json: req }, 'Gemini · viết caption': { json: wrongPrice }, 'Gemini · tạo ảnh nền': { json: imageOk } } }))[0];
  ok(t2c.json.tier === 'template', 'caption AI sai giá -> bị loại, dùng mẫu');
  const off = (await runNode('store-prepare.js', { input: payload('red', { ai: { enabled: false } }) }))[0].json;
  ok(off.useAi === false, 'Admin tắt AI Agent -> n8n dùng ngay caption mẫu');

  console.log('\n[3] Tắt n8n / sai N8N_WEBHOOK_URL -> bài lên qua backend (tầng 3)');
  const { __internals: m } = require('../dist/services/marketingService');
  const realFetch = global.fetch;
  const calls = [];
  const settings = { marketing_auto: true, facebook_page_id: '1309577678916167', facebook_page_name: 'Trang mẫu', channels: {} };
  const product = { id: 'x1', store_id: 's1', name: 'Bánh mì ngọt', description: '', image_url: 'https://example.com/a.jpg', image_urls: null, emoji: '🥖', category: 'bakery', food_group: 'cooked', price_cents: 12000, original_price_cents: 60000, label: 'red', stock_quantity: 5, is_active: true, expires_at: new Date(Date.now() + 3600e3).toISOString(), effective_deadline_at: new Date(Date.now() + 3600e3).toISOString(), stores: { id: 's1', name: 'Cửa hàng mẫu A', owner_id: 'o', address: '5 Lê Lợi', district: 'Quận 7' } };
  const content = m.buildMarketingContent(product);
  global.fetch = async (url) => { calls.push(String(url)); if (String(url).includes('graph.facebook.com')) return { ok: true, status: 200, text: async () => '' }; throw new Error('connect ECONNREFUSED'); };
  const direct = await m.publishFacebook(product, content, settings, 'auto', 'p-1', true);
  ok(direct.ok && direct.via === 'direct', 'n8n hỏng -> đăng trực tiếp qua token Fanpage', JSON.stringify(direct));
  ok(calls.some((u) => u.includes('graph.facebook.com') && u.includes('/photos')), 'đăng ảnh kèm caption lên đúng Fanpage của cửa hàng');
  global.fetch = async (url) => { calls.push(String(url)); return { ok: true, status: 200, text: async () => '' }; };
  const viaN8n = await m.publishFacebook(product, content, settings, 'auto', 'p-1', true);
  ok(viaN8n.ok && viaN8n.via === 'n8n', 'n8n bình thường -> đi qua n8n');
  global.fetch = async () => { throw new Error('mất mạng'); };
  const none = await m.publishFacebook(product, content, { ...settings, facebook_page_id: 'khong-co-token' }, 'auto', 'p-1', true);
  ok(!none.ok && /n8n|Chưa|mạng/i.test(none.error || ''), 'không có token dự phòng -> báo lỗi rõ ràng', none.error);
  global.fetch = realFetch;

  console.log('\n[4] Nhãn xanh không gọi AI; nhãn đỏ khác nhãn vàng về giọng điệu');
  const green = (await runNode('store-prepare.js', { input: payload('green') }))[0].json;
  ok(green.useAi === false, 'nhãn xanh: không gọi AI');
  const yellow = (await runNode('store-prepare.js', { input: payload('yellow') }))[0].json;
  ok(yellow.useAi === true && /nhẹ nhàng/.test(yellow.captionPrompt) && /KHẨN/.test(prep.captionPrompt) && prep.captionPrompt !== yellow.captionPrompt, 'đỏ: giọng KHẨN · vàng: giọng nhẹ nhàng');
  const remind = (await runNode('store-prepare.js', { input: payload('red', { variant: 'reminder' }) }))[0].json;
  ok(remind.useAi === false && remind.imageUrl === '', 'bài nhắc: dùng mẫu ngắn, không AI, không ảnh');
  const redTxt = m.buildMarketingContent({ ...product, label: 'red' }).facebook, yellowTxt = m.buildMarketingContent({ ...product, label: 'yellow' }).facebook;
  ok(redTxt !== yellowTxt && /GIẢI CỨU GẤP/.test(redTxt) && !/GIẢI CỨU GẤP/.test(yellowTxt), 'caption mẫu của backend: đỏ gấp hơn vàng');
  ok(!/còn \d+ phần/i.test(redTxt + yellowTxt), 'caption mẫu không nhắc số lượng');

  console.log('\n[5] Hai Fanpage nhận hai ảnh/bài khác nhau');
  const items = [
    { product_id: 'a', name: 'Bánh mì', store_name: 'Cửa hàng A', label: 'red', discount_percent: 80, price_vnd: 12000, original_price_vnd: 60000, deadline_text: '21:30 hôm nay', hours_left: 1.5, image_url: 'https://example.com/a.jpg' },
    { product_id: 'b', name: 'Cơm tấm', store_name: 'Cửa hàng B', label: 'yellow', discount_percent: 50, price_vnd: 25000, original_price_vnd: 50000, deadline_text: '20:00 hôm nay', hours_left: 4, image_url: null }
  ];
  const central = (await runNode('central-prepare.js', { nodes: { 'Lặp từng bài': { json: { post_log_id: 'c-1', ai: { enabled: true }, items, more_count: 2, message: 'MẪU TỔNG HỢP', link: 'https://example.com/', hero_image_url: 'https://example.com/a.jpg', page_id: 'DAN_MA_FANPAGE_FOODSAVE' } } } }))[0].json;
  ok(central.mode === 'store' ? false : central.mode === 'central', 'Fanpage trung tâm dùng bài tổng hợp');
  ok(central.overlay.title !== prep.overlay.title && central.captionPrompt !== prep.captionPrompt, 'nội dung và chữ trên ảnh khác bài của cửa hàng');
  ok(central.captionPrompt.includes('Cửa hàng A') && central.captionPrompt.includes('Cơm tấm') && central.mustContain.length === 2, 'bài tổng hợp liệt kê nhiều món + tên cửa hàng bán');
  ok(prep.pageId !== central.pageId, 'hai bài đi tới hai Fanpage khác nhau');
  const split = await runNode('central-split.js', { input: { data: { items: [{ post_log_id: 'c-1', items }], ai_enabled: true, page_id: 'p' } } });
  ok(split.length === 1 && split[0].json.ai.enabled === true, 'workflow trung tâm tách đúng từng bài từ danh sách FoodSave');

  console.log('\nKết quả: ' + pass + ' đạt, ' + fail + ' lỗi');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('Lỗi chạy kiểm thử:', e); process.exit(1); });
