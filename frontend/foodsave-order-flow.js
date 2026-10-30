/**
 * Người mua · quy trình đơn trả trước (lớp bổ sung cho FOODSAVE_USER.html).
 * - Chi tiết đơn: đếm ngược hạn thanh toán / hạn lấy hàng, hạn hủy miễn phí, lý do hủy, đơn vắng mặt.
 * - Hộp xác nhận hủy nói rõ hoàn tiền hay không hoàn tiền.
 * - Chat theo đơn với cửa hàng (chỉ văn bản, mở khi đơn đã thanh toán và còn hiệu lực).
 * - Chặn thêm sản phẩm nhãn đỏ vào giỏ khi đang bị khóa nhãn đỏ.
 * Chỉ gọi Backend API (window.FS.sync.request), không ghi thẳng database.
 */
(function () {
  "use strict";

  var ACTIVE = ["pending", "confirmed", "ready"];
  var CANCEL_TEXT = {
    payment_timeout: "Đơn tự hủy vì quá hạn thanh toán. Hàng đã trả về kho, bạn không bị tính lỗi.",
    customer_cancelled_unpaid: "Bạn đã hủy đơn khi chưa thanh toán.",
    customer_free_cancel: "Bạn đã hủy trong thời gian miễn phí. Đơn đã được hoàn tiền 100%.",
    late_cancel: "Bạn đã hủy sau thời gian miễn phí nên không được hoàn tiền.",
    store_cancelled: "Cửa hàng đã hủy đơn. Bạn được hoàn tiền 100%.",
    admin_cancelled: "FoodSave đã hủy đơn. Bạn được hoàn tiền 100%.",
    no_show: "Bạn không đến lấy hàng đúng hạn nên đơn không được hoàn tiền."
  };

  function el(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function hhmm(iso) { return new Date(iso).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }); }
  function currentOrder() { return (typeof orders !== "undefined" && orders || []).find(function (x) { return x.id === currentOrderId; }); }
  function api(path, options) { return window.FS && window.FS.sync && window.FS.sync.request ? window.FS.sync.request(path, options) : Promise.reject(new Error("Chưa kết nối được máy chủ")); }
  function say(message, kind) { if (typeof toast === "function") toast(message, kind || "info"); }

  /* ---------- một bộ đếm chung mỗi giây cho cả trang ---------- */
  function fmtCd(ms) {
    var s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
    return (h ? h + ":" : "") + String(m).padStart(2, "0") + ":" + String(x).padStart(2, "0");
  }
  function tick() {
    document.querySelectorAll("[data-fs-cd]").forEach(function (node) {
      var left = Number(node.getAttribute("data-fs-cd")) - Date.now();
      var out = node.querySelector(".t");
      if (left <= 0) { node.style.background = "#eef1ee"; node.style.color = "#667067"; if (out) out.textContent = "Đã hết hạn"; return; }
      var mins = left / 60000;
      node.style.background = mins <= 5 ? "#fde4e2" : mins <= 15 ? "#fff3cd" : "#e3f6ea";
      node.style.color = mins <= 5 ? "#b3261e" : mins <= 15 ? "#8a5a00" : "#14683b";
      if (out) out.textContent = fmtCd(left);
    });
  }
  setInterval(tick, 1000);
  function cd(ts, label) {
    return '<span data-fs-cd="' + new Date(ts).getTime() + '" style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:99px;font-weight:900;font-variant-numeric:tabular-nums"><i class="ti ti-clock"></i>' + esc(label) + ' <span class="t">--:--</span></span>';
  }

  /* ---------- chi tiết đơn ---------- */
  function policyBlock(o) {
    var html = "";
    var paid = o.paymentStatus === "paid";
    if (o.status === "awaiting_payment") {
      html += '<div style="padding:14px;border-radius:12px;background:#fff7e6;border:1px solid #f1d27a;margin-bottom:14px"><div style="font-weight:800;margin-bottom:8px">Chờ thanh toán</div>';
      if (o.payDeadline) html += cd(o.payDeadline, "Còn");
      html += '<div style="font-size:12px;margin-top:8px;color:var(--muted)">Quá hạn đơn sẽ tự hủy và hàng trả về kho (bạn không bị tính lỗi).</div>';
      if (window.__pendingOrder && window.__pendingOrder.id === o.id) html += '<button class="btn btn-primary btn-sm" style="margin-top:10px" onclick="navTo(\'payment-confirm\')">Tiếp tục thanh toán</button>';
      html += "</div>";
    } else if (paid && ACTIVE.indexOf(o.status) >= 0) {
      html += '<div style="padding:14px;border-radius:12px;background:#f3f8f4;border:1px solid #dcebe0;margin-bottom:14px">';
      if (o.pickupDeadline) html += '<div style="margin-bottom:8px">' + cd(o.pickupDeadline, "Còn lại để lấy hàng") + '<span style="font-size:12px;color:var(--muted);margin-left:8px">Hạn lấy: ' + hhmm(o.pickupDeadline) + "</span></div>";
      if (o.cancelFreeUntil) {
        var free = Date.now() <= new Date(o.cancelFreeUntil).getTime();
        html += '<div style="font-size:12.5px;font-weight:700;color:' + (free ? "#14683b" : "#b3261e") + '">' +
          (free ? "Hủy miễn phí đến " + hhmm(o.cancelFreeUntil) + " (hoàn 100%)" : "Đã quá thời gian hủy miễn phí: hủy bây giờ sẽ KHÔNG được hoàn tiền") + "</div>";
      }
      html += "</div>";
    } else if (o.status === "no_show") {
      html += '<div style="padding:14px;border-radius:12px;background:#fde4e2;color:#b3261e;font-weight:800;margin-bottom:14px">Đã quá hạn lấy hàng. Đơn không được hoàn tiền và bạn bị trừ 15 điểm uy tín.</div>';
    } else if (o.status === "cancelled") {
      var text = CANCEL_TEXT[o.cancelReason] || "Đơn đã được hủy.";
      html += '<div style="padding:14px;border-radius:12px;background:#f3f4f3;font-weight:700;margin-bottom:14px">' + esc(text) + "</div>";
    }
    return html;
  }

  function syncCancelButton(o) {
    var btn = el("btn-cancel-order");
    if (!btn) return;
    var can = o.status === "awaiting_payment" || ACTIVE.indexOf(o.status) >= 0;
    btn.disabled = !can;
    btn.style.opacity = can ? "" : ".4";
    btn.style.pointerEvents = can ? "" : "none";
    btn.innerHTML = can ? '<i class="ti ti-x"></i> Hủy đơn hàng'
      : o.status === "completed" ? '<i class="ti ti-lock"></i> Đã nhận hàng, không thể hủy'
      : o.status === "no_show" ? '<i class="ti ti-user-off"></i> Đã quá hạn lấy hàng'
      : '<i class="ti ti-x"></i> Đã hủy';
  }

  function augmentOrderDetail() {
    var o = currentOrder();
    if (!o) return;
    var timeline = el("od-timeline");
    if (timeline && timeline.parentElement) {
      var box = el("od-policy");
      if (!box) {
        box = document.createElement("div");
        box.id = "od-policy";
        timeline.parentElement.insertBefore(box, timeline);
      }
      box.innerHTML = policyBlock(o) + complaintBlock(o);
    }
    // Chưa thanh toán hoặc vắng mặt: không hiện mã QR nhận hàng
    var qr = el("od-qr-card");
    if (qr && (o.status === "awaiting_payment" || o.status === "no_show")) qr.style.display = "none";
    var payLabel = el("od-pay");
    // Giữ nguyên phần tử #od-pay (lần vẽ sau còn ghi vào nó), chỉ đổi câu dẫn
    if (payLabel && payLabel.previousSibling && payLabel.previousSibling.nodeType === 3) {
      payLabel.previousSibling.nodeValue = o.paymentStatus === "paid" ? "Đã thanh toán qua " : "Chưa thanh toán, dự kiến qua ";
    }
    syncCancelButton(o);
    syncComplaintButton(o);
    loadComplaints(false);
    renderChat(o);
    tick();
  }

  var baseRenderOrderDetail = window.renderOrderDetail;
  window.renderOrderDetail = function () {
    if (typeof baseRenderOrderDetail === "function") baseRenderOrderDetail.apply(this, arguments);
    try { augmentOrderDetail(); } catch (error) { console.warn("[FoodSave] Không dựng được khối hạn đơn hàng:", error); }
  };

  /* ---------- hủy đơn: nói rõ hoàn tiền hay không ---------- */
  window.cancelOrder = function () {
    var o = currentOrder();
    var modal = el("cancel-modal");
    if (!modal) return;
    var body = modal.querySelector(".modal-body");
    if (body && o) {
      var note = el("cancel-policy-note");
      if (!note) { note = document.createElement("div"); note.id = "cancel-policy-note"; body.insertBefore(note, body.firstChild); }
      var paid = o.paymentStatus === "paid";
      var free = !paid || !o.cancelFreeUntil || Date.now() <= new Date(o.cancelFreeUntil).getTime();
      note.style.cssText = "padding:12px 14px;border-radius:10px;margin-bottom:12px;font-weight:700;font-size:13px;line-height:1.6;background:" + (free ? "#e3f6ea;color:#14683b" : "#fde4e2;color:#b3261e");
      note.textContent = !paid ? "Đơn chưa thanh toán nên hủy không mất phí."
        : free ? "Bạn đang trong thời gian hủy miễn phí: sẽ được hoàn tiền 100%."
        : "Đã quá thời gian hủy miễn phí: nếu hủy bây giờ bạn KHÔNG được hoàn tiền và bị trừ 5 điểm uy tín.";
    }
    modal.classList.add("active");
  };

  /* ---------- chat theo đơn ---------- */
  var chat = { orderId: null, timer: null, loading: false, lastKey: "" };

  function chatEligible(o) {
    return o && o.backendId && o.paymentStatus === "paid" && o.status !== "awaiting_payment";
  }

  function chatHost() {
    var host = el("od-chat");
    if (host) return host;
    var anchor = el("btn-cancel-order");
    if (!anchor || !anchor.parentElement) return null;
    host = document.createElement("div");
    host.id = "od-chat";
    host.className = "card";
    host.style.cssText = "padding:16px;margin-top:14px";
    anchor.parentElement.parentElement.insertBefore(host, anchor.parentElement);
    return host;
  }

  function renderChat(o) {
    var host = chatHost();
    if (!host) return;
    if (!chatEligible(o)) {
      host.style.display = "none";
      stopChat();
      return;
    }
    host.style.display = "";
    if (chat.orderId !== o.backendId) { chat.orderId = o.backendId; chat.lastKey = ""; host.innerHTML = ""; }
    startChat();
    loadChat();
  }

  function startChat() {
    if (chat.timer) return;
    chat.timer = setInterval(function () {
      if (document.hidden || !document.querySelector("#page-order-detail.active")) return;
      loadChat();
    }, 6000);
  }
  function stopChat() { if (chat.timer) { clearInterval(chat.timer); chat.timer = null; } }

  function loadChat() {
    if (chat.loading || !chat.orderId) return;
    chat.loading = true;
    var id = chat.orderId;
    api("/orders/" + encodeURIComponent(id) + "/messages")
      .then(function (data) {
        if (id !== chat.orderId) return;
        paintChat(data.messages || [], !!data.can_send);
        api("/orders/" + encodeURIComponent(id) + "/messages/read", { method: "POST" }).catch(function () {});
      })
      .catch(function () { /* mất kết nối: giữ nguyên khung chat */ })
      .then(function () { chat.loading = false; });
  }

  function paintChat(messages, canSend) {
    var host = el("od-chat");
    if (!host) return;
    var key = messages.map(function (m) { return m.id; }).join(",") + "|" + canSend;
    if (key === chat.lastKey) return;
    chat.lastKey = key;
    var typed = el("od-chat-input") ? el("od-chat-input").value : "";
    var rows = messages.map(function (m) {
      if (m.sender_role === "system") return '<div style="text-align:center;font-size:11.5px;color:var(--muted);margin:6px 0">' + esc(m.body) + "</div>";
      var mine = m.sender_role === "customer";
      return '<div style="display:flex;justify-content:' + (mine ? "flex-end" : "flex-start") + '"><div style="max-width:82%;padding:8px 12px;border-radius:12px;font-size:13px;line-height:1.5;background:' + (mine ? "var(--orange-100)" : "var(--soft)") + '">' + esc(m.body) +
        '<div style="font-size:10px;color:var(--muted);margin-top:2px">' + (mine ? "Bạn" : "Cửa hàng") + " · " + hhmm(m.created_at) + "</div></div></div>";
    }).join("");
    host.innerHTML = '<h3 style="font-size:15px;margin-bottom:10px"><i class="ti ti-messages"></i> Trao đổi với cửa hàng</h3>' +
      '<div id="od-chat-list" style="display:flex;flex-direction:column;gap:8px;max-height:260px;overflow-y:auto;padding-right:4px">' + (rows || '<div style="text-align:center;font-size:12px;color:var(--muted)">Chưa có tin nhắn.</div>') + "</div>" +
      (canSend
        ? '<div style="display:flex;gap:8px;margin-top:10px"><input id="od-chat-input" maxlength="500" placeholder="Nhập tin nhắn (tối đa 500 ký tự)…" style="flex:1;border:1px solid var(--line);border-radius:10px;padding:9px 12px;font-size:13px"><button class="btn btn-primary btn-sm" id="od-chat-send">Gửi</button></div>'
        : '<div style="margin-top:10px;font-size:11.5px;color:var(--muted)">Đơn đã kết thúc: cuộc trò chuyện chỉ còn xem lại.</div>');
    var list = el("od-chat-list");
    if (list) list.scrollTop = list.scrollHeight;
    var input = el("od-chat-input");
    if (input) {
      input.value = typed;
      input.addEventListener("keydown", function (event) { if (event.key === "Enter") { event.preventDefault(); sendChat(); } });
    }
    var send = el("od-chat-send");
    if (send) send.addEventListener("click", sendChat);
  }

  function sendChat() {
    var input = el("od-chat-input");
    var text = input ? input.value.trim() : "";
    if (!text || !chat.orderId) return;
    var send = el("od-chat-send");
    if (send) send.disabled = true;
    api("/orders/" + encodeURIComponent(chat.orderId) + "/messages", { method: "POST", body: { body: text } })
      .then(function () { if (input) input.value = ""; chat.lastKey = ""; loadChat(); })
      .catch(function (error) { say((error && error.message) || "Chưa gửi được tin nhắn", "warn"); })
      .then(function () { if (send) send.disabled = false; });
  }

  // Nút "Liên hệ cửa hàng" cuộn tới khung chat
  document.addEventListener("click", function (event) {
    var target = event.target && event.target.closest ? event.target.closest("button") : null;
    if (!target || !/Liên hệ cửa hàng/.test(target.textContent || "")) return;
    var host = el("od-chat");
    if (host && host.style.display !== "none") host.scrollIntoView({ behavior: "smooth", block: "center" });
    else say("Cuộc trò chuyện mở sau khi bạn thanh toán", "info");
  });

  /* ---------- khóa nhãn đỏ: chặn từ bước thêm vào giỏ ---------- */
  var baseAddToCart = window.addToCart;
  if (typeof baseAddToCart === "function") {
    window.addToCart = function (productInput) {
      var trust = window.CUSTOMER_TRUST;
      var product = typeof resolveProductForFlow === "function" ? resolveProductForFlow(productInput) : null;
      if (trust && trust.red_banned && product && product.label === "red") {
        say("Bạn đang bị khóa mua sản phẩm nhãn đỏ đến " + new Date(trust.red_ban_until).toLocaleDateString("vi-VN") + ". Bạn vẫn mua được nhãn xanh và vàng.", "warn");
        return;
      }
      return baseAddToCart.apply(this, arguments);
    };
  }

  /* ---------- Khiếu nại (Đợt 3) ---------- */
  var CP = { list: [], at: 0, loading: false, files: [], uploading: false, sending: false };
  var CP_REASONS = [["wrong_item", "Giao sai sản phẩm so với đơn"], ["spoiled_expired", "Hư hỏng, mùi lạ hoặc hết hạn sử dụng"], ["missing_items", "Thiếu sản phẩm so với đơn"], ["other", "Lý do khác"]];
  var CP_REASON_TEXT = { wrong_item: "Giao sai sản phẩm", spoiled_expired: "Hư hỏng / hết hạn", missing_items: "Thiếu sản phẩm", other: "Lý do khác" };
  var MAX_PHOTOS = 5;

  function money(n) { return Number(n || 0).toLocaleString("vi-VN") + "đ"; }
  function complaintFor(o) { return o && o.backendId ? CP.list.find(function (c) { return c.order_id === o.backendId; }) : null; }
  function deadlineMs(o) { return o && o.complaintDeadlineAt ? new Date(o.complaintDeadlineAt).getTime() : 0; }
  function canComplain(o) { return !!(o && o.backendId && o.status === "completed" && deadlineMs(o) > Date.now() && !complaintFor(o)); }

  function loadComplaints(force) {
    if (CP.loading || (!force && Date.now() - CP.at < 20000)) return;
    CP.loading = true;
    api("/orders/complaints/list").then(function (rows) {
      var before = JSON.stringify(CP.list);
      CP.list = Array.isArray(rows) ? rows : [];
      CP.at = Date.now();
      if (before !== JSON.stringify(CP.list) && document.querySelector("#page-order-detail.active")) { try { augmentOrderDetail(); } catch (e) {} }
    }).catch(function () { CP.at = Date.now(); }).then(function () { CP.loading = false; });
  }

  function complaintBlock(o) {
    if (!o || o.status !== "completed") return "";
    var c = complaintFor(o);
    if (c) {
      var statusText = { open: "Đang chờ cửa hàng phản hồi", in_review: "FoodSave đang xem xét", resolved: "Đã giải quyết", rejected: "Đã bị bác bỏ" }[c.status] || c.status;
      var color = c.status === "resolved" ? "#14683b" : c.status === "rejected" ? "#b3261e" : "#8a5a00";
      var html = '<div id="od-complaint" style="padding:14px;border-radius:12px;background:#fff;border:1px solid var(--line);margin-bottom:14px"><div style="font-weight:800;margin-bottom:6px"><i class="ti ti-message-report"></i> Khiếu nại của bạn · <span style="color:' + color + '">' + esc(statusText) + "</span></div>" +
        '<div style="font-size:12.5px;line-height:1.7"><div><b>Lý do:</b> ' + esc(CP_REASON_TEXT[c.reason_code] || "Khiếu nại cũ") + " · " + (c.image_urls || []).length + " ảnh</div>";
      if (c.status === "open" && c.response_due_at) html += '<div style="margin-top:6px">' + cd(c.response_due_at, "Cửa hàng còn") + "</div>";
      if (c.store_response) html += '<div style="margin-top:6px;padding:8px 10px;background:var(--soft);border-radius:8px"><b>Cửa hàng phản hồi:</b> ' + esc(c.store_response) + "</div>";
      if (c.store_response_action === "accept") html += '<div style="margin-top:6px;color:#14683b;font-weight:700">Cửa hàng đồng ý hoàn tiền.</div>';
      if (c.status === "resolved" || c.status === "rejected") {
        html += '<div style="margin-top:6px;padding:8px 10px;background:' + (c.status === "resolved" ? "#e3f6ea" : "#fde4e2") + ';border-radius:8px"><b>Kết quả:</b> ' + esc(c.resolution || statusText) +
          (Number(c.refund_cents) > 0 ? '<div style="font-weight:800;margin-top:4px">Số tiền hoàn: ' + money(c.refund_cents) + "</div>" : "") + "</div>";
      }
      return html + "</div></div>";
    }
    var dl = deadlineMs(o);
    if (dl > Date.now()) {
      return '<div id="od-complaint" style="padding:14px;border-radius:12px;background:#fff7e6;border:1px solid #f1d27a;margin-bottom:14px"><div style="font-weight:800;margin-bottom:6px"><i class="ti ti-message-report"></i> Có vấn đề với đơn hàng?</div>' + cd(dl, "Còn lại để báo vấn đề") +
        '<div style="font-size:12px;margin-top:8px;color:var(--muted)">Bạn cần chọn lý do và gửi ít nhất 1 ảnh. Cửa hàng có 12 giờ phản hồi; nếu không đồng ý, FoodSave sẽ quyết định.</div></div>';
    }
    if (dl > 0) return '<div id="od-complaint" style="padding:12px 14px;border-radius:12px;background:#f3f4f3;margin-bottom:14px;font-size:12.5px;font-weight:700">Đã hết thời gian báo vấn đề cho đơn này.</div>';
    return "";
  }

  function syncComplaintButton(o) {
    var btn = document.querySelector('button[onclick="openComplaint()"]');
    if (!btn) return;
    var c = complaintFor(o);
    var can = canComplain(o);
    btn.disabled = !(can || c);
    btn.style.opacity = can || c ? "" : ".45";
    btn.style.pointerEvents = can || c ? "" : "none";
    btn.innerHTML = c ? '<i class="ti ti-message-report"></i> Xem khiếu nại'
      : can ? '<i class="ti ti-message-report"></i> Khiếu nại'
      : o && o.status === "completed" ? '<i class="ti ti-clock-off"></i> Hết hạn khiếu nại'
      : '<i class="ti ti-message-report"></i> Khiếu nại (sau khi nhận hàng)';
  }

  function evidenceClient() {
    if (window.FoodSaveAuth && typeof window.FoodSaveAuth.getSupabaseClient === "function") return window.FoodSaveAuth.getSupabaseClient();
    return window.foodsaveSupabase || null;
  }

  function renderUpload() {
    var box = el("cp-upload");
    if (!box) return;
    box.onclick = null; box.removeAttribute("onclick");
    box.style.cursor = "default"; box.style.padding = "14px"; box.style.textAlign = "left"; box.style.borderColor = "var(--line)"; box.style.background = "var(--soft)";
    var thumbs = CP.files.map(function (f, i) {
      return '<span style="position:relative;display:inline-block;margin:4px"><img src="' + esc(f.url) + '" alt="Ảnh minh chứng" style="width:64px;height:64px;object-fit:cover;border-radius:8px;border:1px solid var(--line)"><button type="button" data-rm="' + i + '" style="position:absolute;top:-6px;right:-6px;width:20px;height:20px;border-radius:50%;background:#b3261e;color:#fff;border:0;cursor:pointer;line-height:1">×</button></span>';
    }).join("");
    box.innerHTML = '<div style="font-size:12.5px;font-weight:700;margin-bottom:6px">Ảnh minh chứng <span style="color:#b3261e">*</span> (' + CP.files.length + "/" + MAX_PHOTOS + ", bắt buộc ít nhất 1 ảnh)</div>" + (thumbs ? "<div>" + thumbs + "</div>" : "") +
      (CP.files.length < MAX_PHOTOS ? '<label style="display:inline-flex;align-items:center;gap:6px;padding:8px 12px;border-radius:10px;background:#fff;border:1px dashed var(--green-700);cursor:pointer;font-size:12.5px;font-weight:800"><i class="ti ti-photo-plus"></i>' + (CP.uploading ? "Đang tải ảnh..." : "Chọn ảnh") + '<input id="cp-file" type="file" accept="image/jpeg,image/png,image/webp" multiple style="display:none"' + (CP.uploading ? " disabled" : "") + "></label>" : "") +
      '<div style="font-size:10.5px;color:var(--muted);margin-top:6px">JPG / PNG / WEBP · tối đa 5MB mỗi ảnh</div>';
    var input = el("cp-file");
    if (input) input.addEventListener("change", function () { handleFiles(input.files); });
    box.querySelectorAll("button[data-rm]").forEach(function (b) { b.addEventListener("click", function () { CP.files.splice(Number(b.getAttribute("data-rm")), 1); renderUpload(); }); });
  }

  async function handleFiles(fileList) {
    var client = evidenceClient();
    if (!client) { say("Chưa kết nối được kho ảnh, vui lòng tải lại trang", "warn"); return; }
    var files = Array.prototype.slice.call(fileList || []).slice(0, MAX_PHOTOS - CP.files.length);
    CP.uploading = true; renderUpload();
    try {
      for (var i = 0; i < files.length; i += 1) {
        var file = files[i];
        if (["image/jpeg", "image/png", "image/webp"].indexOf(file.type) < 0) { say("Chỉ nhận ảnh JPG, PNG hoặc WEBP", "warn"); continue; }
        if (file.size > 5 * 1024 * 1024) { say("Ảnh quá 5MB: " + file.name, "warn"); continue; }
        var up = await api("/orders/complaints/upload-url", { method: "POST", body: { content_type: file.type } });
        var result = await client.storage.from("partner-assets").uploadToSignedUrl(up.path, up.token, file, { contentType: file.type });
        if (result && result.error) throw new Error("Không tải được ảnh lên, vui lòng thử lại");
        CP.files.push({ url: up.public_url });
      }
    } catch (error) {
      say((error && error.message) || "Không tải được ảnh", "error");
    } finally {
      CP.uploading = false; renderUpload();
    }
  }

  window.openComplaint = function () {
    var o = currentOrder();
    if (!o) { say("Không tìm thấy đơn hàng", "info"); return; }
    var existing = complaintFor(o);
    if (existing) { var block = el("od-complaint"); if (block) block.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
    if (!canComplain(o)) { say(o.status !== "completed" ? "Chỉ khiếu nại được đơn đã hoàn tất (đã nhận hàng)" : "Đã hết thời gian báo vấn đề cho đơn này", "info"); return; }
    el("cp-order-id").textContent = o.id;
    el("cp-products").textContent = (o.items || []).map(function (it) { var p = typeof productFromCartItem === "function" ? productFromCartItem(it) : null; return p ? p.name : ""; }).filter(Boolean).join(", ") || "—";
    el("cp-pay-time").textContent = o.date || "—";
    el("cp-pickup-time").textContent = o.complaintDeadlineAt ? "Báo vấn đề trước " + hhmm(o.complaintDeadlineAt) : "—";
    var sel = el("cp-type");
    if (sel) sel.innerHTML = CP_REASONS.map(function (r) { return '<option value="' + r[0] + '">' + r[1] + "</option>"; }).join("");
    el("cp-desc").value = "";
    CP.files = [];
    renderUpload();
    el("complaint-modal").classList.add("active");
  };

  window.submitComplaint = async function () {
    if (CP.sending || CP.uploading) return;
    var o = currentOrder();
    var desc = el("cp-desc").value.trim();
    if (!o || !o.backendId) { say("Không tìm thấy đơn hàng để khiếu nại", "info"); return; }
    if (desc.length < 10) { say("Vui lòng mô tả vấn đề tối thiểu 10 ký tự", "info"); return; }
    if (CP.files.length < 1) { say("Cần gửi ít nhất 1 ảnh minh chứng", "info"); return; }
    CP.sending = true;
    try {
      await api("/orders/complaints", { method: "POST", body: { order_id: o.backendId, reason_code: el("cp-type").value, issue: desc, image_urls: CP.files.map(function (f) { return f.url; }) } });
      el("complaint-modal").classList.remove("active");
      CP.files = [];
      say("Đã gửi khiếu nại · cửa hàng có 12 giờ để phản hồi, bạn sẽ nhận thông báo", "info");
      CP.at = 0; loadComplaints(true);
    } catch (error) {
      say((error && error.message) || "Chưa gửi được khiếu nại, vui lòng thử lại", "error");
      if (error && (error.code === "COMPLAINT_WINDOW_CLOSED" || error.code === "COMPLAINT_ALREADY_EXISTS")) { el("complaint-modal").classList.remove("active"); CP.at = 0; loadComplaints(true); }
    } finally {
      CP.sending = false;
    }
  };


  /* ---------- Deep link từ thông báo đẩy: #order=<id> | #complaint=<id> ---------- */
  var DEEP = { tries: 0, timer: null };
  function openOrderByBackendId(backendId) {
    var list = typeof orders !== "undefined" ? orders : [];
    var o = list.find(function (x) { return x.backendId === backendId; });
    if (!o) return false;
    currentOrderId = o.id;
    if (typeof navTo === "function") navTo("order-detail");
    return true;
  }
  function openFromHash() {
    var hash = String(window.location.hash || "");
    var order = /^#order=([0-9a-f-]{36})$/i.exec(hash);
    var complaint = /^#complaint=([0-9a-f-]{36})$/i.exec(hash);
    if (!order && !complaint) return;
    var attempt = function () {
      DEEP.tries += 1;
      var resolve = order
        ? Promise.resolve(order[1])
        : api("/orders/complaints/list").then(function (rows) { var c = (rows || []).find(function (r) { return r.id === complaint[1]; }); return c ? c.order_id : null; });
      resolve.then(function (orderId) {
        if (orderId && openOrderByBackendId(orderId)) { try { history.replaceState(null, "", window.location.pathname + window.location.search); } catch (e) {} DEEP.tries = 0; return; }
        // đơn chưa tải xong (hoặc chưa đăng nhập): thử lại tối đa ~30 giây
        if (DEEP.tries < 30) DEEP.timer = setTimeout(attempt, 1000);
      }).catch(function () { if (DEEP.tries < 30) DEEP.timer = setTimeout(attempt, 1000); });
    };
    clearTimeout(DEEP.timer); DEEP.tries = 0; attempt();
  }
  window.addEventListener("hashchange", openFromHash);
  setTimeout(openFromHash, 1200);

})();
