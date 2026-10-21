// Dựng yêu cầu gửi Gemini (caption + ảnh) và mã hóa ảnh gốc
const ctx = $('Chuẩn bị').first().json;
const item = $input.first();
let origB64 = '';
let mime = 'image/jpeg';
if (item.binary && item.binary.orig) {
  const buf = await this.helpers.getBinaryDataBuffer(0, 'orig');
  origB64 = buf.toString('base64');
  mime = item.binary.orig.mimeType || mime;
}
const captionRequest = {
  contents: [{ parts: [{ text: ctx.captionPrompt }] }],
  generationConfig: { temperature: 0.6, maxOutputTokens: 600 }
};
const imageParts = [{ text: ctx.imagePrompt }];
if (origB64) imageParts.unshift({ inline_data: { mime_type: mime, data: origB64 } });
const imageRequest = {
  contents: [{ parts: imageParts }],
  generationConfig: { responseModalities: ['IMAGE', 'TEXT'] }
};
return [{ json: { ...ctx, origB64, origMime: mime, captionRequest, imageRequest } }];
