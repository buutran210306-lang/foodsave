// Chốt ảnh cuối cùng. Nếu bước chèn chữ lỗi (mất ảnh) thì dùng lại ảnh trước khi chèn chữ.
const src = $('Gộp kết quả AI').isExecuted ? $('Gộp kết quả AI').first().json : $('Dùng caption mẫu').first().json;
const item = $input.first();
const json = { ...src };
const b64 = json.imgB64;
delete json.imgB64;
let bin = item.binary && item.binary.data ? item.binary.data : null;
if (!bin && b64) {
  bin = await this.helpers.prepareBinaryData(Buffer.from(b64, 'base64'), 'poster.png', json.imgMime || 'image/png');
}
json.hasImage = Boolean(bin);
const out = { json };
if (bin) out.binary = { data: bin };
return [out];
