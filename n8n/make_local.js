#!/usr/bin/env node
// Tạo bản "đã điền sẵn" của 2 workflow để import thẳng vào n8n:
//   n8n/workflow-1-kenh-foodsave-ai.local.json
//   n8n/workflow-2-cua-hang-ai.local.json
// Giá trị lấy từ file .env ở thư mục gốc (N8N_SECRET, FACEBOOK_PAGE_TOKENS, CENTRAL_PAGE_ID, PUBLIC_SITE_URL).
// File .local.json chứa token thật: đã nằm trong .gitignore, KHÔNG commit, KHÔNG gửi cho ai.
// Script không in token/secret ra màn hình, chỉ in tên biến thiếu và kết quả kiểm tra cú pháp.
// Dùng:  node n8n/make_local.js            (đọc .env)
//        node n8n/make_local.js duong/dan/.env   (đọc file .env khác, ví dụ để thử)
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const envPath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, '.env');
const DEFAULT_STORE_PAGE_ID = '1309577678916167'; // Fanpage mặc định của workflow cửa hàng

function readEnv(file) {
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').split('\n')) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

const env = readEnv(envPath);
const missing = [];
const need = (name) => { if (!env[name]) { missing.push(name); return ''; } return env[name]; };

const secret = need('N8N_SECRET');
const centralId = need('CENTRAL_PAGE_ID');
let tokens = {};
try { tokens = JSON.parse(need('FACEBOOK_PAGE_TOKENS') || '{}'); } catch (e) { console.error('FACEBOOK_PAGE_TOKENS trong .env không phải JSON hợp lệ.'); process.exit(1); }
if (typeof tokens !== 'object' || Array.isArray(tokens) || tokens === null) { console.error('FACEBOOK_PAGE_TOKENS phải là JSON dạng {"mã_trang":"token"}.'); process.exit(1); }
const centralToken = tokens[centralId] || '';
if (centralId && !centralToken) missing.push('token của CENTRAL_PAGE_ID trong FACEBOOK_PAGE_TOKENS');
if (!tokens[DEFAULT_STORE_PAGE_ID]) missing.push('token của trang ' + DEFAULT_STORE_PAGE_ID + ' trong FACEBOOK_PAGE_TOKENS');

let api = 'https://foodsavevn.netlify.app/api/v1';
try { const u = new URL(env.PUBLIC_SITE_URL || ''); if (u.protocol === 'https:') api = u.origin + '/api/v1'; } catch (e) { /* giữ mặc định */ }

if (missing.length) {
  console.error('Thiếu trong .env: ' + missing.join(', ') + '. Bổ sung rồi chạy lại (file .local.json chưa được tạo).');
  process.exit(1);
}

const lit = (s) => JSON.stringify(String(s)); // chuỗi JS hợp lệ, nháy khớp nhau
const tokensLiteral = '{\n' + Object.keys(tokens).map((k) => '    ' + lit(k) + ': ' + lit(tokens[k])).join(',\n') + '\n  }';

function fillCode(code) {
  let c = code;
  c = c.split("'DAN_N8N_SECRET_VAO_DAY'").join(lit(secret));
  c = c.replace(/API: '[^']*'/, () => 'API: ' + lit(api));
  c = c.replace("DEFAULT_PAGE_ID: 'DAN_MA_FANPAGE_MAC_DINH'", () => 'DEFAULT_PAGE_ID: ' + lit(DEFAULT_STORE_PAGE_ID));
  c = c.replace(/PAGE_TOKENS: \{[\s\S]*?\n  \},/, () => 'PAGE_TOKENS: ' + tokensLiteral + ',');
  c = c.replace("PAGE_ID: 'DAN_MA_FANPAGE_FOODSAVE'", () => 'PAGE_ID: ' + lit(centralId));
  c = c.replace("PAGE_TOKEN: 'DAN_TOKEN_VAO_DAY'", () => 'PAGE_TOKEN: ' + lit(centralToken));
  return c;
}

const files = ['workflow-1-kenh-foodsave-ai', 'workflow-2-cua-hang-ai'];
let bad = 0;
for (const name of files) {
  const src = path.join(__dirname, name + '.json');
  const wf = JSON.parse(fs.readFileSync(src, 'utf8'));
  const filled = [];
  for (const node of wf.nodes) {
    const code = node.parameters && node.parameters.jsCode;
    if (typeof code !== 'string') continue;
    const next = fillCode(code);
    if (next !== code) { node.parameters.jsCode = next; filled.push(node.name); }
    // Kiểm tra cú pháp: n8n bọc code trong hàm async nên cho phép await / return ở cấp cao nhất
    try { new vm.Script('(async function(){\n' + node.parameters.jsCode + '\n})'); } catch (e) { bad++; console.error('LỖI CÚ PHÁP ở node "' + node.name + '" (' + name + '): ' + e.message); }
    if (/DAN_(N8N_SECRET|MA_FANPAGE|TOKEN)[A-Z_]*/.test(node.parameters.jsCode)) console.warn('Còn chữ giữ chỗ chưa điền ở node "' + node.name + '" (' + name + ')');
  }
  const out = path.join(__dirname, name + '.local.json');
  fs.writeFileSync(out, JSON.stringify(wf, null, 2));
  console.log('Đã tạo ' + path.relative(ROOT, out) + ' | node đã điền: ' + (filled.join(', ') || '(không có)'));
}
if (bad) { console.error(bad + ' node có lỗi cú pháp.'); process.exit(1); }
console.log('Kiểm tra cú pháp JS của mọi node Code: đạt. Nhớ: file .local.json chứa token thật, không commit.');
