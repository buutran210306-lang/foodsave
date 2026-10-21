// Tạo 2 workflow n8n "AI Agent đăng Facebook" để nhập (Import from file).  Chạy:  node n8n/build_workflows.js
//
// Cả hai file KHÔNG chứa token / secret thật, chỉ có chữ giữ chỗ (DAN_..._VAO_DAY). Key Gemini và mật khẩu FoodSave
// nằm trong Credentials của n8n (tên: "Gemini API key", "FoodSave n8n secret").
//
// 3 TẦNG (xem n8n/README.md):
//   1. AI    : Gemini viết caption (+ tạo ảnh nền) -> chèn chữ -> đăng ảnh kèm caption.
//   2. Mẫu   : AI lỗi / quá 20 giây / caption không đạt kiểm tra -> caption mẫu của FoodSave + ảnh gốc, vẫn đăng.
//   3. Direct: n8n không gọi được -> backend FoodSave tự đăng bằng FACEBOOK_PAGE_TOKENS (phía backend, không nằm ở đây).
const fs = require('fs');
const path = require('path');

const read = (name) => fs.readFileSync(path.join(__dirname, 'code', name), 'utf8').replace(/\r\n/g, '\n');

let seq = 0;
const nodes = [];
const connections = {};
const reset = () => { seq = 0; nodes.length = 0; Object.keys(connections).forEach((k) => delete connections[k]); };
const id = () => 'a1f0c0de-0000-4000-8000-' + String(++seq).padStart(12, '0');

const add = (name, type, typeVersion, parameters, position, extra = {}) => {
  nodes.push({ parameters, id: id(), name, type, typeVersion, position, ...extra });
  return name;
};
const link = (from, to, outputIndex = 0) => {
  connections[from] = connections[from] || { main: [] };
  while (connections[from].main.length <= outputIndex) connections[from].main.push([]);
  connections[from].main[outputIndex].push({ node: to, type: 'main', index: 0 });
};

const code = (name, file, position) => add(name, 'n8n-nodes-base.code', 2, { jsCode: read(file) }, position);
const ifTrue = (name, expr, position) => add(name, 'n8n-nodes-base.if', 2, {
  conditions: {
    options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
    conditions: [{ id: id(), leftValue: expr, rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }],
    combinator: 'and'
  },
  options: {}
}, position);

const geminiCred = { httpHeaderAuth: { id: 'DAN_ID_CREDENTIAL_GEMINI', name: 'Gemini API key' } };
const secretCred = { httpHeaderAuth: { id: 'DAN_ID_CREDENTIAL_FOODSAVE', name: 'FoodSave n8n secret' } };
const soft = { onError: 'continueRegularOutput' };

