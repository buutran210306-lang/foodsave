// Gom kết quả đăng Facebook để báo về FoodSave
const c = $('Chốt ảnh').first().json;
const photo = $('Đăng ảnh lên Fanpage').isExecuted ? $('Đăng ảnh lên Fanpage').first().json : null;
const text = $('Đăng chữ lên Fanpage').isExecuted ? $('Đăng chữ lên Fanpage').first().json : null;
const res = text && text.id ? text : (photo && photo.id ? photo : null);
const ok = Boolean(res);
const pick = (r) => (r && r.error ? (r.error.message || JSON.stringify(r.error)) : '');
const error = ok ? '' : String(pick(text) || pick(photo) || 'Facebook từ chối bài đăng').slice(0, 400);
const id = ok ? String(res.post_id || res.id) : '';
return [{
  json: {
    post_log_id: c.postLogId,
    callbackUrl: c.callbackUrl,
    status: ok ? 'posted' : 'failed',
    tier: c.tier,
    external_id: id,
    external_url: ok ? 'https://www.facebook.com/' + id : '',
    error
  }
}];
