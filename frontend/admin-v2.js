/* ═════════ FOODSAVE ADMIN · UI v2 (Đợt 1) ═════════
   Lớp bổ sung đặt SAU mã cũ, không sửa hàm cũ. Chỉ gồm phần đã nối API thật:
   - Chính sách nhãn & đơn hàng (CHỈ ĐỌC): GET /admin/order-policy (nguồn duy nhất: src/constants/orderPolicy.ts)
   - Tự động hóa đơn hàng: nút chạy tay POST /admin/order-automation/run
   - Uy tín: bảng khách bị khóa mua hàng + nút Mở khóa: POST /admin/customers/:id/unlock
   - Trung tâm khiếu nại + Tranh chấp (Đợt 3): GET /admin/complaints, POST /admin/complaints/:id/decision, GET /orders/:id/messages (chat, chỉ đọc)
   - Tài chính · Sổ cái (Đợt 2): GET /admin/finance/summary, /admin/ledger, /admin/withdrawals, PATCH /admin/withdrawals/:id, POST /admin/finance/reconcile
   Đợt 4b (cuối file): chính sách chỉnh được, nhật ký tác vụ, nhãn, xác minh, voucher, ESG, gian lận, uy tín, dashboard, nhật ký hoạt động.   */
(function () {
  'use strict';
  if (typeof pg === 'undefined' || typeof go !== 'function') return;

  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  function toast(m) { var t = document.createElement('div'); t.className = 'v2toast'; t.textContent = m; document.body.appendChild(t); setTimeout(function () { t.remove(); }, 3200); }
  var K = function (l, v, n, c) { return '<div class="K"><div class="K-l">' + l + '</div><div class="K-v" style="color:' + (c || 'var(--text)') + '">' + v + '</div><div class="K-n">' + (n || '') + '</div></div>'; };
  var Pn = function (t, body, act) { return '<div class="P"><div class="P-h"><div class="P-t">' + t + '</div><div class="P-a">' + (act || '') + '</div></div>' + body + '</div>'; };
  var Tb = function (h, rows) { return '<div class="W"><table><thead><tr>' + h.map(function (x) { return '<th>' + x + '</th>'; }).join('') + '</tr></thead><tbody>' + rows + '</tbody></table></div>'; };
  var note = function (h) { return '<div class="v2note">' + h + '</div>'; };

  async function api(path, opt) {
    var s = await foodsaveAdminSupabase.auth.getSession();
    var token = s && s.data && s.data.session && s.data.session.access_token;
    if (!token) throw new Error('Phiên đăng nhập đã hết hạn.');
    var res = await fetch(adminApiBaseUrl() + path, {
      method: (opt && opt.method) || 'GET',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: opt && opt.body ? JSON.stringify(opt.body) : undefined
    });
    var payload = await res.json().catch(function () { return null; });
    if (!res.ok || !payload || !payload.success) throw new Error((payload && payload.error && payload.error.message) || 'Máy chủ báo lỗi.');
    return payload.data;
  }
  function rerender(page) { if (currentPage === page) document.getElementById('ct').innerHTML = '<div class="page">' + pg[page]() + '</div>'; }

  /* ---------- tiêu đề + điều hướng ---------- */
  Object.assign(titles, { policy: 'Chính sách nhãn & đơn hàng', automation: 'Tự động hóa đơn hàng', finance: 'Tài chính · Sổ cái', hub: 'Trung tâm khiếu nại' });
  (function () {
    var nav = document.querySelector('.S-n'); if (!nav) return;
    var anchor = nav.querySelector('.S-i[data-p="config"]');
    [['policy', 'Chính sách nhãn & đơn'], ['automation', 'Tự động hóa đơn hàng']].forEach(function (x) {
      if (nav.querySelector('.S-i[data-p="' + x[0] + '"]')) return;
      var d = document.createElement('div'); d.className = 'S-i'; d.dataset.p = x[0]; d.textContent = x[1];
      d.addEventListener('click', function () { go(x[0]); });
      nav.insertBefore(d, anchor || null);
    });
    if (!nav.querySelector('.S-i[data-p="hub"]')) {
      var hubItem = document.createElement('div'); hubItem.className = 'S-i'; hubItem.dataset.p = 'hub'; hubItem.innerHTML = 'Trung tâm khiếu nại <em id="hubBadge"></em>';
      hubItem.addEventListener('click', function () { go('hub'); });
      var disp = nav.querySelector('.S-i[data-p="disputes"]');
      if (disp) nav.insertBefore(hubItem, disp); else nav.insertBefore(hubItem, anchor || null);
    }
    if (!nav.querySelector('.S-i[data-p="finance"]')) {
      var fin = document.createElement('div'); fin.className = 'S-i'; fin.dataset.p = 'finance'; fin.textContent = 'Tài chính · Sổ cái';
      fin.addEventListener('click', function () { go('finance'); });
      var after = nav.querySelector('.S-i[data-p="payouts"]');
      if (after && after.nextSibling) nav.insertBefore(fin, after.nextSibling); else nav.insertBefore(fin, anchor || null);
    }
  })();

  /* ---------- Chính sách (chỉ đọc) ---------- */
  var POL = { data: null, loading: false, err: '' };
  function loadPolicy() {
    if (POL.loading) return; POL.loading = true; POL.err = '';
    api('/admin/order-policy').then(function (d) { POL.data = d; }).catch(function (e) { POL.err = e.message || 'Không tải được chính sách.'; })
      .then(function () { POL.loading = false; rerender('policy'); });
  }
  pg.policy = function () {
    if (!POL.data && !POL.loading && !POL.err) loadPolicy();
    if (POL.err) return Pn('Chính sách nhãn và đơn hàng', '<div class="W" style="padding:14px;color:var(--t3)">' + esc(POL.err) + ' <button class="bt" onclick="POL_RETRY()">Thử lại</button></div>');
    if (!POL.data) return Pn('Chính sách nhãn và đơn hàng', '<div class="W" style="padding:14px;color:var(--t3)">Đang tải chính sách...</div>');
    var d = POL.data, L = d.labels;
    var rows = [['Xanh', 'Còn hạn dài', '−20%', 'green', 'ok'], ['Vàng', 'Cận hạn', '−50%', 'yellow', 'w'], ['Đỏ', 'Sắp hết hạn', '−80%', 'red', 'e']].map(function (r) {
      var p = L[r[3]];
      return '<tr><td><span class="b b-' + r[4] + '">' + r[0] + '</span></td><td>' + r[1] + '</td><td class="mn">' + r[2] + '</td><td>' + p.payMinutes + ' phút</td><td>' + p.pickupMinutes + ' phút</td><td>' + p.cancelFreeBeforePickupMinutes + ' phút</td><td>' + p.finalReminderMinutes + ' phút</td></tr>';
    }).join('');
    var rep = d.reputation;
    var pts = [['Người mua nhận hàng thành công', '+' + rep.pickupSuccessDelta], ['Người mua vắng mặt (no-show)', String(rep.noShowDelta)], ['Hủy muộn (sau thời gian miễn phí)', String(rep.lateCancelDelta)], ['Khiếu nại sai sự thật', String(rep.falseComplaintDelta)], ['Cửa hàng giao thành công', '+5'], ['Cửa hàng hủy / hết hàng ảo', '−15'], ['Khiếu nại đúng (cửa hàng)', '−15']];
    var scaleNote = d.time_scale !== 1 ? note('<b>Đang bật chế độ rút ngắn thời gian ×' + d.time_scale + '</b> (DEMO_MODE). Mọi hạn ở bảng trên được nhân hệ số này. Môi trường thật luôn là 1.') : '';
    return note('<b>Chỉ đọc.</b> Giá trị lấy từ máy chủ (tệp <code>src/constants/orderPolicy.ts</code>). Màn chỉnh sửa trực tiếp sẽ được thêm ở Đợt 4.') + scaleNote +
      '<div class="G G3">' + K('Hủy miễn phí cực ngắn', d.grace_cancel_minutes + ' phút', 'Sau khi thanh toán · mọi nhãn') + K('Phí nền tảng', Number(d.platform_fee).toLocaleString('vi-VN') + 'đ/đơn', 'Khi tiền được giải ngân') + K('Thời gian tối thiểu', d.min_pickup_window_minutes + ' phút', 'Còn lại tới HSD mới cho đặt', 'var(--warn)') + '</div>' +
      Pn('Thời hạn theo nhãn', Tb(['Nhãn', 'Ý nghĩa', 'Giảm giá', 'Hạn thanh toán', 'Hạn lấy hàng', 'Hủy miễn phí trước hạn lấy', 'Nhắc cuối còn'], rows)) +
      '<div class="G G2">' + Pn('Điểm uy tín', Tb(['Hành vi', 'Điểm'], pts.map(function (p) { return '<tr><td>' + p[0] + '</td><td class="mn" style="color:' + (p[1].charAt(0) === '+' ? 'var(--ok)' : 'var(--err)') + '">' + p[1] + '</td></tr>'; }).join(''))) +
      Pn('Quy tắc hạn chế', note('• <b>Điểm &lt; ' + rep.blockedBelow + '</b>: chặn đặt hàng.<br>• <b>' + d.no_show_ban_count + ' lần vắng mặt / ' + d.no_show_window_days + ' ngày</b>: khóa mua nhãn đỏ ' + d.red_ban_days + ' ngày; cảnh báo ở lần thứ ' + (d.no_show_ban_count - 1) + '.<br>• <b>Hạn lấy hàng</b> = nhỏ nhất giữa (giờ thanh toán + thời hạn nhãn) và hạn sử dụng sản phẩm.<br>• <b>Hủy sớm</b> hoàn 100%; hủy muộn / vắng mặt: không hoàn, tiền chuyển cho cửa hàng (trừ phí).<br>• Hàng chỉ tự trả về kho khi còn ≥ ' + d.min_pickup_window_minutes + ' phút tới hạn sử dụng và sản phẩm không bị chặn.')) + '</div>';
  };
  window.POL_RETRY = function () { POL.err = ''; POL.data = null; rerender('policy'); };

  /* ---------- Tự động hóa đơn hàng ---------- */
  var AUTO = { running: false, result: null, err: '' };
  window.runOrderAutomation = function () {
    if (AUTO.running) return; AUTO.running = true; AUTO.err = ''; rerender('automation');
    api('/admin/order-automation/run', { method: 'POST' }).then(function (r) { AUTO.result = r; toast('Đã chạy tác vụ đơn hàng'); })
      .catch(function (e) { AUTO.err = e.message || 'Chạy tác vụ thất bại.'; })
      .then(function () { AUTO.running = false; rerender('automation'); });
  };
  pg.automation = function () {
    var r = AUTO.result;
    var out = '';
    if (AUTO.err) out += '<div class="v2note" style="border-color:#f1b0ab;background:#fdf1f0">' + esc(AUTO.err) + '</div>';
    if (r) {
      out += '<div class="G G4">' + K('Đơn quá hạn thanh toán', r.payment_timeouts, 'Đã hủy, hàng về kho', 'var(--warn)') + K('Đơn vắng mặt', r.no_shows, 'Quá hạn lấy hàng', 'var(--err)') + K('Nhắc giữa chừng', r.reminders_mid, 'Thông báo đã gửi') + K('Nhắc cuối', r.reminders_final, 'Thông báo đã gửi') + '</div>' +
        note('Chạy lúc ' + new Date(r.checked_at).toLocaleString('vi-VN') + ' · dọn chat cũ: ' + r.chat_purged + ' tin' + (r.errors && r.errors.length ? '<br><b style="color:var(--err)">Lỗi:</b> ' + r.errors.map(esc).join('; ') : ' · không có lỗi'));
    }
    return Pn('Tác vụ đơn hàng (order-automation)',
      '<div class="v2note">Tác vụ này tự chạy <b>mỗi 5 phút</b> trên Netlify (Scheduled Function). Khi chạy máy cá nhân hoặc khi thử nghiệm, bấm nút để chạy ngay: hủy đơn quá hạn thanh toán, đánh dấu khách vắng mặt, gửi nhắc lấy hàng, dọn chat quá 30 ngày.</div>' + out,
      '<button class="bt bt-p" ' + (AUTO.running ? 'disabled' : '') + ' onclick="runOrderAutomation()">' + (AUTO.running ? 'Đang chạy...' : 'Chạy tác vụ đơn hàng ngay') + '</button>');
  };

  /* ---------- Uy tín: khách bị khóa mua hàng ---------- */
  var LOCK = { rows: null, loading: false, err: '' };
  function loadLocked() {
    if (LOCK.loading) return; LOCK.loading = true; LOCK.err = '';
    api('/admin/users').then(function (d) {
      var now = Date.now();
      LOCK.rows = (d.buyers || []).filter(function (b) { return Number(b.points) < 40 || (b.red_ban_until && new Date(b.red_ban_until).getTime() > now); });
    }).catch(function (e) { LOCK.err = e.message || 'Không tải được danh sách.'; })
      .then(function () { LOCK.loading = false; rerender('reputation'); });
  }
  function lockedBlock() {
    var head = '<div class="P-h"><div class="P-t">Khách bị hạn chế mua hàng</div><div class="P-a"><button class="bt bt-s" onclick="LOCK_RELOAD()">Tải lại</button></div></div>';
    if (LOCK.loading && !LOCK.rows) return '<div class="P">' + head + '<div class="W" style="padding:14px;color:var(--t3)">Đang tải...</div></div>';
    if (LOCK.err) return '<div class="P">' + head + '<div class="W" style="padding:14px;color:var(--t3)">' + esc(LOCK.err) + '</div></div>';
    if (!LOCK.rows || !LOCK.rows.length) return '<div class="P">' + head + '<div class="W" style="padding:14px;color:var(--t3)">Không có khách nào đang bị chặn hoặc khóa nhãn đỏ.</div></div>';
    var rows = LOCK.rows.map(function (b) {
      var banned = b.red_ban_until && new Date(b.red_ban_until).getTime() > Date.now();
      return '<tr><td>' + esc(b.full_name || '(chưa đặt tên)') + '</td><td>' + esc(b.email || '—') + '</td><td class="mn">' + esc(b.points) + '</td><td>' + esc(b.rank || '') + '</td><td>' + (banned ? 'Khóa nhãn đỏ đến ' + new Date(b.red_ban_until).toLocaleDateString('vi-VN') : (Number(b.points) < 40 ? 'Điểm dưới 40: chặn đặt hàng' : '')) + '</td><td><button class="bt bt-s" onclick="unlockCustomer(\'' + esc(b.id) + '\')">Mở khóa</button></td></tr>';
    }).join('');
    return '<div class="P">' + head + Tb(['Khách', 'Email', 'Điểm', 'Hạng', 'Tình trạng', ''], rows) + '</div>';
  }
  window.LOCK_RELOAD = function () { LOCK.rows = null; LOCK.err = ''; rerender('reputation'); };
  window.unlockCustomer = function (id) {
    var n = prompt('Ghi chú mở khóa (tùy chọn). Điểm dưới 40 sẽ được nâng lên 40 để đặt hàng lại được:');
    if (n === null) return;
    api('/admin/customers/' + encodeURIComponent(id) + '/unlock', { method: 'POST', body: n.trim() ? { note: n.trim() } : {} })
      .then(function () { toast('Đã mở khóa cho khách'); LOCK.rows = null; rerender('reputation'); })
      .catch(function (e) { toast(e.message || 'Không mở khóa được'); });
  };

  /* ---------- Tài chính · Sổ cái (GET /admin/finance/summary, /admin/ledger, /admin/withdrawals) ---------- */
  var vnd = function (n) { return Number(n || 0).toLocaleString('vi-VN') + 'đ'; };
  var FIN = { summary: null, wd: null, acc: null, ledger: null, loading: false, err: '', rec: null, recBusy: false, f: { type: '', order: '', from: '', to: '', page: 1 } };
  var ENTRY_TYPE = { charge: 'Thu tiền khách', release: 'Giải ngân', refund: 'Hoàn tiền', refund_clawback: 'Thu hồi sau giải ngân', withdraw: 'Rút tiền', adjustment: 'Điều chỉnh' };
  var REASON = { completed: 'Hoàn tất', late_cancel: 'Hủy muộn', no_show: 'Vắng mặt', complaint_upheld: 'Khiếu nại đúng', complaint_partial: 'Khiếu nại (một phần)' };
  function ledgerQuery() {
    var q = ['page=' + FIN.f.page, 'limit=25'];
    if (FIN.f.type) q.push('type=' + encodeURIComponent(FIN.f.type));
    if (FIN.f.order) q.push('order_number=' + encodeURIComponent(FIN.f.order));
    if (FIN.f.from) q.push('from=' + encodeURIComponent(new Date(FIN.f.from + 'T00:00:00').toISOString()));
    if (FIN.f.to) q.push('to=' + encodeURIComponent(new Date(FIN.f.to + 'T23:59:59').toISOString()));
    return q.join('&');
  }
  function loadFinance() {
    if (FIN.loading) return; FIN.loading = true; FIN.err = '';
    Promise.all([api('/admin/finance/summary'), api('/admin/withdrawals'), api('/admin/ledger?' + ledgerQuery()), api('/admin/payout-accounts')])
      .then(function (r) { FIN.summary = r[0]; FIN.wd = r[1]; FIN.ledger = r[2]; FIN.acc = r[3]; })
      .catch(function (e) { FIN.err = e.message || 'Không tải được dữ liệu tài chính.'; })
      .then(function () { FIN.loading = false; rerender('finance'); });
  }
  window.FIN_RELOAD = function () { FIN.summary = null; FIN.wd = null; FIN.acc = null; FIN.ledger = null; FIN.err = ''; rerender('finance'); };
  window.FIN_FILTER = function () {
    FIN.f.type = document.getElementById('finType').value; FIN.f.order = document.getElementById('finOrder').value.trim();
    FIN.f.from = document.getElementById('finFrom').value; FIN.f.to = document.getElementById('finTo').value; FIN.f.page = 1;
    FIN.ledger = null; rerender('finance');
  };
  window.FIN_PAGE = function (d) { FIN.f.page = Math.max(1, FIN.f.page + d); FIN.ledger = null; rerender('finance'); };
  window.FIN_RECONCILE = function () {
    if (FIN.recBusy) return; FIN.recBusy = true; rerender('finance');
    api('/admin/finance/reconcile', { method: 'POST' }).then(function (r) { FIN.rec = r; toast(r.ok ? 'Đối soát khớp' : 'Phát hiện lệch sổ cái!'); })
      .catch(function (e) { toast(e.message || 'Đối soát thất bại'); })
      .then(function () { FIN.recBusy = false; FIN.summary = null; FIN.wd = null; FIN.ledger = null; rerender('finance'); });
  };
  var WD_ST = { requested: ['b-w', 'Chờ duyệt'], approved: ['b-b', 'Đã duyệt · chờ chi'], processing: ['b-b', 'Đang chi'], paid: ['b-ok', 'Đã chi'], rejected: ['b-e', 'Từ chối'], failed: ['b-e', 'Chi thất bại'] };
  function finReset() { FIN.summary = null; FIN.wd = null; FIN.acc = null; FIN.ledger = null; rerender('finance'); }
  // Thao tác lệnh rút: approve / start / pay (cần mã giao dịch ngân hàng) / fail (cần lý do) / reject
  window.FIN_ACT = function (id, action) {
    var body = { decision: action };
    if (action === 'pay') {
      var ref = prompt('Nhập MÃ GIAO DỊCH NGÂN HÀNG của lần chuyển khoản (bắt buộc). Bấm OK sẽ trừ tiền khỏi ví cửa hàng:');
      if (ref === null) return;
      if (ref.trim().length < 3) { toast('Cần nhập mã giao dịch ngân hàng'); return; }
      body.bank_txn_ref = ref.trim();
    } else if (action === 'fail' || action === 'reject') {
      var why = prompt(action === 'fail' ? 'Lý do chi thất bại (bắt buộc):' : 'Lý do từ chối (tùy chọn):');
      if (why === null) return;
      if (action === 'fail' && why.trim().length < 3) { toast('Cần nhập lý do'); return; }
      if (why.trim()) body.note = why.trim();
    } else {
      var note = prompt('Ghi chú (tùy chọn):');
      if (note === null) return;
      if (note.trim()) body.note = note.trim();
    }
    api('/admin/withdrawals/' + encodeURIComponent(id), { method: 'PATCH', body: body })
      .then(function () { toast('Đã cập nhật lệnh rút'); finReset(); })
      .catch(function (e) { toast(e.message || 'Không xử lý được'); });
  };
  // Xem số tài khoản đầy đủ để chuyển khoản: backend ghi nhật ký (ai, khi nào, lệnh nào) TRƯỚC khi giải mã
  window.FIN_REVEAL = function (id) {
    if (!confirm('Xem số tài khoản ĐẦY ĐỦ để chi trả? Hành động này được ghi nhật ký (tên bạn, thời gian, lệnh rút).')) return;
    api('/admin/withdrawals/' + encodeURIComponent(id) + '/reveal-account', { method: 'POST' })
      .then(function (r) { alert('Ngân hàng: ' + r.bank_name + '\nChủ tài khoản: ' + r.account_holder_name + '\nSố tài khoản: ' + r.account_number + '\n\n(Đã ghi nhật ký truy cập. Đừng lưu hoặc chia sẻ số này.)'); })
      .catch(function (e) { toast(e.message || 'Không xem được số tài khoản'); });
  };
  window.FIN_ACC = function (id, verify) {
    var note = prompt(verify ? 'Ghi chú xác minh (bắt buộc nếu tên chủ tài khoản lệch tên đăng ký kinh doanh):' : 'Lý do từ chối (tùy chọn):');
    if (note === null) return;
    api('/admin/payout-accounts/' + encodeURIComponent(id), { method: 'PATCH', body: { decision: verify ? 'verify' : 'reject', note: note.trim() || undefined } })
      .then(function () { toast(verify ? 'Đã xác minh tài khoản' : 'Đã từ chối tài khoản'); finReset(); })
      .catch(function (e) { toast(e.message || 'Không xử lý được'); });
  };
  pg.finance = function () {
    var head = note('<b>Sổ cái mô phỏng.</b> Không có tiền thật chạy qua hệ thống. Mọi thay đổi tiền đều là một bút toán không sửa/xóa được, ghi một lần theo mã chống trùng.');
    if (!FIN.summary && !FIN.loading && !FIN.err) loadFinance();
    if (FIN.err) return head + Pn('Tài chính', '<div class="W" style="padding:14px;color:var(--t3)">' + esc(FIN.err) + ' <button class="bt" onclick="FIN_RELOAD()">Thử lại</button><br><small>Nếu chưa chạy SQL 030_wallet_ledger.sql trong Supabase thì các bảng sổ cái chưa tồn tại.</small></div>');
    if (!FIN.summary) return head + Pn('Tài chính', '<div class="W" style="padding:14px;color:var(--t3)">Đang tải sổ cái...</div>');
    var sm = FIN.summary, w = sm.wallets || {}, rc = sm.reconcile || {};
    var bad = !rc.ok;
    var kpis = '<div class="G G5">' + K('Giữ chờ (escrow)', vnd(w.escrow), 'Tiền khách đã trả, chờ nhận hàng', 'var(--warn)') + K('Doanh thu nền tảng', vnd(w.platform_revenue), 'Phí 2.000đ/đơn đã thu') + K('Quỹ từ thiện', vnd(w.charity_pool), 'Khách đóng góp khi đặt hàng') +
      K('Lệnh rút đang xử lý', Number(sm.pending_withdrawals_count || 0), vnd(sm.pending_withdrawals_total) + ' · TK chờ xác minh: ' + Number(sm.accounts_pending || 0), 'var(--accent, #0b6aa6)') +
      K('Lệch sổ cái', bad ? 'CÓ LỆCH' : 'Khớp', 'Tổng số dư ví: ' + vnd(rc.total_balance) + ' · ví lệch: ' + Number(rc.mismatched_wallets || 0), bad ? 'var(--err)' : 'var(--ok)') + '</div>';
    var kpis2 = '<div class="G G4">' + K('Đã giải ngân cho cửa hàng', vnd(sm.released_total), 'Tổng phần cửa hàng đã nhận') + K('Tiền giữ lại do vắng mặt / hủy muộn', vnd(sm.forfeited_total), 'Cửa hàng được giữ (trừ phí)', 'var(--err)') + K('Đã hoàn cho khách', vnd(sm.refunded_total), 'Hoàn sớm + khiếu nại') + K('Số dư các ví cửa hàng', vnd(sm.store_wallets_total), 'Đã giải ngân trừ tiền đã rút') + '</div>';
    var recBox = FIN.rec ? note('Đối soát lúc ' + new Date().toLocaleTimeString('vi-VN') + ': bù ' + Number(FIN.rec.synced_orders || 0) + ' đơn còn thiếu bút toán · tổng số dư ví <b>' + vnd(FIN.rec.total_balance) + '</b> · ví lệch <b>' + Number(FIN.rec.mismatched_wallets || 0) + '</b> · <b>' + (FIN.rec.ok ? 'KHỚP' : 'LỆCH') + '</b>') : '';
    var wdRows = (FIN.wd || []).map(function (x) {
      var ps = WD_ST[x.status] || ['b-m', esc(x.status)];
      var id = esc(x.id), btn = function (label, act, cls) { return '<button class="bt bt-s ' + (cls || '') + '" onclick="FIN_ACT(\'' + id + '\',\'' + act + '\')">' + label + '</button> '; };
      var act = '';
      if (x.status === 'requested') act = btn('Duyệt', 'approve', 'bt-p') + btn('Từ chối', 'reject');
      else if (x.status === 'approved') act = '<button class="bt bt-s" onclick="FIN_REVEAL(\'' + id + '\')">Xem số TK để chi</button> ' + btn('Bắt đầu chi', 'start', 'bt-p') + btn('Đã chi', 'pay') + btn('Hủy lệnh', 'reject');
      else if (x.status === 'processing') act = '<button class="bt bt-s" onclick="FIN_REVEAL(\'' + id + '\')">Xem số TK để chi</button> ' + btn('Đã chi', 'pay', 'bt-p') + btn('Thất bại', 'fail');
      else act = esc(x.failure_reason || x.admin_note || '') + (x.bank_txn_ref ? ' <small>· mã GD ' + esc(x.bank_txn_ref) + '</small>' : '');
      return '<tr><td>' + new Date(x.requested_at).toLocaleString('vi-VN') + '</td><td>' + esc((x.stores && x.stores.name) || '—') + '</td><td>' + esc(x.bank_name) + ' ••••' + esc(x.account_last4) + '</td><td class="mn">' + vnd(x.amount_cents) + '</td><td><span class="b ' + ps[0] + '">' + ps[1] + '</span></td><td>' + act + '</td></tr>';
    }).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--t3);padding:18px">Chưa có lệnh rút nào.</td></tr>';
    var accRows = (FIN.acc || []).filter(function (x) { return x.status === 'pending_verification'; }).map(function (x) {
      var warn = x.warning === 'name_mismatch' ? '<span class="b b-e">Tên lệch</span>' : x.warning === 'no_registered_name' ? '<span class="b b-w">Chưa có tên ĐKKD</span>' : '<span class="b b-ok">Tên khớp</span>';
      return '<tr><td>' + esc(x.store_name || '—') + '</td><td>' + esc(x.bank_name) + ' ••••' + esc(x.account_last4) + '</td><td>' + esc(x.account_holder_name) + '</td><td>' + esc(x.registered_name || '—') + '</td><td>' + warn + '</td><td><button class="bt bt-s bt-p" onclick="FIN_ACC(\'' + esc(x.id) + '\',true)">Xác minh</button> <button class="bt bt-s" onclick="FIN_ACC(\'' + esc(x.id) + '\',false)">Từ chối</button></td></tr>';
    }).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--t3);padding:18px">Không có tài khoản nào chờ xác minh.</td></tr>';
    var typeOpts = '<option value="">Tất cả loại</option>' + Object.keys(ENTRY_TYPE).map(function (k) { return '<option value="' + k + '"' + (FIN.f.type === k ? ' selected' : '') + '>' + ENTRY_TYPE[k] + '</option>'; }).join('');
    var filters = '<div style="display:flex;gap:8px;flex-wrap:wrap;padding:10px 14px;align-items:center"><select id="finType" style="padding:6px">' + typeOpts + '</select><input id="finOrder" placeholder="Mã đơn FS-..." value="' + esc(FIN.f.order) + '" style="padding:6px"><input id="finFrom" type="date" value="' + esc(FIN.f.from) + '" style="padding:6px"><input id="finTo" type="date" value="' + esc(FIN.f.to) + '" style="padding:6px"><button class="bt bt-p" onclick="FIN_FILTER()">Lọc</button></div>';
    var L = FIN.ledger, ledRows = !L ? '<tr><td colspan="6" style="padding:18px;color:var(--t3)">Đang tải...</td></tr>' : (L.items.map(function (e) {
      return '<tr><td>' + new Date(e.created_at).toLocaleString('vi-VN') + '</td><td>' + (ENTRY_TYPE[e.type] || esc(e.type)) + (e.reason ? ' <small style="color:var(--t3)">· ' + esc(REASON[e.reason] || e.reason) + '</small>' : '') + '</td><td>' + esc(e.order_number || '—') + '</td><td>' + esc(e.from) + '</td><td>' + esc(e.to) + '</td><td class="mn">' + vnd(e.amount) + '</td></tr>';
    }).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--t3);padding:18px">Không có bút toán phù hợp.</td></tr>');
    var pages = L ? Math.max(1, Math.ceil(L.total / 25)) : 1;
    var pager = '<div style="display:flex;gap:8px;align-items:center;padding:10px 14px"><button class="bt bt-s" ' + (FIN.f.page <= 1 ? 'disabled' : '') + ' onclick="FIN_PAGE(-1)">‹ Trước</button><span style="font-size:.75rem">Trang ' + FIN.f.page + '/' + pages + (L ? ' · ' + L.total + ' bút toán' : '') + '</span><button class="bt bt-s" ' + (FIN.f.page >= pages ? 'disabled' : '') + ' onclick="FIN_PAGE(1)">Sau ›</button></div>';
    if (!L && !FIN.loading) { FIN.loading = true; api('/admin/ledger?' + ledgerQuery()).then(function (r) { FIN.ledger = r; }).catch(function (e) { FIN.err = e.message; }).then(function () { FIN.loading = false; rerender('finance'); }); }
    return head + kpis + kpis2 + recBox +
      Pn('Tài khoản nhận tiền chờ xác minh', Tb(['Cửa hàng', 'Tài khoản', 'Tên chủ tài khoản', 'Tên đăng ký kinh doanh', 'Đối chiếu', 'Xử lý'], accRows), '<small style="color:var(--t3)">Chỉ hiện 4 số cuối. Số đầy đủ được mã hóa.</small>') +
      Pn('Lệnh rút tiền của cửa hàng', Tb(['Ngày gửi', 'Cửa hàng', 'Tài khoản', 'Số tiền', 'Trạng thái', 'Xử lý / mã giao dịch'], wdRows), '<button class="bt bt-s" onclick="FIN_RELOAD()">Tải lại</button>') +
      Pn('Sổ cái', filters + Tb(['Thời gian', 'Loại', 'Đơn', 'Từ ví', 'Đến ví', 'Số tiền'], ledRows) + pager, '<button class="bt bt-p" ' + (FIN.recBusy ? 'disabled' : '') + ' onclick="FIN_RECONCILE()">' + (FIN.recBusy ? 'Đang đối soát...' : 'Chạy đối soát ngay') + '</button>');
  };


  /* ---------- Khiếu nại thật (Đợt 3): GET /admin/complaints, POST /admin/complaints/:id/decision, GET /orders/:id/messages ---------- */
  var CMP = { rows: null, loading: false, err: '', filter: '', form: { decision: 'refund_full', amount: '', falseClaim: false, note: '' } };
  var CMP_ST = { open: ['b-w', 'Chờ cửa hàng phản hồi'], in_review: ['b-e', 'Chờ Admin quyết định'], resolved: ['b-ok', 'Đã giải quyết'], rejected: ['b-m', 'Đã bác bỏ'] };
  var CMP_REASON = { wrong_item: 'Giao sai sản phẩm', spoiled_expired: 'Hư hỏng / hết hạn', missing_items: 'Thiếu sản phẩm', other: 'Lý do khác' };
  var CMP_DECISION = { refund_full: 'Hoàn đủ', refund_partial: 'Hoàn một phần', reject: 'Bác bỏ' };
  var CMP_PRI = { high: 'Cao', medium: 'Trung bình', low: 'Thấp' };
  function left(ts) {
    if (!ts) return '—';
    var m = Math.round((new Date(ts).getTime() - Date.now()) / 60000);
    if (m <= 0) return 'Đã quá hạn';
    return m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'p' : m + ' phút';
  }
  function cmpCode(c) { return 'KN-' + String(c.id).slice(0, 6).toUpperCase(); }
  function cmpRender() { rerender('hub'); rerender('disputes'); }
  function cmpBadges() {
    var rows = CMP.rows || [];
    var waiting = rows.filter(function (c) { return c.status === 'in_review'; }).length;
    var open = rows.filter(function (c) { return c.status === 'open'; }).length;
    var hub = document.getElementById('hubBadge'); if (hub) hub.textContent = waiting ? String(waiting) : '';
    var disp = document.querySelector('.S-i[data-p="disputes"] em'); if (disp) disp.textContent = String(waiting + open);
  }
  function cmpLoad() {
    if (CMP.loading) return; CMP.loading = true; CMP.err = '';
    api('/admin/complaints').then(function (rows) { CMP.rows = rows || []; })
      .catch(function (e) { CMP.err = e.message || 'Không tải được khiếu nại.'; })
      .then(function () { CMP.loading = false; cmpBadges(); cmpRender(); });
  }
  window.CMP_RELOAD = function () { CMP.rows = null; CMP.err = ''; cmpRender(); };
  window.CMP_FILTER = function (f) { CMP.filter = CMP.filter === f ? '' : f; cmpRender(); };
  function cmpEnsure(title) {
    if (CMP.err) return Pn(title, '<div class="W" style="padding:14px;color:var(--t3)">' + esc(CMP.err) + ' <button class="bt" onclick="CMP_RELOAD()">Thử lại</button><br><small>Nếu chưa chạy SQL 031_complaint_flow.sql trong Supabase thì các cột khiếu nại mới chưa có.</small></div>');
    if (!CMP.rows) { if (!CMP.loading) cmpLoad(); return Pn(title, '<div class="W" style="padding:14px;color:var(--t3)">Đang tải khiếu nại...</div>'); }
    return null;
  }
  function stBadge(c) { var st = CMP_ST[c.status] || ['b-m', esc(c.status)]; return '<span class="b ' + st[0] + '">' + st[1] + '</span>'; }

  /* Hồ sơ khiếu nại (ngăn bên phải): thông tin, ảnh, phản hồi cửa hàng, lịch sử chat của đơn (bằng chứng, chỉ đọc), quyết định */
  window.CMP_OPEN = function (id) {
    var c = (CMP.rows || []).filter(function (x) { return x.id === id; })[0]; if (!c) return;
    CMP.form = { decision: 'refund_full', amount: '', falseClaim: false, note: '' };
    var imgs = function (list) { return (list || []).map(function (u) { return '<a href="' + esc(u) + '" target="_blank" rel="noopener"><img src="' + esc(u) + '" alt="Ảnh" style="width:84px;height:84px;object-fit:cover;border-radius:8px;border:1px solid var(--bd);margin:2px"></a>'; }).join(''); };
    var h = '<p><b>' + cmpCode(c) + '</b> · đơn <b>#' + esc(c.order_number || '—') + '</b> · giá trị ' + vnd(c.order_total) + '<br><b>Người mua:</b> ' + esc(c.customer_name || '—') + ' · <b>Cửa hàng:</b> ' + esc(c.store_name || '—') + '<br>' + stBadge(c) + ' · Ưu tiên ' + (CMP_PRI[c.priority] || '') + '</p>' +
      '<p><b>Lý do:</b> ' + esc(CMP_REASON[c.reason_code] || 'Khiếu nại cũ (không có lý do/ảnh bắt buộc)') + '<br><span style="white-space:pre-wrap">' + esc(c.issue) + '</span></p>' +
      (c.image_urls && c.image_urls.length ? '<p><b>Ảnh người mua gửi (' + c.image_urls.length + '):</b><br>' + imgs(c.image_urls) + '</p>' : '<p style="color:var(--t3)">Không có ảnh (khiếu nại cũ).</p>');
    if (c.store_responded_at) h += '<div class="v2note"><b>Cửa hàng ' + (c.store_response_action === 'accept' ? 'đồng ý hoàn tiền' : 'không đồng ý') + '</b>' + (c.store_response ? ': ' + esc(c.store_response) : '') + (c.store_response_images && c.store_response_images.length ? '<br>' + imgs(c.store_response_images) : '') + '</div>';
    else if (c.status === 'open') h += '<div class="v2note">Cửa hàng còn <b>' + left(c.response_due_at) + '</b> để phản hồi. Khi hết hạn khiếu nại tự chuyển cho Admin.</div>';
    h += '<p><b>Lịch sử chat của đơn (bằng chứng, chỉ đọc):</b></p><div id="cmpChat" style="max-height:200px;overflow:auto;background:#f6f8f6;border-radius:10px;padding:8px;font-size:.75rem">Đang tải chat...</div>';

    if (!c.reason_code) {
      // Khiếu nại CŨ: luồng cũ (đổi trạng thái + nội dung xử lý)
      h += '<p style="margin-top:12px"><b>Xử lý (khiếu nại cũ)</b></p><select id="cmpOldSt" style="width:100%;padding:8px">' + ['open', 'in_review', 'resolved', 'rejected'].map(function (k) { return '<option value="' + k + '"' + (k === c.status ? ' selected' : '') + '>' + CMP_ST[k][1] + '</option>'; }).join('') + '</select>' +
        '<textarea id="cmpOldRes" rows="3" style="width:100%;padding:8px;margin-top:6px" placeholder="Nội dung xử lý (gửi cho người mua)">' + esc(c.resolution || '') + '</textarea><button class="bt bt-p" style="margin-top:8px" onclick="CMP_OLD(\'' + esc(c.id) + '\')">Lưu</button>';
    } else if (c.status === 'in_review') {
      h += '<div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--bd)"><b>Quyết định của Admin</b>' +
        '<div style="margin:8px 0">' + Object.keys(CMP_DECISION).map(function (k) { return '<label style="display:block;margin:4px 0"><input type="radio" name="cmpDec" value="' + k + '"' + (k === 'refund_full' ? ' checked' : '') + ' onchange="CMP_FORM()"> ' + CMP_DECISION[k] + (k === 'refund_full' ? ' (' + vnd(c.order_total) + ')' : '') + '</label>'; }).join('') + '</div>' +
        '<div id="cmpAmtBox" style="display:none;margin-bottom:8px">Số tiền hoàn (đ), nhỏ hơn ' + vnd(c.order_total) + ': <input id="cmpAmt" inputmode="numeric" style="padding:6px;width:140px"></div>' +
        '<label id="cmpFalseBox" style="display:none;margin-bottom:8px"><input type="checkbox" id="cmpFalse"> Đánh dấu <b>khiếu nại sai sự thật</b> (người mua bị trừ 10 điểm)</label>' +
        '<textarea id="cmpNote" rows="3" style="width:100%;padding:8px" placeholder="Ghi chú quyết định (bắt buộc, gửi cho người mua)"></textarea>' +
        '<button class="bt bt-p" style="margin-top:8px" onclick="CMP_DECIDE(\'' + esc(c.id) + '\')">Chốt quyết định</button>' +
        '<div style="font-size:.7rem;color:var(--t3);margin-top:6px">Hoàn tiền (đủ hoặc một phần) sẽ trừ vào ví cửa hàng và cửa hàng bị trừ 15 điểm uy tín. Bác bỏ: không đụng ví.</div></div>';
    } else if (c.status === 'resolved' || c.status === 'rejected') {
      h += '<div class="v2note" style="margin-top:12px"><b>Kết quả:</b> ' + esc(CMP_DECISION[c.decision] || c.status) + (Number(c.refund_cents) > 0 ? ' · đã hoàn <b>' + vnd(c.refund_cents) + '</b>' : '') + (c.is_false_claim ? ' · <b>đã đánh dấu khiếu nại sai</b>' : '') + '<br>' + esc(c.admin_note || c.resolution || '') + '</div>';
    }
    oD('Hồ sơ khiếu nại ' + cmpCode(c), h);
    if (c.order_id) {
      api('/orders/' + encodeURIComponent(c.order_id) + '/messages').then(function (r) {
        var box = document.getElementById('cmpChat'); if (!box) return;
        var msgs = (r && r.messages) || [];
        box.innerHTML = msgs.length ? msgs.map(function (m) { return '<div style="margin:3px 0"><b>' + (m.sender_role === 'customer' ? 'Khách' : m.sender_role === 'partner' ? 'Cửa hàng' : 'Hệ thống') + '</b> <small style="color:var(--t3)">' + new Date(m.created_at).toLocaleString('vi-VN') + '</small><br>' + esc(m.body) + '</div>'; }).join('') : 'Không có tin nhắn.';
      }).catch(function (e) { var box = document.getElementById('cmpChat'); if (box) box.textContent = e.message || 'Không tải được chat.'; });
    }
  };
  window.CMP_FORM = function () {
    var dec = (document.querySelector('input[name="cmpDec"]:checked') || {}).value;
    var a = document.getElementById('cmpAmtBox'), f = document.getElementById('cmpFalseBox');
    if (a) a.style.display = dec === 'refund_partial' ? 'block' : 'none';
    if (f) f.style.display = dec === 'reject' ? 'block' : 'none';
  };
  window.CMP_DECIDE = function (id) {
    var dec = (document.querySelector('input[name="cmpDec"]:checked') || {}).value;
    var note = String((document.getElementById('cmpNote') || {}).value || '').trim();
    if (note.length < 3) { toast('Cần nhập ghi chú quyết định'); return; }
    var body = { decision: dec, note: note };
    if (dec === 'refund_partial') {
      var amt = Math.round(Number(String((document.getElementById('cmpAmt') || {}).value || '').replace(/\D/g, '')));
      if (!(amt > 0)) { toast('Nhập số tiền hoàn một phần'); return; }
      body.refund_cents = amt;
    }
    if (dec === 'reject' && (document.getElementById('cmpFalse') || {}).checked) body.is_false_claim = true;
    var label = CMP_DECISION[dec] + (body.refund_cents ? ' ' + vnd(body.refund_cents) : '') + (body.is_false_claim ? ' + đánh dấu khiếu nại sai' : '');
    if (!confirm('Chốt quyết định: ' + label + '?\nKhông thể đổi sau khi chốt.')) return;
    api('/admin/complaints/' + encodeURIComponent(id) + '/decision', { method: 'POST', body: body })
      .then(function () { toast('Đã chốt quyết định'); xD(); CMP.rows = null; cmpRender(); })
      .catch(function (e) { toast(e.message || 'Không chốt được quyết định'); });
  };
  window.CMP_OLD = function (id) {
    var st = document.getElementById('cmpOldSt').value, res = String(document.getElementById('cmpOldRes').value || '').trim();
    api('/orders/complaints/' + encodeURIComponent(id), { method: 'PATCH', body: res ? { status: st, resolution: res } : { status: st } })
      .then(function () { toast('Đã lưu'); xD(); CMP.rows = null; cmpRender(); })
      .catch(function (e) { toast(e.message || 'Không lưu được'); });
  };

  /* Trung tâm khiếu nại: 3 cột */
  pg.hub = function () {
    var wait = cmpEnsure('Trung tâm khiếu nại'); if (wait) return wait;
    var rows = CMP.rows;
    var cols = [
      ['Chờ cửa hàng phản hồi', 'var(--warn)', rows.filter(function (c) { return c.status === 'open'; })],
      ['Chờ Admin quyết định', 'var(--err)', rows.filter(function (c) { return c.status === 'in_review'; })],
      ['Đã giải quyết', 'var(--ok)', rows.filter(function (c) { return c.status === 'resolved' || c.status === 'rejected'; }).slice(0, 15)]
    ];
    var card = function (c) {
      return '<div class="v2card" onclick="CMP_OPEN(\'' + esc(c.id) + '\')"><div class="v2card-t"><b>' + cmpCode(c) + '</b>' + (c.status === 'open' ? (c.response_due_at ? '<span class="b b-w">Còn ' + left(c.response_due_at) + '</span>' : '<span class="b b-m">Khiếu nại cũ</span>') : c.status === 'in_review' ? '<span class="b b-e">' + (CMP_PRI[c.priority] || '') + '</span>' : stBadge(c)) + '</div>' +
        '<div class="v2card-b">' + esc(c.store_name || '—') + ' · #' + esc(c.order_number || '—') + '</div><div class="v2card-s">' + esc(CMP_REASON[c.reason_code] || 'Khiếu nại cũ') + ' · ' + esc(String(c.issue).slice(0, 70)) + '</div>' +
        '<div class="v2card-f"><span>' + esc(c.customer_name || '—') + '</span><span>' + vnd(c.order_total) + '</span></div></div>';
    };
    return note('Quy trình: người mua gửi (có ảnh) → cửa hàng có <b>12 giờ</b> đồng ý hoàn tiền hoặc không đồng ý → không đồng ý / quá hạn thì <b>Admin</b> quyết định hoàn đủ, một phần hoặc bác bỏ.') +
      '<div class="v2board">' + cols.map(function (col) { return '<div class="v2col"><div class="v2col-h" style="border-color:' + col[1] + '"><span>' + col[0] + '</span><span>' + col[2].length + '</span></div>' + (col[2].map(card).join('') || '<div style="color:var(--t3);font-size:.75rem;padding:10px">Không có khiếu nại.</div>') + '</div>'; }).join('') + '</div>';
  };

  /* Tranh chấp: bảng điều khiển tổng quan + bảng lọc (thay dữ liệu mẫu bằng dữ liệu thật) */
  pg.disputes = function () {
    var wait = cmpEnsure('Danh sách tranh chấp'); if (wait) return wait;
    var rows = CMP.rows;
    var cnt = { open: 0, in_review: 0, resolved: 0, rejected: 0 };
    rows.forEach(function (c) { cnt[c.status] = (cnt[c.status] || 0) + 1; });
    var high = rows.filter(function (c) { return c.priority === 'high' && (c.status === 'open' || c.status === 'in_review'); }).length;
    var done = cnt.resolved + cnt.rejected;
    var chip = function (key, label, value, note2, color) { return '<div class="v2chip" onclick="CMP_FILTER(\'' + key + '\')" style="' + (CMP.filter === key ? 'border-color:#1c7c45;background:#f3f8f4' : '') + '"><b style="color:' + (color || 'var(--text)') + '">' + value + '</b><span>' + label + (note2 ? ' · ' + note2 : '') + '</span></div>'; };
    var strip = '<div class="v2strip">' + chip('', 'Tổng hồ sơ', rows.length, '', '') + chip('open', 'Mới / đang mở', cnt.open, 'chờ cửa hàng', 'var(--warn)') + chip('in_review', 'Đã leo thang', cnt.in_review, 'chờ Admin', 'var(--err)') + chip('high', 'Ưu tiên cao', high, 'chưa xử lý', 'var(--err)') + chip('done', 'Đã xử lý', done, '', 'var(--ok)') + '</div>';
    var total = rows.length || 1;
    var seg = function (n, color, label) { return n ? '<div title="' + label + ': ' + n + '" style="width:' + (n / total * 100) + '%;background:' + color + '"></div>' : ''; };
    var bar = '<div style="display:flex;height:12px;border-radius:99px;overflow:hidden;background:#eef1ee;margin:6px 0">' + seg(cnt.open, '#f1b43c', 'Chờ cửa hàng') + seg(cnt.in_review, '#e5484d', 'Chờ Admin') + seg(cnt.resolved, '#2aa35c', 'Đã giải quyết') + seg(cnt.rejected, '#9aa39d', 'Đã bác bỏ') + '</div>' +
      '<div style="font-size:.7rem;color:var(--t3)">Vàng: chờ cửa hàng · Đỏ: chờ Admin · Xanh: đã giải quyết · Xám: đã bác bỏ</div>';
    var byStore = {}; rows.forEach(function (c) { var k = c.store_name || '—'; byStore[k] = (byStore[k] || 0) + 1; });
    var top = Object.keys(byStore).sort(function (a, b) { return byStore[b] - byStore[a]; }).slice(0, 3);
    var topHtml = top.length ? top.map(function (k, i) { return '<div style="display:flex;justify-content:space-between;padding:4px 0"><span>' + (i + 1) + '. ' + esc(k) + '</span><b>' + byStore[k] + ' khiếu nại</b></div>'; }).join('') : '<span style="color:var(--t3)">Chưa có dữ liệu.</span>';
    var urgent = rows.filter(function (c) { return c.status === 'in_review'; }).sort(function (a, b) { return (a.priority === 'high' ? 0 : 1) - (b.priority === 'high' ? 0 : 1) || new Date(a.escalated_at || a.created_at) - new Date(b.escalated_at || b.created_at); }).slice(0, 5);
    var urgentHtml = urgent.length ? urgent.map(function (c) { return '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--bd);cursor:pointer" onclick="CMP_OPEN(\'' + esc(c.id) + '\')"><span><b>' + cmpCode(c) + '</b> · ' + esc(c.store_name || '—') + '<br><small style="color:var(--t3)">' + esc(String(c.issue).slice(0, 60)) + '</small></span><span class="b b-e">' + (CMP_PRI[c.priority] || '') + '</span></div>'; }).join('') : '<span style="color:var(--t3)">Không có hồ sơ nào chờ quyết định.</span>';
    var dash = '<div class="G G3">' + Pn('Phân bố trạng thái', bar) + Pn('3 cửa hàng bị khiếu nại nhiều nhất', '<div style="padding:10px 14px;font-size:.8rem">' + topHtml + '</div>') + Pn('Cần xử lý trước', '<div style="padding:4px 14px;font-size:.8rem">' + urgentHtml + '</div>') + '</div>';
    var list = rows.filter(function (c) {
      return CMP.filter === 'open' ? c.status === 'open' : CMP.filter === 'in_review' ? c.status === 'in_review' : CMP.filter === 'high' ? (c.priority === 'high' && (c.status === 'open' || c.status === 'in_review')) : CMP.filter === 'done' ? (c.status === 'resolved' || c.status === 'rejected') : true;
    });
    var trs = list.map(function (c) {
      var tail = c.status === 'open' ? (c.response_due_at ? 'Còn ' + left(c.response_due_at) : '—') : c.decision ? esc(CMP_DECISION[c.decision]) + (Number(c.refund_cents) > 0 ? ' ' + vnd(c.refund_cents) : '') : '—';
      return '<tr><td>' + cmpCode(c) + '</td><td>#' + esc(c.order_number || '—') + '</td><td>' + esc(c.customer_name || '—') + '</td><td>' + esc(c.store_name || '—') + '</td><td>' + stBadge(c) + '</td><td>' + esc(CMP_REASON[c.reason_code] || 'Khiếu nại cũ') + '</td><td>' + (CMP_PRI[c.priority] || '') + '</td><td>' + tail + '</td><td><button class="bt bt-s" onclick="CMP_OPEN(\'' + esc(c.id) + '\')">' + (c.status === 'in_review' ? 'Xử lý' : 'Xem') + '</button></td></tr>';
    }).join('') || '<tr><td colspan="9" style="text-align:center;color:var(--t3);padding:18px">Không có hồ sơ phù hợp.</td></tr>';
    return strip + dash + Pn('Danh sách tranh chấp' + (CMP.filter ? ' (đang lọc)' : ''), Tb(['Mã', 'Đơn', 'Người mua', 'Cửa hàng', 'Trạng thái', 'Lý do', 'Ưu tiên', 'Hạn / kết quả', ''], trs), '<button class="bt bt-s" onclick="CMP_RELOAD()">Tải lại</button>');
  };
  // Số trên menu lấy từ dữ liệu thật ngay khi vào trang quản trị
  setTimeout(function () { try { if (typeof foodsaveAdminSupabase !== 'undefined') cmpLoad(); } catch (e) {} }, 4000);

  var oldReputation = pg.reputation;
  pg.reputation = function () {
    if (!LOCK.rows && !LOCK.loading && !LOCK.err) loadLocked();
    return lockedBlock() + (typeof oldReputation === 'function' ? oldReputation() : '');
  };

  /* ═════════ ĐỢT 4b: các màn Admin dùng dữ liệu thật ═════════
     Chính sách chỉnh được · Tự động hóa (nhật ký thật) · Quản lý nhãn · Xác minh hồ sơ · Voucher · Báo cáo ESG ·
     Cảnh báo gian lận · Uy tín · Bảng điều khiển · Nhật ký hoạt động.   ?demo=1 giữ lại bản dữ liệu mẫu cũ của dashboard/gian lận/nhật ký. */
  var DEMO = /[?&]demo=1/.test(location.search);
  var dt = function (s) { return s ? new Date(s).toLocaleString('vi-VN') : '—'; };
  var STORE = {};
  function Page(key, title, path, render) {
    var S = STORE[key] = { data: null, loading: false, err: '' };
    pg[key] = function () {
      if (!S.data && !S.loading && !S.err) {
        S.loading = true;
        api(typeof path === 'function' ? path() : path).then(function (d) { S.data = d; }).catch(function (e) { S.err = e.message || 'Không tải được dữ liệu.'; })
          .then(function () { S.loading = false; rerender(key); });
      }
      if (S.err) return Pn(title, '<div class="W" style="padding:14px;color:var(--t3)">' + esc(S.err) + ' <button class="bt" onclick="PAGE_RELOAD(\'' + key + '\')">Thử lại</button><br><small>Nếu chưa chạy SQL 036_admin_ops.sql trong Supabase thì các bảng mới chưa tồn tại.</small></div>');
      if (!S.data) return Pn(title, '<div class="W" style="padding:14px;color:var(--t3)">Đang tải...</div>');
      return render(S.data, S);
    };
  }
  window.PAGE_RELOAD = function (key) { var S = STORE[key]; if (!S) return; S.data = null; S.err = ''; rerender(key); };
  function act(promise, okMsg, reloadKeys) {
    return promise.then(function (r) { if (okMsg) toast(okMsg); (reloadKeys || []).forEach(window.PAGE_RELOAD); return r; })
      .catch(function (e) { toast(e.message || 'Không thực hiện được'); });
  }

  /* ---------- điều hướng bổ sung + bỏ số đếm mẫu ---------- */
  Object.assign(titles, { labels: 'Quản lý nhãn', verification: 'Xác minh hồ sơ', vouchers: 'Voucher', esg: 'Báo cáo ESG', audits: 'Nhật ký hoạt động' });
  (function () {
    var nav = document.querySelector('.S-n'); if (!nav) return;
    function addAfter(refKey, key, html) {
      if (nav.querySelector('.S-i[data-p="' + key + '"]')) return;
      var d = document.createElement('div'); d.className = 'S-i'; d.dataset.p = key; d.innerHTML = html;
      d.addEventListener('click', function () { go(key); });
      var ref = nav.querySelector('.S-i[data-p="' + refKey + '"]');
      if (ref && ref.nextSibling) nav.insertBefore(d, ref.nextSibling); else nav.appendChild(d);
    }
    addAfter('charities', 'verification', 'Xác minh hồ sơ <em id="verBadge"></em>');
    addAfter('donations', 'labels', 'Quản lý nhãn');
    addAfter('payouts', 'vouchers', 'Voucher');
    addAfter('risks', 'esg', 'Báo cáo ESG');
    // Số đếm trên menu là số mẫu của bản thiết kế: chỉ giữ ở ?demo=1; các số thật được gắn lại bên dưới
    if (!DEMO) nav.querySelectorAll('.S-i em').forEach(function (em) { if (!em.id && !/^\s*$/.test(em.textContent)) em.textContent = ''; });
  })();
  function setBadge(sel, n) { var el = document.querySelector(sel); if (el) el.textContent = n ? String(n) : ''; }
  function refreshBadges() {
    if (DEMO || typeof foodsaveAdminSupabase === 'undefined') return;
    api('/admin/dashboard/work').then(function (w) {
      setBadge('#verBadge', w.verification_pending);
      var risks = document.querySelector('.S-i[data-p="risks"] em'); if (risks) risks.textContent = w.fraud_open ? String(w.fraud_open) : '';
      STORE.work = { data: w };
    }).catch(function () { /* menu không có số cũng không sao */ });
  }
  setTimeout(refreshBadges, 4500);

  /* ---------- Chính sách: chỉnh được + Lưu cấu hình ---------- */
  var PF = { err: '' };
  var LBL = [['green', 'Xanh', 'Còn hạn dài', 'ok'], ['yellow', 'Vàng', 'Cận hạn', 'w'], ['red', 'Đỏ', 'Sắp hết hạn', 'e']];
  var inp = function (id, v, min, max) { return '<input id="' + id + '" type="number" inputmode="numeric" min="' + min + '" max="' + max + '" value="' + esc(v) + '" style="width:84px;padding:6px">'; };
  function readPolicyForm() {
    var num = function (id) { return Math.round(Number(document.getElementById(id).value)); };
    var labels = {};
    LBL.forEach(function (l) {
      labels[l[0]] = { payMinutes: num('pf_' + l[0] + '_pay'), pickupMinutes: num('pf_' + l[0] + '_pick'), cancelFreeBeforePickupMinutes: num('pf_' + l[0] + '_free'), finalReminderMinutes: num('pf_' + l[0] + '_rem') };
    });
    return { labels: labels, grace_cancel_minutes: num('pf_grace'), min_pickup_window_minutes: num('pf_minwin'), no_show_ban_count: num('pf_nsc'), no_show_window_days: num('pf_nsd'), red_ban_days: num('pf_ban') };
  }
  function policyErrors(c) {
    var e = [];
    LBL.forEach(function (l) {
      var p = c.labels[l[0]];
      Object.keys(p).forEach(function (k) { if (!isFinite(p[k]) || p[k] < 1) e.push('Nhãn ' + l[1] + ': giá trị phải là số nguyên dương'); });
      if (p.cancelFreeBeforePickupMinutes >= p.pickupMinutes) e.push('Nhãn ' + l[1] + ': hủy miễn phí (' + p.cancelFreeBeforePickupMinutes + ') phải nhỏ hơn hạn lấy hàng (' + p.pickupMinutes + ')');
      if (p.finalReminderMinutes >= p.pickupMinutes) e.push('Nhãn ' + l[1] + ': nhắc cuối (' + p.finalReminderMinutes + ') phải nhỏ hơn hạn lấy hàng (' + p.pickupMinutes + ')');
    });
    return e.filter(function (x, i, a) { return a.indexOf(x) === i; });
  }
  window.POL_SAVE = function () {
    var cfg = readPolicyForm(), errs = policyErrors(cfg);
    if (errs.length) { PF.err = errs.join('\n'); rerender('policy'); toast(errs[0]); return; }
    PF.err = '';
    if (!confirm('Lưu cấu hình? Đơn đã tạo giữ nguyên hạn cũ; chỉ đơn MỚI áp dụng giá trị mới.')) return;
    api('/admin/order-policy', { method: 'PUT', body: cfg }).then(function () { toast('Đã lưu cấu hình'); POL.data = null; rerender('policy'); })
      .catch(function (e) { PF.err = e.message || 'Không lưu được'; rerender('policy'); toast(PF.err); });
  };
  window.POL_RESET = function () {
    if (!confirm('Khôi phục toàn bộ về giá trị mặc định của hệ thống?')) return;
    act(api('/admin/order-policy/reset', { method: 'POST' }), 'Đã khôi phục mặc định').then(function () { POL.data = null; PF.err = ''; rerender('policy'); });
  };
  pg.policy = function () {
    if (!POL.data && !POL.loading && !POL.err) loadPolicy();
    if (POL.err) return Pn('Chính sách nhãn và đơn hàng', '<div class="W" style="padding:14px;color:var(--t3)">' + esc(POL.err) + ' <button class="bt" onclick="POL_RETRY()">Thử lại</button></div>');
    if (!POL.data) return Pn('Chính sách nhãn và đơn hàng', '<div class="W" style="padding:14px;color:var(--t3)">Đang tải chính sách...</div>');
    var d = POL.data, L = d.labels, rep = d.reputation;
    var rows = LBL.map(function (l) {
      var p = L[l[0]];
      return '<tr><td><span class="b b-' + l[3] + '">' + l[1] + '</span></td><td>' + l[2] + '</td><td>' + inp('pf_' + l[0] + '_pay', p.payMinutes, 1, 60) + '</td><td>' + inp('pf_' + l[0] + '_pick', p.pickupMinutes, 15, 1440) + '</td><td>' + inp('pf_' + l[0] + '_free', p.cancelFreeBeforePickupMinutes, 1, 1440) + '</td><td>' + inp('pf_' + l[0] + '_rem', p.finalReminderMinutes, 1, 1440) + '</td></tr>';
    }).join('');
    var scaleNote = d.time_scale !== 1 ? note('<b>Đang bật chế độ rút ngắn thời gian ×' + d.time_scale + '</b> (DEMO_MODE). Mọi hạn được nhân hệ số này. Môi trường thật luôn là 1.') : '';
    var who = d.stored ? 'Lần lưu gần nhất: ' + dt(d.updated_at) + '. ' : 'Chưa từng lưu: đang dùng giá trị mặc định của hệ thống. ';
    var errBox = PF.err ? '<div class="v2note" style="border-color:#f1b0ab;background:#fdf1f0;white-space:pre-line">' + esc(PF.err) + '</div>' : '';
    var pts = [['Người mua nhận hàng thành công', '+' + rep.pickupSuccessDelta], ['Người mua vắng mặt', String(rep.noShowDelta)], ['Hủy muộn', String(rep.lateCancelDelta)], ['Khiếu nại sai sự thật', String(rep.falseComplaintDelta)], ['Cửa hàng giao thành công', '+5'], ['Cửa hàng hủy / hết hàng ảo', '−15'], ['Khiếu nại đúng (cửa hàng)', '−15']];
    return note('<b>Chỉnh được.</b> ' + who + 'Đơn đã tạo giữ nguyên hạn đã tính; chỉ đơn mới áp dụng. Mọi lần lưu được ghi vào Nhật ký hoạt động. Điểm uy tín bên dưới chỉ đọc.') + scaleNote + errBox +
      Pn('Thời hạn theo nhãn (phút)', Tb(['Nhãn', 'Ý nghĩa', 'Hạn thanh toán', 'Hạn lấy hàng', 'Hủy miễn phí trước hạn lấy', 'Nhắc cuối còn'], rows)) +
      Pn('Quy tắc chung', '<div style="display:flex;gap:18px;flex-wrap:wrap;padding:12px 14px;font-size:.82rem">' +
        '<label>Hủy miễn phí cực ngắn sau thanh toán (phút)<br>' + inp('pf_grace', d.grace_cancel_minutes, 0, 30) + '</label>' +
        '<label>Còn tối thiểu tới HSD mới cho đặt (phút)<br>' + inp('pf_minwin', d.min_pickup_window_minutes, 5, 240) + '</label>' +
        '<label>Số lần vắng mặt để khóa nhãn đỏ<br>' + inp('pf_nsc', d.no_show_ban_count, 2, 10) + '</label>' +
        '<label>Trong khoảng (ngày)<br>' + inp('pf_nsd', d.no_show_window_days, 7, 365) + '</label>' +
        '<label>Khóa nhãn đỏ (ngày)<br>' + inp('pf_ban', d.red_ban_days, 1, 365) + '</label></div>' +
        '<div style="padding:0 14px 14px"><button class="bt bt-p" onclick="POL_SAVE()">Lưu cấu hình</button> <button class="bt" onclick="POL_RESET()">Khôi phục mặc định</button> <small style="color:var(--t3)">Phí nền tảng: ' + Number(d.platform_fee).toLocaleString('vi-VN') + 'đ/đơn (cố định trong hệ thống)</small></div>') +
      '<div class="G G2">' + Pn('Điểm uy tín (chỉ đọc)', Tb(['Hành vi', 'Điểm'], pts.map(function (p) { return '<tr><td>' + p[0] + '</td><td class="mn" style="color:' + (p[1].charAt(0) === '+' ? 'var(--ok)' : 'var(--err)') + '">' + p[1] + '</td></tr>'; }).join(''))) +
      Pn('Quy tắc hạn chế', note('• <b>Điểm &lt; ' + rep.blockedBelow + '</b>: chặn đặt hàng.<br>• <b>' + d.no_show_ban_count + ' lần vắng mặt / ' + d.no_show_window_days + ' ngày</b>: khóa mua nhãn đỏ ' + d.red_ban_days + ' ngày.<br>• <b>Hạn lấy hàng</b> = nhỏ nhất giữa (giờ thanh toán + thời hạn nhãn) và hạn sử dụng sản phẩm.<br>• Hủy sớm hoàn 100%; hủy muộn / vắng mặt: không hoàn, tiền về cửa hàng (trừ phí).')) + '</div>';
  };

  /* ---------- Tự động hóa: nhật ký chạy thật ---------- */
  var AUTO2 = { last: null, running: '' };
  window.AUTO_RUN = function (job) {
    if (AUTO2.running) return; AUTO2.running = job; rerender('automation');
    api('/admin/automation/' + encodeURIComponent(job) + '/run', { method: 'POST' })
      .then(function (r) { AUTO2.last = { job: job, result: r }; toast('Đã chạy xong'); })
      .catch(function (e) { toast(e.message || 'Chạy thất bại'); })
      .then(function () { AUTO2.running = ''; window.PAGE_RELOAD('automation'); });
  };
  Page('automation', 'Tự động hóa', '/admin/automation', function (rows) {
    var trs = rows.map(function (j) {
      var l = j.last_run;
      var st = !l ? '<span class="b b-m">Chưa có lần chạy</span>' : l.ok ? '<span class="b b-ok">Thành công</span>' : '<span class="b b-e">Có lỗi</span>';
      var err = j.last_failure ? '<br><small style="color:var(--err)">Lỗi gần nhất ' + dt(j.last_failure.started_at) + ': ' + esc(j.last_failure.error) + '</small>' : '';
      return '<tr><td><b>' + esc(j.name) + '</b><br><small style="color:var(--t3)">' + esc(j.job) + ' · ' + esc(j.schedule) + '</small></td><td>' + (l ? dt(l.started_at) + '<br><small style="color:var(--t3)">' + (l.trigger === 'manual' ? 'chạy tay' : 'tự động') + '</small>' : '—') + '</td><td>' + st + err + '</td><td>' + j.runs_7d + ' lần · ' + j.failures_7d + ' lỗi</td><td><button class="bt bt-s bt-p" ' + (AUTO2.running ? 'disabled' : '') + ' onclick="AUTO_RUN(\'' + esc(j.job) + '\')">' + (AUTO2.running === j.job ? 'Đang chạy...' : 'Chạy ngay') + '</button></td></tr>';
    }).join('');
    var last = AUTO2.last ? note('Kết quả lần chạy tay <b>' + esc(AUTO2.last.job) + '</b>: <code>' + esc(JSON.stringify(AUTO2.last.result)) + '</code>') : '';
    return note('Các tác vụ tự chạy <b>mỗi 5 phút</b> trên Netlify (Scheduled Function). Bảng dưới lấy từ nhật ký chạy thật trong 7 ngày; "Chạy ngay" dùng khi thử nghiệm hoặc cần xử lý gấp.') + last +
      Pn('Tác vụ tự động', Tb(['Tác vụ', 'Lần chạy gần nhất', 'Kết quả', '7 ngày qua', ''], trs), '<button class="bt bt-s" onclick="PAGE_RELOAD(\'automation\')">Tải lại</button>');
  });

  /* ---------- Quản lý nhãn ---------- */
  var LCOL = { green: ['Xanh · còn hạn dài', 'var(--ok)'], yellow: ['Vàng · cận hạn', 'var(--warn)'], red: ['Đỏ · sắp hết hạn', 'var(--err)'] };
  Page('labels', 'Quản lý nhãn', '/admin/labels', function (d) {
    var kp = '<div class="G G4">' + K('Tổng lô đang bán', d.total, 'Đang bật và còn hàng') + ['green', 'yellow', 'red'].map(function (k) { return K(LCOL[k][0], d.counts[k] || 0, 'lô hàng', LCOL[k][1]); }).join('') + '</div>';
    var trs = d.lots.map(function (l) {
      return '<tr><td><span class="b b-' + (l.label === 'red' ? 'e' : l.label === 'yellow' ? 'w' : 'ok') + '">' + (LCOL[l.label] ? LCOL[l.label][0].split(' ')[0] : esc(l.label)) + '</span></td><td>' + esc(l.name) + '</td><td>' + esc(l.store_name) + '</td><td class="mn">' + l.stock_quantity + '</td><td class="mn">' + vnd(l.price_cents) + ' <small style="color:var(--t3)"><s>' + vnd(l.original_price_cents) + '</s></small></td><td>' + dt(l.effective_deadline_at || l.expires_at) + '</td><td>' + dt(l.label_changed_at) + '</td></tr>';
    }).join('') || '<tr><td colspan="7" style="text-align:center;color:var(--t3);padding:18px">Chưa có lô hàng nào đang bán.</td></tr>';
    return kp + Pn('Lô hàng theo nhãn (đỏ lên trước, tối đa 500 lô)', Tb(['Nhãn', 'Sản phẩm', 'Cửa hàng', 'Tồn', 'Giá', 'Hạn hiệu lực', 'Đổi nhãn lúc'], trs),
      '<button class="bt bt-s" onclick="PAGE_RELOAD(\'labels\')">Tải lại</button> <button class="bt bt-p bt-s" onclick="AUTO_RUN_LABEL()">Chạy đổi nhãn ngay</button>');
  });
  window.AUTO_RUN_LABEL = function () { act(api('/admin/automation/label-automation/run', { method: 'POST' }), 'Đã chạy đổi nhãn', ['labels']); };

  /* ---------- Xác minh hồ sơ ---------- */
  window.VER_DECIDE = function (kind, id, approve) {
    var reason;
    if (!approve) { reason = prompt('Lý do từ chối (bắt buộc, gửi cho chủ hồ sơ):'); if (reason === null) return; if (reason.trim().length < 3) { toast('Cần nhập lý do'); return; } }
    else if (!confirm('Duyệt hồ sơ này?')) return;
    act(api('/admin/verification/' + kind + '/' + encodeURIComponent(id) + '/decision', { method: 'POST', body: approve ? { decision: 'approve' } : { decision: 'reject', reason: reason.trim() } }), approve ? 'Đã duyệt' : 'Đã từ chối', ['verification']).then(refreshBadges);
  };
  Page('verification', 'Xác minh hồ sơ', '/admin/verification', function (d) {
    var btns = function (kind, id) { return '<button class="bt bt-s bt-p" onclick="VER_DECIDE(\'' + kind + '\',\'' + esc(id) + '\',true)">Duyệt</button> <button class="bt bt-s" onclick="VER_DECIDE(\'' + kind + '\',\'' + esc(id) + '\',false)">Từ chối</button>'; };
    var sRows = d.stores.map(function (s) { return '<tr><td><b>' + esc(s.name) + '</b></td><td>' + esc(s.address) + '</td><td>' + esc(s.owner_name || '—') + '<br><small style="color:var(--t3)">' + esc(s.phone) + '</small></td><td>' + dt(s.created_at) + '</td><td>' + btns('store', s.id) + '</td></tr>'; }).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--t3);padding:18px">Không có cửa hàng nào chờ duyệt.</td></tr>';
    var cRows = d.charities.map(function (c) { return '<tr><td><b>' + esc(c.name) + '</b></td><td>' + esc(c.address) + '</td><td>' + esc(c.email) + '<br><small style="color:var(--t3)">' + esc(c.phone) + '</small></td><td>' + dt(c.created_at) + '</td><td>' + btns('charity', c.id) + '</td></tr>'; }).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--t3);padding:18px">Không có tổ chức nào chờ duyệt.</td></tr>';
    var hRows = d.history.map(function (h) { return '<tr><td>' + dt(h.created_at) + '</td><td>' + esc(h.actor_name || '—') + '</td><td>' + (String(h.action).indexOf('approve') >= 0 ? '<span class="b b-ok">Duyệt</span>' : '<span class="b b-e">Từ chối</span>') + '</td><td>' + (h.target_type === 'store' ? 'Cửa hàng' : 'Tổ chức') + ' ' + esc((h.detail && h.detail.name) || '') + '</td><td>' + esc((h.detail && h.detail.reason) || '') + '</td></tr>'; }).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--t3);padding:18px">Chưa có lần duyệt nào.</td></tr>';
    return Pn('Cửa hàng chờ duyệt (' + d.stores.length + ')', Tb(['Cửa hàng', 'Địa chỉ', 'Chủ cửa hàng', 'Gửi lúc', ''], sRows), '<button class="bt bt-s" onclick="PAGE_RELOAD(\'verification\')">Tải lại</button>') +
      Pn('Tổ chức từ thiện chờ duyệt (' + d.charities.length + ')', Tb(['Tổ chức', 'Địa chỉ', 'Liên hệ', 'Gửi lúc', ''], cRows)) +
      Pn('Lịch sử duyệt gần đây', Tb(['Thời gian', 'Người duyệt', 'Kết quả', 'Hồ sơ', 'Lý do'], hRows));
  });

  /* ---------- Voucher ---------- */
  var VST = { live: ['b-ok', 'Đang chạy'], scheduled: ['b-b', 'Chưa tới giờ'], expired: ['b-m', 'Hết hạn'], used_up: ['b-w', 'Hết lượt'], off: ['b-m', 'Đã tắt'] };
  window.VCH_TOGGLE = function (id, on) { act(api('/admin/vouchers/' + encodeURIComponent(id), { method: 'PATCH', body: { is_active: on } }), on ? 'Đã bật voucher' : 'Đã tắt voucher', ['vouchers']); };
  window.VCH_CREATE = function () {
    var g = function (id) { return String(document.getElementById(id).value || '').trim(); };
    var type = g('vc_type'), val = Math.round(Number(g('vc_val')));
    if (!g('vc_code') || !g('vc_name') || !(val > 0) || !g('vc_from') || !g('vc_to')) { toast('Nhập đủ mã, tên, giá trị và thời gian'); return; }
    var body = { code: g('vc_code'), name: g('vc_name'), starts_at: new Date(g('vc_from')).toISOString(), expires_at: new Date(g('vc_to')).toISOString() };
    if (type === 'percent') body.percent_off = val; else body.fixed_discount_cents = val;
    if (g('vc_min')) body.min_order_cents = Math.round(Number(g('vc_min')));
    if (g('vc_max')) body.max_redemptions = Math.round(Number(g('vc_max')));
    act(api('/admin/vouchers', { method: 'POST', body: body }), 'Đã tạo voucher toàn sàn', ['vouchers']);
  };
  Page('vouchers', 'Voucher', '/admin/vouchers', function (rows) {
    var trs = rows.map(function (v) {
      var st = VST[v.state] || ['b-m', esc(v.state)];
      var val = v.percent_off ? v.percent_off + '%' : vnd(v.fixed_discount_cents);
      return '<tr><td class="mn"><b>' + esc(v.code) + '</b></td><td>' + esc(v.name) + '</td><td>' + esc(v.store_name) + '</td><td>' + val + (v.min_order_cents ? '<br><small style="color:var(--t3)">đơn từ ' + vnd(v.min_order_cents) + '</small>' : '') + '</td><td>' + dt(v.starts_at) + '<br><small style="color:var(--t3)">đến ' + dt(v.expires_at) + '</small></td><td>' + v.redemption_count + (v.max_redemptions ? '/' + v.max_redemptions : '') + '</td><td><span class="b ' + st[0] + '">' + st[1] + '</span></td><td><button class="bt bt-s" onclick="VCH_TOGGLE(\'' + esc(v.id) + '\',' + (v.is_active ? 'false' : 'true') + ')">' + (v.is_active ? 'Tắt' : 'Bật') + '</button></td></tr>';
    }).join('') || '<tr><td colspan="8" style="text-align:center;color:var(--t3);padding:18px">Chưa có voucher nào.</td></tr>';
    var f = '<div style="display:flex;gap:8px;flex-wrap:wrap;padding:12px 14px;align-items:flex-end;font-size:.78rem">' +
      '<label>Mã<br><input id="vc_code" placeholder="GIOVANG10" style="padding:6px;width:120px"></label><label>Tên<br><input id="vc_name" style="padding:6px;width:150px"></label>' +
      '<label>Loại<br><select id="vc_type" style="padding:6px"><option value="percent">Giảm %</option><option value="fixed">Giảm số tiền (đ)</option></select></label>' +
      '<label>Giá trị<br><input id="vc_val" type="number" style="padding:6px;width:90px"></label><label>Đơn tối thiểu (đ)<br><input id="vc_min" type="number" style="padding:6px;width:100px"></label>' +
      '<label>Số lượt tối đa<br><input id="vc_max" type="number" style="padding:6px;width:80px"></label>' +
      '<label>Từ<br><input id="vc_from" type="datetime-local" style="padding:6px"></label><label>Đến<br><input id="vc_to" type="datetime-local" style="padding:6px"></label>' +
      '<button class="bt bt-p" onclick="VCH_CREATE()">Tạo voucher toàn sàn</button></div>';
    return note('Voucher <b>toàn sàn</b> dùng được ở mọi cửa hàng; voucher do cửa hàng tạo chỉ dùng ở cửa hàng đó. Khách nhập mã khi thanh toán.') + Pn('Tạo voucher', f) +
      Pn('Danh sách voucher', Tb(['Mã', 'Tên', 'Phạm vi', 'Giảm', 'Thời gian', 'Đã dùng', 'Trạng thái', ''], trs), '<button class="bt bt-s" onclick="PAGE_RELOAD(\'vouchers\')">Tải lại</button>');
  });

  /* ---------- Báo cáo ESG ---------- */
  var ESGM = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 7);
  window.ESG_MONTH = function () { var v = document.getElementById('esgMonth').value; if (v) { ESGM = v; window.PAGE_RELOAD('esg'); } };
  Page('esg', 'Báo cáo ESG', function () { return '/admin/esg?month=' + encodeURIComponent(ESGM); }, function (d) {
    var n = function (x, u) { return Number(x || 0).toLocaleString('vi-VN') + (u || ''); };
    var delta = function (cur, prev) { if (!prev) return cur ? 'Tháng trước: chưa có số liệu' : ''; var p = Math.round((cur - prev) / prev * 100); return 'So với tháng trước: ' + (p >= 0 ? '+' : '') + p + '%'; };
    var t = d.total, p = d.previous;
    var kp = '<div class="G G5">' + K('Thực phẩm được cứu', n(t.food_saved_kg, ' kg'), delta(t.food_saved_kg, p.food_saved_kg), 'var(--ok)') + K('CO₂ tránh phát thải', n(t.co2_avoided_kg, ' kg'), delta(t.co2_avoided_kg, p.co2_avoided_kg)) + K('Nước tiết kiệm', n(t.water_saved_liters, ' lít'), delta(t.water_saved_liters, p.water_saved_liters)) + K('Suất ăn tương đương', n(t.meals_equivalent), delta(t.meals_equivalent, p.meals_equivalent)) + K('Tiền khách tiết kiệm', vnd(t.money_saved_cents), delta(t.money_saved_cents, p.money_saved_cents)) + '</div>';
    var SRC = { order: 'Đơn hàng', donation: 'Quyên góp', manual_adjustment: 'Điều chỉnh tay' };
    var src = Object.keys(SRC).map(function (k) { var s = d.by_source[k]; return '<tr><td>' + SRC[k] + '</td><td class="mn">' + s.events + '</td><td class="mn">' + n(s.food_saved_kg, ' kg') + '</td><td class="mn">' + n(s.co2_avoided_kg, ' kg') + '</td><td class="mn">' + n(s.meals_equivalent) + '</td></tr>'; }).join('');
    var top = d.top_stores.map(function (s, i) { return '<tr><td>' + (i + 1) + '</td><td>' + esc(s.store_name) + '</td><td class="mn">' + n(s.food_saved_kg, ' kg') + '</td><td class="mn">' + n(s.meals_equivalent) + '</td></tr>'; }).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--t3);padding:18px">Chưa có dữ liệu.</td></tr>';
    var pick = '<input id="esgMonth" type="month" value="' + esc(ESGM) + '" style="padding:6px" onchange="ESG_MONTH()">';
    return note(esc(d.note)) + (d.has_data ? '' : note('<b>Tháng ' + esc(d.month) + ' chưa có sự kiện tác động nào</b> nên các số đều là 0.')) +
      Pn('Tháng báo cáo', '<div style="padding:10px 14px;display:flex;gap:14px;align-items:center;flex-wrap:wrap">' + pick + '<span>Đơn hoàn tất: <b>' + n(d.orders_completed) + '</b> · Lô quyên góp hoàn tất: <b>' + n(d.donations_delivered) + '</b></span></div>') + kp +
      '<div class="G G2">' + Pn('Theo nguồn', Tb(['Nguồn', 'Sự kiện', 'Thực phẩm', 'CO₂', 'Suất ăn'], src)) + Pn('Top cửa hàng', Tb(['#', 'Cửa hàng', 'Thực phẩm', 'Suất ăn'], top)) + '</div>';
  });

  /* ---------- Cảnh báo gian lận (tự tính từ dữ liệu có sẵn) ---------- */
  var FR = { filter: 'open' };
  var FR_TYPE = { high_cancel_rate: 'Tỷ lệ hủy cao', repeat_no_show: 'Vắng mặt lặp lại', long_pending_payment: 'Chờ thanh toán quá lâu', shared_ip: 'Nhiều tài khoản cùng IP' };
  var FR_SEV = { high: ['b-e', 'Cao'], medium: ['b-w', 'Trung bình'], low: ['b-m', 'Thấp'] };
  window.FR_FILTER = function (f) { FR.filter = f; rerender('risks'); };
  window.FR_HANDLE = function (key, status) {
    var n = prompt(status === 'handled' ? 'Ghi chú xử lý (tùy chọn):' : 'Lý do bỏ qua (tùy chọn):'); if (n === null) return;
    act(api('/admin/fraud-alerts/handle', { method: 'POST', body: n.trim() ? { key: key, status: status, note: n.trim() } : { key: key, status: status } }), status === 'handled' ? 'Đã ghi nhận xử lý' : 'Đã bỏ qua cảnh báo', ['risks']).then(refreshBadges);
  };
  if (!DEMO) {
    var oldRisks = pg.risks;
    Page('risks', 'Cảnh báo gian lận', '/admin/fraud-alerts', function (d) {
      var all = d.alerts, open = all.filter(function (a) { return a.status === 'open'; });
      var list = FR.filter === 'open' ? open : FR.filter === 'done' ? all.filter(function (a) { return a.status !== 'open'; }) : all;
      var chip = function (k, l, v) { return '<span class="b ' + (FR.filter === k ? 'b-ok' : 'b-m') + '" style="cursor:pointer;margin-right:6px" onclick="FR_FILTER(\'' + k + '\')">' + l + ' (' + v + ')</span>'; };
      var trs = list.map(function (a) {
        var sv = FR_SEV[a.severity] || ['b-m', a.severity];
        var st = a.status === 'open' ? '<span class="b b-w">Chưa xử lý</span>' : a.status === 'handled' ? '<span class="b b-ok">Đã xử lý</span>' : '<span class="b b-m">Đã bỏ qua</span>';
        var btns = a.status === 'open' ? '<button class="bt bt-s bt-p" onclick="FR_HANDLE(\'' + esc(a.key) + '\',\'handled\')">Xử lý</button> <button class="bt bt-s" onclick="FR_HANDLE(\'' + esc(a.key) + '\',\'dismissed\')">Bỏ qua</button>' : '<small style="color:var(--t3)">' + dt(a.handled_at) + (a.note ? ' · ' + esc(a.note) : '') + '</small>';
        return '<tr><td>' + esc(FR_TYPE[a.type] || a.type) + '</td><td><b>' + esc(a.subject_name) + '</b></td><td>' + esc(a.description) + '</td><td><span class="b ' + sv[0] + '">' + sv[1] + '</span></td><td>' + st + '</td><td>' + btns + '</td></tr>';
      }).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--t3);padding:18px">Không có cảnh báo trong mục này.</td></tr>';
      return note('<b>Cảnh báo tự tính từ dữ liệu có sẵn</b> (đơn 60 ngày, nhật ký đăng nhập 7 ngày). "Xử lý" ghi trạng thái và người xử lý vào Nhật ký hoạt động; không tự khóa ai. Muốn hạn chế khách hãy dùng mục Uy tín.') +
        Pn('Chưa phát hiện được', '<div style="padding:10px 14px;font-size:.78rem;color:var(--t2)">' + d.not_detected.map(function (t) { return '• ' + esc(t); }).join('<br>') + '</div>') +
        Pn('Cảnh báo gian lận', '<div style="padding:10px 14px">' + chip('open', 'Chưa xử lý', open.length) + chip('done', 'Đã xử lý', all.length - open.length) + chip('all', 'Tất cả', all.length) + '</div>' + Tb(['Loại', 'Đối tượng', 'Mô tả', 'Mức', 'Trạng thái', 'Xử lý'], trs), '<button class="bt bt-s" onclick="PAGE_RELOAD(\'risks\')">Tải lại</button>');
    });
    void oldRisks;
  }

  /* ---------- Uy tín: số liệu thật + khách bị hạn chế (Mở khóa) ---------- */
  if (!DEMO) {
    var LOCK_ALL = null;
    var baseLoad = loadLocked;
    loadLocked = function () {
      if (LOCK.loading) return; LOCK.loading = true; LOCK.err = '';
      api('/admin/users').then(function (d) {
        var now = Date.now(); LOCK_ALL = d.buyers || [];
        LOCK.rows = LOCK_ALL.filter(function (b) { return Number(b.points) < 40 || (b.red_ban_until && new Date(b.red_ban_until).getTime() > now); });
      }).catch(function (e) { LOCK.err = e.message || 'Không tải được danh sách.'; }).then(function () { LOCK.loading = false; rerender('reputation'); });
    };
    void baseLoad;
    pg.reputation = function () {
      if (!LOCK.rows && !LOCK.loading && !LOCK.err) loadLocked();
      var all = LOCK_ALL || [], now = Date.now();
      var tier = '<div class="G G4">' + K('Tin cậy (≥85)', all.filter(function (b) { return Number(b.points) >= 85; }).length, 'khách', 'var(--ok)') + K('Hạn chế (40–84)', all.filter(function (b) { return Number(b.points) >= 40 && Number(b.points) < 85; }).length, 'khách', 'var(--warn)') +
        K('Bị chặn (<40)', all.filter(function (b) { return Number(b.points) < 40; }).length, 'không đặt được hàng', 'var(--err)') + K('Khách bị hạn chế mua nhãn đỏ', all.filter(function (b) { return b.red_ban_until && new Date(b.red_ban_until).getTime() > now; }).length, 'đang trong thời gian khóa', 'var(--err)') + '</div>';
      return (LOCK_ALL ? tier : '') + lockedBlock() + note('Điểm khởi đầu 100. Mở khóa sẽ bỏ khóa nhãn đỏ và nâng điểm lên tối thiểu 40; thao tác được ghi vào Nhật ký hoạt động.');
    };
  }

  /* ---------- Nhật ký hoạt động (thật) ---------- */
  var ACT = { 'policy.update': 'Sửa chính sách đơn', 'automation.run': 'Chạy tác vụ tay', 'customer.unlock': 'Mở khóa khách', 'verification.approve': 'Duyệt hồ sơ', 'verification.reject': 'Từ chối hồ sơ', 'voucher.create': 'Tạo voucher', 'voucher.enable': 'Bật voucher', 'voucher.disable': 'Tắt voucher', 'fraud.handled': 'Xử lý cảnh báo', 'fraud.dismissed': 'Bỏ qua cảnh báo' };
  if (!DEMO) {
    Page('audits', 'Nhật ký hoạt động', '/admin/audit-log?limit=150', function (rows) {
      var trs = rows.map(function (a) {
        var d = a.detail || {}; var txt = d.reason || d.note || d.name || d.code || (a.action === 'policy.update' ? 'Xem chi tiết trong cấu hình' : '');
        return '<tr><td>' + dt(a.created_at) + '</td><td>' + esc(a.actor_name || '—') + '</td><td>' + esc(ACT[a.action] || a.action) + '</td><td>' + esc(a.target_type || '') + ' <small style="color:var(--t3)">' + esc(String(a.target_id || '').slice(0, 24)) + '</small></td><td>' + esc(txt) + '</td></tr>';
      }).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--t3);padding:18px">Chưa có thao tác nào được ghi.</td></tr>';
      return Pn('Nhật ký hoạt động của Admin', Tb(['Thời gian', 'Người thực hiện', 'Hành động', 'Đối tượng', 'Ghi chú'], trs), '<button class="bt bt-s" onclick="PAGE_RELOAD(\'audits\')">Tải lại</button>');
    });
  }

  /* ---------- Bảng điều khiển: dải 5 việc cần làm + số liệu thật ---------- */
  if (!DEMO) {
    var DASH = { work: null, fin: null, labels: null, esg: null, loading: false, err: '' };
    function loadDash() {
      if (DASH.loading) return; DASH.loading = true; DASH.err = '';
      var m = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 7);
      Promise.all([api('/admin/dashboard/work'), api('/admin/finance/summary').catch(function () { return null; }), api('/admin/labels').catch(function () { return null; }), api('/admin/esg?month=' + m).catch(function () { return null; })])
        .then(function (r) { DASH.work = r[0]; DASH.fin = r[1]; DASH.labels = r[2]; DASH.esg = r[3]; })
        .catch(function (e) { DASH.err = e.message || 'Không tải được bảng điều khiển.'; })
        .then(function () { DASH.loading = false; rerender('dashboard'); });
    }
    window.DASH_RELOAD = function () { DASH.work = null; DASH.err = ''; rerender('dashboard'); };
    var oldCounts = typeof sysCountsHtml === 'function' ? sysCountsHtml : null;
    pg.dashboard = function () {
      if (!DASH.work && !DASH.loading && !DASH.err) loadDash();
      if (DASH.err) return Pn('Bảng điều khiển', '<div class="W" style="padding:14px;color:var(--t3)">' + esc(DASH.err) + ' <button class="bt" onclick="DASH_RELOAD()">Thử lại</button></div>');
      if (!DASH.work) return Pn('Bảng điều khiển', '<div class="W" style="padding:14px;color:var(--t3)">Đang tải số liệu thật...</div>');
      var w = DASH.work;
      var tile = function (label, v, to, hint, color) { return '<div class="K" style="cursor:pointer" onclick="go(\'' + to + '\')"><div class="K-l">' + label + '</div><div class="K-v" style="color:' + (v ? color : 'var(--ok)') + '">' + v + '</div><div class="K-n">' + hint + '</div></div>'; };
      var held = DASH.fin && DASH.fin.wallets ? DASH.fin.wallets.escrow : null;
      var strip = '<div class="G G5">' + tile('Khiếu nại chờ Admin', w.complaints_waiting_admin, 'hub', 'Cần quyết định', 'var(--err)') + tile('Rút tiền / tài khoản chờ duyệt', w.withdrawals_pending, 'finance', 'Lệnh rút + tài khoản chờ xác minh', 'var(--warn)') +
        '<div class="K" style="cursor:pointer" onclick="go(\'finance\')"><div class="K-l">Tiền giữ chờ (escrow)</div><div class="K-v" style="color:var(--warn)">' + (held === null ? '—' : vnd(held)) + '</div><div class="K-n">Khách đã trả, chờ nhận hàng</div></div>' +
        tile('Khách bị khóa nhãn đỏ', w.customers_locked, 'reputation', 'Đang trong thời gian khóa', 'var(--warn)') + tile('Hồ sơ chờ xác minh', w.verification_pending, 'verification', 'Cửa hàng + tổ chức', 'var(--warn)') + '</div>' +
        (w.fraud_open ? note('Có <b>' + w.fraud_open + '</b> cảnh báo gian lận chưa xử lý. <a href="#" onclick="go(\'risks\');return false">Mở cảnh báo</a>') : '');
      var fin = DASH.fin, w2 = fin && fin.wallets || {};
      var money = fin ? '<div class="G G4">' + K('Giữ chờ (escrow)', vnd(w2.escrow), 'Tiền khách đã trả, chờ nhận hàng') + K('Đã giải ngân cửa hàng', vnd(fin.released_total), 'Tổng phần cửa hàng nhận') + K('Đã hoàn cho khách', vnd(fin.refunded_total), 'Hoàn sớm + khiếu nại') + K('Doanh thu nền tảng', vnd(w2.platform_revenue), 'Phí đã thu') + '</div>' : '';
      var lb = DASH.labels, lab = lb ? '<div class="G G3">' + ['green', 'yellow', 'red'].map(function (k) { return K(LCOL[k][0], lb.counts[k] || 0, 'lô đang bán', LCOL[k][1]); }).join('') + '</div>' : '';
      var e = DASH.esg, esg = e ? '<div class="G G3">' + K('Thực phẩm được cứu (tháng này)', Number(e.total.food_saved_kg).toLocaleString('vi-VN') + ' kg', e.has_data ? '' : 'Chưa có sự kiện trong tháng', 'var(--ok)') + K('Đơn hoàn tất tháng này', e.orders_completed, '') + K('Suất ăn tương đương', Number(e.total.meals_equivalent).toLocaleString('vi-VN'), '') + '</div>' : '';
      return (oldCounts ? oldCounts(true) : '') + note('<b>Việc cần làm hôm nay</b> (số liệu thật, bấm để mở). Các số mẫu của bản thiết kế chỉ hiện khi thêm <code>?demo=1</code> vào địa chỉ.') + strip +
        (money ? Pn('Tiền (mô phỏng)', money, '<button class="bt bt-s" onclick="DASH_RELOAD()">Tải lại</button>') : '') + (lab ? Pn('Tồn kho theo nhãn', lab) : '') + (esg ? Pn('Tác động tháng này', esg) : '');
    };
  }
})();