// ───── Phần dùng chung: từ "Chuẩn bị" tới "Báo kết quả về FoodSave"
const pipeline = (prepareName, x0, y0) => {
  const dl = add('Tải ảnh gốc', 'n8n-nodes-base.httpRequest', 4.2, {
    method: 'GET', url: '={{ $json.imageUrl }}',
    options: { timeout: 15000, response: { response: { responseFormat: 'file', outputPropertyName: 'orig' } } }
  }, [x0, y0], soft);
  const build = code('Dựng yêu cầu AI', 'build-ai-request.js', [x0 + 240, y0]);
  const useAi = ifTrue('Dùng AI?', '={{ $json.useAi }}', [x0 + 480, y0]);
  // Tầng 1: AI
  const cap = add('Gemini · viết caption', 'n8n-nodes-base.httpRequest', 4.2, {
    method: 'POST', url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
    authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
    sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify($json.captionRequest) }}',
    options: { timeout: 20000 }
  }, [x0 + 720, y0 - 120], { credentials: geminiCred, ...soft });
  const img = add('Gemini · tạo ảnh nền', 'n8n-nodes-base.httpRequest', 4.2, {
    method: 'POST', url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent',
    authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
    sendBody: true, specifyBody: 'json', jsonBody: "={{ JSON.stringify($('Dựng yêu cầu AI').first().json.imageRequest) }}",
    options: { timeout: 20000 }
  }, [x0 + 960, y0 - 120], { credentials: geminiCred, ...soft });
  const merge = code('Gộp kết quả AI', 'merge-ai.js', [x0 + 1200, y0 - 120]);
  // Tầng 2: mẫu
  const tpl = code('Dùng caption mẫu', 'template-caption.js', [x0 + 720, y0 + 120]);
  // Chèn chữ (chỉ khi tầng AI có ảnh AI)
  const needText = ifTrue('Chèn chữ?', '={{ $json.tier === "ai" && $json.aiImage && $json.overlayEnabled }}', [x0 + 1440, y0]);
  const overlay = add('Chèn chữ lên ảnh', 'n8n-nodes-base.editImage', 1, {
    operation: 'multiStep',
    operations: {
      operations: [
        { operation: 'resize', width: 1080, height: 1080, resizeOption: 'ignoreAspectRatio' },
        { operation: 'draw', primitive: 'rectangle', color: '#10281c', startPositionX: 0, startPositionY: 850, endPositionX: 1080, endPositionY: 1080, cornerRadius: 0 },
        { operation: 'text', text: "={{ $('Gộp kết quả AI').first().json.overlay.title }}", fontSize: 46, fontColor: '#ffffff', positionX: 48, positionY: 80, lineLength: 30 },
        { operation: 'text', text: "={{ $('Gộp kết quả AI').first().json.overlay.badge }}", fontSize: 96, fontColor: '#fde047', positionX: 48, positionY: 200, lineLength: 20 },
        { operation: 'text', text: "={{ $('Gộp kết quả AI').first().json.overlay.line1 }}", fontSize: 54, fontColor: '#ffffff', positionX: 48, positionY: 930, lineLength: 38 },
        { operation: 'text', text: "={{ $('Gộp kết quả AI').first().json.overlay.line2 }}", fontSize: 38, fontColor: '#d1fae5', positionX: 48, positionY: 1020, lineLength: 48 }
      ]
    },
    dataPropertyName: 'data', options: {}
  }, [x0 + 1680, y0 - 120], soft);
  const finalize = code('Chốt ảnh', 'finalize-image.js', [x0 + 1920, y0]);
  // Đăng Facebook
  const hasImg = ifTrue('Có ảnh?', '={{ $json.hasImage }}', [x0 + 2160, y0]);
  const photo = add('Đăng ảnh lên Fanpage', 'n8n-nodes-base.httpRequest', 4.2, {
    method: 'POST', url: "={{ 'https://graph.facebook.com/v21.0/' + $json.pageId + '/photos' }}",
    sendBody: true, contentType: 'multipart-form-data',
    bodyParameters: {
      parameters: [
        { parameterType: 'formBinaryData', name: 'source', inputDataFieldName: 'data' },
        { name: 'caption', value: '={{ $json.caption }}' },
        { name: 'access_token', value: '={{ $json.pageToken }}' }
      ]
    },
    options: { timeout: 30000 }
  }, [x0 + 2400, y0 - 100], soft);
  const photoOk = ifTrue('Đăng ảnh thành công?', '={{ !!$json.id }}', [x0 + 2640, y0 - 100]);
  const text = add('Đăng chữ lên Fanpage', 'n8n-nodes-base.httpRequest', 4.2, {
    method: 'POST', url: "={{ 'https://graph.facebook.com/v21.0/' + $('Chốt ảnh').first().json.pageId + '/feed' }}",
    sendBody: true, specifyBody: 'json',
    jsonBody: "={{ JSON.stringify({ message: $('Chốt ảnh').first().json.caption, access_token: $('Chốt ảnh').first().json.pageToken }) }}",
    options: { timeout: 30000 }
  }, [x0 + 2880, y0 + 80], soft);
  const report = code('Chuẩn bị báo cáo', 'build-report.js', [x0 + 3120, y0]);
  const callback = add('Báo kết quả về FoodSave', 'n8n-nodes-base.httpRequest', 4.2, {
    method: 'POST', url: '={{ $json.callbackUrl }}',
    authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
    sendBody: true, specifyBody: 'json',
    jsonBody: '={{ JSON.stringify({ post_log_id: $json.post_log_id, status: $json.status, tier: $json.tier, external_id: $json.external_id || undefined, external_url: $json.external_url || undefined, error: $json.error || undefined }) }}',
    options: { timeout: 10000 }
  }, [x0 + 3360, y0], { credentials: secretCred, ...soft });

  link(prepareName, dl); link(dl, build); link(build, useAi);
  link(useAi, cap, 0); link(cap, img); link(img, merge); link(merge, needText);
  link(useAi, tpl, 1); link(tpl, needText);
  link(needText, overlay, 0); link(overlay, finalize);
  link(needText, finalize, 1);
  link(finalize, hasImg);
  link(hasImg, photo, 0); link(photo, photoOk);
  link(photoOk, report, 0);
  link(photoOk, text, 1); link(hasImg, text, 1); link(text, report);
  link(report, callback);
  return { callback };
};

