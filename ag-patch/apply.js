// Áp dụng giao diện AI Agent (Admin) v2 vào ADMIN_FOODSAVE.html
// Dùng:  node ag-patch/apply.js            (mặc định sửa ../ADMIN_FOODSAVE.html)
//        node ag-patch/apply.js <đường-dẫn-file.html>
// An toàn: tự sao lưu, kiểm tra từng vị trí trước khi sửa, kiểm tra cú pháp sau khi sửa, lỗi thì không ghi gì.
const fs = require('fs'), path = require('path'), vm = require('vm');
const target = path.resolve(process.argv[2] || path.join(__dirname, '..', 'ADMIN_FOODSAVE.html'));
const js = fs.readFileSync(path.join(__dirname, 'ag-v2.js'), 'utf8').replace(/\r\n/g, '\n').trimEnd();
const css = fs.readFileSync(path.join(__dirname, 'ag-v2.css'), 'utf8').replace(/\r\n/g, '\n').trimEnd();
const src = fs.readFileSync(target, 'utf8');
const nl = src.includes('\r\n') ? '\r\n' : '\n';
const lines = src.split(/\r?\n/);
const die = (m) => { console.error('DỪNG, chưa sửa gì: ' + m); process.exit(1); };

if (src.includes("const AG_CK='fs_ag_ov_v2'")) die('File này đã được áp dụng bản v2 rồi.');

// [dòng đầu, dòng cuối, đầu dòng đầu phải khớp, dòng cuối phải khớp]  (số dòng tính từ 1)
const cuts = [
  [1383, 1383, 'const AG={tab:', 'const AG={tab:'],                  // thay bằng khối mới
  [1396, 1410, 'function agRefreshPage(', 'function agStartTimer('],
  [1424, 1438, 'pg.agent=()=>{', 'function agTab('],
  [1441, 1467, 'function agOverview(d){', '}'],
  [1470, 1486, 'function agQueue(d){', '}'],
  [1495, 1503, 'function agPreviewHtml(d){', '}'],
  [1513, 1531, 'function agHistRows(d){', '}'],
  [1544, 1548, 'function agExportCsv(){', '}'],
  [1557, 1557, 'function agSelPl(', 'function agSelPl('],
  [1563, 1593, 'function agSettings(d){', '}'],
];
for (const [a, b, s, e] of cuts) {
  if (!(lines[a - 1] || '').startsWith(s)) die('dòng ' + a + ' không khớp "' + s + '" (file đã bị sửa so với bản dự kiến).');
  const last = (lines[b - 1] || '').trim();
  if (!(e === '}' ? last === '}' : last.startsWith(e))) die('dòng ' + b + ' không khớp kết thúc "' + e + '".');
}
if (!lines[309].startsWith('.ag-empty{')) die('không tìm thấy vị trí chèn CSS (dòng 310).');
const iInit = lines.findIndex((l) => l.startsWith('function initAdminSupabaseSync(){'));
if (iInit < 0 || lines[iInit + 1].trim() !== "go('dashboard');") die('không tìm thấy initAdminSupabaseSync.');
const iLock = lines.findIndex((l) => l.startsWith('function lockAdmin(message){'));
if (iLock < 0) die('không tìm thấy lockAdmin.');

const del = new Set();
for (const [a, b] of cuts) for (let n = a; n <= b; n++) del.add(n);
const out = [];
lines.forEach((l, idx) => {
  const n = idx + 1;
  if (n === 1383) { out.push(...js.split('\n')); return; }
  if (del.has(n)) return;
  out.push(l);
  if (n === 310) out.push(...css.split('\n'));
  if (idx === iInit + 1) out.push('agLoad(true); // tải sẵn AI Agent ngay khi đăng nhập để mở trang là có dữ liệu');
  if (idx === iLock) out.push("try{localStorage.removeItem('fs_ag_ov_v2');}catch(e){}");
});
const result = out.join(nl);

// kiểm tra cú pháp mọi khối <script> inline
const scripts = [...result.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
if (!scripts.some((s) => s.includes('AI AGENT ĐĂNG BÀI'))) die('không thấy khối script AI Agent sau khi sửa.');
for (const s of scripts) { try { new vm.Script(s); } catch (e) { die('lỗi cú pháp JS sau khi sửa: ' + e.message); } }

const bak = target + '.bak-truoc-ag-v2';
if (!fs.existsSync(bak)) fs.copyFileSync(target, bak);
fs.writeFileSync(target, result);
console.log('Đã áp dụng AI Agent v2 vào ' + path.basename(target) + ' (bản sao lưu: ' + path.basename(bak) + ').');
