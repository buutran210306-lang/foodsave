// Tầng 1 (AI): kiểm tra kết quả Gemini. Không đạt thì dùng caption mẫu (tầng 2). Ảnh AI chỉ dùng khi caption AI đạt.
const ctx = $('Dựng yêu cầu AI').first().json;
const capRes = $('Gemini · viết caption').first().json || {};
const imgRes = $('Gemini · tạo ảnh nền').first().json || {};

let caption = '';
let tier = 'template';
try {
  const text = capRes.candidates[0].content.parts.map((p) => p.text || '').join('').trim();
  const stockMention = /còn\s+\d+\s*(phần|suất|sản phẩm|món|cái|hộp)/i.test(text);
  const fakeTag = /minh\s*h[oọ]a/i.test(text);
  const hasNumbers = (ctx.mustContain || []).every((x) => text.includes(x));
  if (text.length > 30 && hasNumbers && !stockMention && !fakeTag) {
    caption = text;
    tier = 'ai';
  }
} catch (e) { /* dùng caption mẫu */ }
if (!caption) caption = ctx.fallbackCaption;
if (tier === 'ai' && ctx.link && !caption.includes(ctx.link)) caption += `\n👉 ${ctx.link}`;

let imgB64 = ctx.origB64 || '';
let mime = ctx.origMime || 'image/jpeg';
let aiImage = false;
if (tier === 'ai') {
  try {
    const parts = imgRes.candidates[0].content.parts;
    const part = parts.find((p) => p.inlineData || p.inline_data);
    const data = part && (part.inlineData || part.inline_data);
    if (data && data.data) { imgB64 = data.data; mime = data.mimeType || data.mime_type || 'image/png'; aiImage = true; }
  } catch (e) { /* giữ ảnh gốc */ }
}

const out = { json: { ...ctx, caption, tier, aiImage, imgB64, imgMime: mime } };
delete out.json.origB64; delete out.json.captionRequest; delete out.json.imageRequest;
if (imgB64) {
  out.binary = { data: await this.helpers.prepareBinaryData(Buffer.from(imgB64, 'base64'), aiImage ? 'poster.png' : 'goc.jpg', mime) };
}
return [out];
