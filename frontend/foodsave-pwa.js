/**
 * FoodSave PWA (người mua + tình nguyện viên): đăng ký service worker, nút "Cài ứng dụng", nút "Bật thông báo" (Web Push).
 *   FSPwa.init({ role: "customer" | "volunteer", request: function (path, options) { return Promise<data>; } })
 * - Không tự hỏi quyền thông báo lúc mở trang: chỉ hỏi khi người dùng BẤM nút.
 * - Mọi lỗi đăng ký / quyền chỉ hiện thông báo nhỏ, KHÔNG làm hỏng trang.
 * - Cổng cửa hàng và tổ chức từ thiện KHÔNG dùng file này (không có push).
 * Giới hạn: iPhone chỉ nhận push khi iOS >= 16.4 VÀ đã "Thêm vào Màn hình chính" bằng Safari.
 */
(function () {
  "use strict";

  var state = { client: "web", ui: true, role: null, request: null, registration: null, installPrompt: null, publicKey: null, enabled: false, subscribed: false, busy: false, bar: null };

  function isStandalone() {
    try { return (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || window.navigator.standalone === true; } catch (e) { return false; }
  }
  function isIOS() {
    var ua = window.navigator.userAgent || "";
    return /iphone|ipad|ipod/i.test(ua) || (window.navigator.platform === "MacIntel" && window.navigator.maxTouchPoints > 1);
  }
  function pushSupported() { return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window; }

  function say(message) {
    try {
      var bar = document.createElement("div");
      bar.textContent = message;
      bar.setAttribute("role", "status");
      bar.style.cssText = "position:fixed;left:50%;bottom:72px;transform:translateX(-50%);max-width:88vw;background:#14291f;color:#fff;padding:10px 16px;border-radius:12px;font:600 13px/1.4 system-ui,sans-serif;z-index:10001;box-shadow:0 8px 24px rgba(0,0,0,.25)";
      document.body.appendChild(bar);
      setTimeout(function () { bar.remove(); }, 4200);
    } catch (e) { /* bỏ qua */ }
  }

  function urlBase64ToUint8Array(base64) {
    var padding = "=".repeat((4 - (base64.length % 4)) % 4);
    var raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
    return out;
  }

  function currentSubscription() {
    if (!state.registration || !state.registration.pushManager) return Promise.resolve(null);
    return state.registration.pushManager.getSubscription().catch(function () { return null; });
  }

  function sendToServer(subscription) {
    var json = subscription.toJSON();
    return state.request("/push/subscribe", { method: "POST", body: { endpoint: json.endpoint, keys: { p256dh: json.keys && json.keys.p256dh, auth: json.keys && json.keys.auth }, client: state.client } });
  }

  /* ---------- giao diện: hai nút nhỏ ở góc dưới bên trái ---------- */
  function pill(id, text) {
    var b = document.createElement("button");
    b.type = "button"; b.id = id; b.textContent = text;
    b.style.cssText = "display:none;align-items:center;gap:6px;background:#006C4D;color:#fff;border:0;border-radius:999px;padding:9px 14px;font:700 12.5px/1 system-ui,sans-serif;box-shadow:0 6px 18px rgba(0,0,0,.22);cursor:pointer";
    return b;
  }
  function ensureBar() {
    if (state.ui === false) return null;   // app người mua tự vẽ nút bật/tắt trong màn Cài đặt thông báo
    if (state.bar) return state.bar;
    var bar = document.createElement("div");
    bar.id = "fs-pwa-bar";
    bar.style.cssText = "position:fixed;left:12px;bottom:12px;z-index:9998;display:flex;flex-direction:column;gap:8px;align-items:flex-start";
    var install = pill("fs-pwa-install", "📲 Cài ứng dụng");
    var push = pill("fs-pwa-push", "🔔 Bật thông báo");
    install.addEventListener("click", onInstall);
    push.addEventListener("click", onPushClick);
    bar.appendChild(install); bar.appendChild(push);
    document.body.appendChild(bar);
    state.bar = bar;
    return bar;
  }
  function show(id, visible, text) {
    var node = document.getElementById(id);
    if (!node) return;
    node.style.display = visible ? "inline-flex" : "none";
    if (text) node.textContent = text;
  }

  function refreshUi() {
    ensureBar();
    // Nút cài: có sự kiện cài (Chrome Android) hoặc iPhone chưa cài; ẩn khi đã chạy dạng ứng dụng
    show("fs-pwa-install", !isStandalone() && (!!state.installPrompt || isIOS()));
    // Nút thông báo
    if (!state.enabled) { show("fs-pwa-push", false); return; }
    if (!pushSupported()) { show("fs-pwa-push", isIOS() && !isStandalone(), "🔔 Bật thông báo"); return; }
    if (Notification.permission === "denied") { show("fs-pwa-push", true, "🔕 Thông báo đang bị chặn"); return; }
    show("fs-pwa-push", true, state.subscribed ? "🔔 Thông báo: Bật (bấm để tắt)" : "🔔 Bật thông báo");
  }

  /* ---------- cài ứng dụng ---------- */
  function onInstall() {
    if (state.installPrompt) {
      var promptEvent = state.installPrompt;
      state.installPrompt = null;
      promptEvent.prompt();
      if (promptEvent.userChoice) promptEvent.userChoice.then(function () { refreshUi(); }).catch(function () { refreshUi(); });
      return;
    }
    if (isIOS()) say("Trên iPhone: bấm nút Chia sẻ (ô vuông có mũi tên) rồi chọn \"Thêm vào Màn hình chính\".");
  }

  /* ---------- thông báo đẩy ---------- */
  async function onPushClick() {
    if (state.busy) return;
    if (!pushSupported()) {
      say("iPhone chỉ nhận thông báo khi dùng iOS 16.4 trở lên và đã \"Thêm vào Màn hình chính\" bằng Safari. Cài ứng dụng rồi mở lại từ màn hình chính để bật.");
      return;
    }
    if (Notification.permission === "denied") {
      say("Thông báo đang bị chặn. Hãy mở cài đặt trình duyệt / ứng dụng, cho phép thông báo cho FoodSave rồi tải lại trang.");
      return;
    }
    state.busy = true;
    try {
      var existing = await currentSubscription();
      if (existing && state.subscribed) { await disable(existing); } else { await enable(); }
    } catch (error) {
      say((error && error.message) || "Chưa bật được thông báo, vui lòng thử lại.");
    } finally {
      state.busy = false;
      refreshUi();
    }
  }

  async function enable() {
    if (!state.registration) throw new Error("Chưa sẵn sàng, hãy tải lại trang rồi thử lại.");
    if (!state.publicKey) throw new Error("Thông báo chưa được bật trên máy chủ.");
    var permission = await Notification.requestPermission();
    if (permission !== "granted") { say("Bạn chưa cho phép thông báo."); return; }
    var subscription = await currentSubscription();
    if (!subscription) {
      subscription = await state.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(state.publicKey) });
    }
    try {
      await sendToServer(subscription);
    } catch (error) {
      // Máy chủ từ chối (ví dụ chưa đăng nhập): bỏ đăng ký ở trình duyệt để không bị lệch
      try { await subscription.unsubscribe(); } catch (e) { /* bỏ qua */ }
      state.subscribed = false;
      throw new Error(error && error.status === 401 ? "Hãy đăng nhập rồi bật thông báo." : ((error && error.message) || "Máy chủ chưa lưu được thiết bị."));
    }
    state.subscribed = true;
    say("Đã bật thông báo cho thiết bị này.");
  }

  async function disable(subscription) {
    var endpoint = subscription.endpoint;
    try { await state.request("/push/unsubscribe", { method: "POST", body: { endpoint: endpoint } }); } catch (e) { /* vẫn gỡ phía trình duyệt */ }
    await subscription.unsubscribe();
    state.subscribed = false;
    say("Đã tắt thông báo cho thiết bị này.");
  }

  // Đã bật từ trước (hoặc vừa đăng nhập): gửi lại thiết bị lên máy chủ, âm thầm (upsert nên không trùng)
  var lastSync = 0;
  function syncQuietly() {
    if (!pushSupported() || Notification.permission !== "granted" || Date.now() - lastSync < 5 * 60 * 1000) return;
    lastSync = Date.now();
    currentSubscription().then(function (subscription) {
      if (!subscription) { state.subscribed = false; refreshUi(); return null; }
      state.subscribed = true; refreshUi();
      return sendToServer(subscription).catch(function () { /* chưa đăng nhập: bỏ qua */ });
    });
  }

  /* ---------- mở đúng nơi khi bấm thông báo ---------- */
  function onSwMessage(event) {
    var data = event && event.data;
    if (data && data.type === "fs-open" && typeof data.hash === "string" && data.hash) {
      try { window.location.hash = data.hash; } catch (e) { /* bỏ qua */ }
    }
  }

  function init(config) {
    state.role = config && config.role;
    state.client = config && config.client === "app" ? "app" : "web";
    state.ui = !(config && config.ui === false);
    state.request = config && config.request;
    if (!state.request) return;
    try {
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ensureBar); else ensureBar();

      window.addEventListener("beforeinstallprompt", function (event) { event.preventDefault(); state.installPrompt = event; refreshUi(); });
      window.addEventListener("appinstalled", function () { state.installPrompt = null; refreshUi(); });

      if (!("serviceWorker" in navigator)) { refreshUi(); return; }
      navigator.serviceWorker.addEventListener("message", onSwMessage);
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).then(function () { return navigator.serviceWorker.ready; }).then(function (registration) {
        state.registration = registration;
        return state.request("/push/public-key", { method: "GET" }).catch(function () { return null; });
      }).then(function (info) {
        state.publicKey = info && info.public_key ? info.public_key : null;
        state.enabled = !!(info && info.enabled && state.publicKey);
        return currentSubscription();
      }).then(function (subscription) {
        state.subscribed = !!subscription && pushSupported() && Notification.permission === "granted";
        refreshUi();
        setTimeout(syncQuietly, 2500);
      }).catch(function (error) {
        // Đăng ký lỗi (ví dụ mở file:// hoặc HTTP): trang vẫn chạy bình thường
        if (window.console) console.warn("[FoodSave PWA] Không đăng ký được service worker:", error && error.message);
        refreshUi();
      });
      window.addEventListener("focus", syncQuietly);
    } catch (error) {
      if (window.console) console.warn("[FoodSave PWA] Lỗi khởi tạo:", error && error.message);
    }
  }

  window.FSPwa = {
    init: init, sync: syncQuietly, _state: state,
    /* Dành cho app người mua (giao diện riêng): trạng thái + bật/tắt thông báo đẩy cho thiết bị này */
    info: function () { return { supported: pushSupported(), serverEnabled: state.enabled, subscribed: state.subscribed, permission: ("Notification" in window) ? Notification.permission : "unsupported", standalone: isStandalone(), ios: isIOS() }; },
    pushEnable: function () { return enable().then(function () { return state.subscribed; }); },
    pushDisable: function () { return currentSubscription().then(function (s) { return s ? disable(s) : null; }); }
  };
})();
