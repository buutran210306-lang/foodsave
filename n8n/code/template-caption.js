// Tầng 2 (mẫu): dùng caption mẫu của FoodSave + ảnh gốc, không gọi AI
const ctx = $('Dựng yêu cầu AI').first().json;
const out = { json: { ...ctx, caption: ctx.fallbackCaption, tier: 'template', aiImage: false, imgB64: ctx.origB64 || '', imgMime: ctx.origMime || 'image/jpeg' } };
delete out.json.origB64; delete out.json.captionRequest; delete out.json.imageRequest;
if (ctx.origB64) {
  out.binary = { data: await this.helpers.prepareBinaryData(Buffer.from(ctx.origB64, 'base64'), 'goc.jpg', ctx.origMime || 'image/jpeg') };
}
return [out];