// ───── Workflow 2: Fanpage CỦA CỬA HÀNG (webhook foodsave-promote)
reset();
const wh = add('Nhận lệnh từ FoodSave', 'n8n-nodes-base.webhook', 2, { httpMethod: 'POST', path: 'foodsave-promote', responseMode: 'responseNode', options: {} }, [0, 0], { webhookId: 'foodsave-promote-webhook' });
const respond = add('Trả lời ngay', 'n8n-nodes-base.respondToWebhook', 1.1, { respondWith: 'json', responseBody: '={{ { "accepted": true } }}', options: { responseCode: 200 } }, [240, -140]);
const prepare = code('Chuẩn bị', 'store-prepare.js', [240, 40]);
link(wh, respond); link(wh, prepare);
pipeline(prepare, 480, 40);
const wf2 = {
  name: 'FoodSave · Fanpage cửa hàng · AI đăng bài (3 tầng)',
  nodes: JSON.parse(JSON.stringify(nodes)), connections: JSON.parse(JSON.stringify(connections)),
  active: false, settings: { executionOrder: 'v1' },
  pinData: {}, meta: { templateCredsSetupCompleted: false }
};

// ───── Workflow 1: Fanpage TRUNG TÂM FoodSave (bài tổng hợp)
reset();
const sched = add('Mỗi 30 phút', 'n8n-nodes-base.scheduleTrigger', 1.2, { rule: { interval: [{ field: 'minutes', minutesInterval: 30 }] } }, [0, 0]);
const feed = add('Lấy bài tổng hợp từ FoodSave', 'n8n-nodes-base.httpRequest', 4.2, {
  method: 'GET', url: 'https://DAN_TEN_MIEN_NETLIFY.netlify.app/api/v1/marketing/feed',
  authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth', options: { timeout: 15000 }
}, [240, 0], { credentials: secretCred });
const whc = add('Nhận lệnh chạy thử', 'n8n-nodes-base.webhook', 2, { httpMethod: 'POST', path: 'foodsave-central', responseMode: 'responseNode', options: {} }, [0, 200], { webhookId: 'foodsave-central-webhook' });
const respondC = add('Trả lời ngay', 'n8n-nodes-base.respondToWebhook', 1.1, { respondWith: 'json', responseBody: '={{ { "accepted": true } }}', options: { responseCode: 200 } }, [240, 300]);
const split = code('Tách từng bài', 'central-split.js', [480, 100]);
const loop = add('Lặp từng bài', 'n8n-nodes-base.splitInBatches', 3, { batchSize: 1, options: {} }, [720, 100]);
const prepareC = code('Chuẩn bị', 'central-prepare.js', [960, 100]);
link(sched, feed); link(feed, split); link(whc, respondC); link(whc, split); link(split, loop);
link(loop, prepareC, 1);
const { callback } = pipeline(prepareC, 1200, 100);
link(callback, loop);
const wf1 = {
  name: 'FoodSave · Fanpage FoodSave · AI đăng bài tổng hợp (3 tầng)',
  nodes: JSON.parse(JSON.stringify(nodes)), connections: JSON.parse(JSON.stringify(connections)),
  active: false, settings: { executionOrder: 'v1' },
  pinData: {}, meta: { templateCredsSetupCompleted: false }
};

fs.writeFileSync(path.join(__dirname, 'workflow-2-cua-hang-ai.json'), JSON.stringify(wf2, null, 2));
fs.writeFileSync(path.join(__dirname, 'workflow-1-kenh-foodsave-ai.json'), JSON.stringify(wf1, null, 2));
console.log('ok:', wf2.nodes.length, 'node (cửa hàng),', wf1.nodes.length, 'node (FoodSave)');
