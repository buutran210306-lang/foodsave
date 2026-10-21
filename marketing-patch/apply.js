#!/usr/bin/env node
// Bản Node của apply.py (máy không có Python). Áp giao diện Marketing mới vào FOODSAVE_PARTNER.html (có backup).
// Dùng:  node marketing-patch/apply.js FOODSAVE_PARTNER.html
const fs = require('fs');
const path = require('path');

const target = process.argv[2];
if (!target) { console.error('Thiếu đường dẫn FOODSAVE_PARTNER.html'); process.exit(1); }
const raw = fs.readFileSync(target, 'utf8');
const crlf = raw.includes('\r\n');
const src = raw.replace(/\r\n/g, '\n');
if (src.includes('Marketing Studio v3')) { console.error('Đã áp patch rồi, không làm lại.'); process.exit(1); }
fs.writeFileSync(target + '.bak-truoc-marketing-v3', raw);

const js = fs.readFileSync(path.join(__dirname, 'pmkt-v2.js'), 'utf8').replace(/\r\n/g, '\n');
const css = fs.readFileSync(path.join(__dirname, 'pmkt-v2.css'), 'utf8').replace(/\r\n/g, '\n');
const lines = src.split('\n');
const start = lines.findIndex((l) => l.startsWith('let MKT={'));
const end = lines.findIndex((l) => l.startsWith('function pDona('));
if (start < 0 || end < 0 || end < start) { console.error('Không tìm thấy khối marketing trong file'); process.exit(1); }
const block = lines.slice(start, end);
const drop = new Set(['MKT', 'mktSetTab', 'pMkt', 'mktOverview', 'mktReport', 'mktConnPick', 'mktConnect', 'mktOpenStudio', 'mktRenderStudio', 'mktTab', 'mktPublish', 'mktKpis', 'mktExportCsv', 'mktQuickPush', 'mktSendList']);
const decl = /^(?:async function|function|const|let)\s+([A-Za-z0-9_]+)/;
const out = [];
let skip = false, inserted = false;
for (const l of block) {
  const m = decl.exec(l);
  if (m) {
    skip = drop.has(m[1]);
    if (skip && !inserted) { out.push('//__MKT_V3__'); inserted = true; }
  } else if (skip && l.startsWith('//')) skip = false;
  if (!skip) out.push(l);
}
let res = lines.slice(0, start).join('\n') + '\n' + out.join('\n').replace('//__MKT_V3__', () => js) + '\n' + lines.slice(end).join('\n');
const edits = [
  ['để nhắc người mua trong app và đăng lên các kênh đang dùng.', 'để đăng lên các nền tảng đang dùng.'],
  ['  const channels=mktSendList();\n', "  const channels=mktSendList();\n  if(!channels.length){tst('Chưa có nền tảng','Hãy bật ít nhất một nền tảng ở Thiết lập đăng bài','info');return;}\n"]
];
for (const [a, b] of edits) {
  if (!res.includes(a)) { console.error('Không tìm thấy đoạn cần sửa: ' + a.slice(0, 40)); process.exit(1); }
  res = res.replace(a, () => b);
}
res = res.replace('</style>', () => '\n' + css + '\n</style>');
fs.writeFileSync(target, crlf ? res.replace(/\n/g, '\r\n') : res);
console.log('Xong. Backup: ' + target + '.bak-truoc-marketing-v3');
