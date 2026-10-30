/**
 * Cài app FoodSave từ WEB (Đợt 4). KHÔNG tự chuyển hướng ai sang app.
 *  - Điện thoại + chưa cài: thanh nhỏ ở cuối màn hình "Cài app FoodSave để dùng tiện hơn" (nút Cài, nút đóng; đóng = để sau 7 ngày, nhớ bằng localStorage).
 *  - Mục "Cài đặt app" cố định (chân trang / menu tài khoản): phần tử có thuộc tính data-fs-install, hiện cả trên máy tính nếu trình duyệt hỗ trợ.
 *  - Android/Chrome: gọi beforeinstallprompt.prompt() (sự kiện được lưu từ trước). iPhone Safari không có hộp thoại: hiện hướng dẫn "Chia sẻ → Thêm vào MH chính".
 *  - Đã cài (appinstalled, hoặc đang chạy chế độ standalone): ẩn banner và mục cài đặt.
 * Trang web phải trỏ <link rel="manifest"> tới manifest-app.webmanifest để app cài ra mở FOODSAVE_APP.html (start_url).
 */
(function () {
  "use strict";
  var DISMISS_KEY = "foodsave.install.dismissedAt", INSTALLED_KEY = "foodsave.install.installed", WEEK = 7 * 24 * 3600 * 1000;
  var evt = null;

  function store(fn) { try { return fn(); } catch (e) { return null; } }
  function standalone() { return (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || window.navigator.standalone === true; }
  function isIOS() { var ua = navigator.userAgent || ""; return /iphone|ipad|ipod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); }
  function isMobile() { return /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent || "") || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); }
  function installed() { return standalone() || store(function () { return localStorage.getItem(INSTALLED_KEY) === "1"; }); }
  function dismissedRecently() { var t = Number(store(function () { return localStorage.getItem(DISMISS_KEY); })) || 0; return t && Date.now() - t < WEEK; }
  // Mục "Cài đặt app": hiện khi còn cài được (có sự kiện cài, hoặc điện thoại — chỉ cần hướng dẫn); ẩn trên máy tính không hỗ trợ
  function canOfferMenu() { return !installed() && (!!evt || isMobile()); }

  function css() {
    if (document.getElementById("fs-install-css")) return;
    var s = document.createElement("style"); s.id = "fs-install-css";
    s.textContent = "#fs-pwa-install{display:none!important}" +
      "#fs-install-bar{position:fixed;left:10px;right:10px;bottom:calc(10px + env(safe-area-inset-bottom));z-index:9990;max-width:460px;margin:0 auto;background:#14613b;color:#fff;border-radius:16px;padding:11px 12px;display:flex;align-items:center;gap:10px;box-shadow:0 10px 30px rgba(0,0,0,.3);font:600 13px/1.35 system-ui,sans-serif}" +
      "#fs-install-bar img{width:38px;height:38px;border-radius:10px;flex:none}#fs-install-bar span{flex:1}" +
      "#fs-install-bar button.go{background:#f3c94f;color:#0f4a2e;border:0;border-radius:10px;padding:9px 13px;font:800 13px system-ui,sans-serif;cursor:pointer}" +
      "#fs-install-bar button.x{background:transparent;color:#fff;border:0;font-size:20px;line-height:1;padding:4px 6px;cursor:pointer;opacity:.8}" +
      "#fs-install-sheet{position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.5);display:flex;align-items:flex-end;justify-content:center}" +
      "#fs-install-sheet .box{background:#fff;color:#14291f;width:100%;max-width:460px;border-radius:22px 22px 0 0;padding:20px 20px calc(20px + env(safe-area-inset-bottom));font:500 14px/1.6 system-ui,sans-serif}" +
      "#fs-install-sheet h3{margin:0 0 8px;font-size:18px}#fs-install-sheet ol{margin:8px 0 14px;padding-left:20px}" +
      "#fs-install-sheet button{width:100%;background:#14613b;color:#fff;border:0;border-radius:12px;padding:12px;font:800 15px system-ui,sans-serif;cursor:pointer}";
    document.head.appendChild(s);
  }

  function closeSheet() { var n = document.getElementById("fs-install-sheet"); if (n) n.remove(); }
  function guide() {
    closeSheet();
    var ios = isIOS();
    var steps = ios
      ? "<ol><li>Mở trang này bằng <b>Safari</b>.</li><li>Bấm nút <b>Chia sẻ</b> (ô vuông có mũi tên lên) ở thanh dưới.</li><li>Chọn <b>Thêm vào MH chính</b> (Add to Home Screen), rồi bấm <b>Thêm</b>.</li></ol><div style='font-size:12.5px;color:#556'>Nhận thông báo đẩy trên iPhone cần iOS 16.4 trở lên và phải mở app từ biểu tượng ở màn hình chính.</div>"
      : "<ol><li>Mở menu của trình duyệt (dấu <b>⋮</b> hoặc <b>⋯</b>).</li><li>Chọn <b>Cài đặt ứng dụng</b> hoặc <b>Thêm vào màn hình chính</b>.</li><li>Xác nhận <b>Cài đặt</b>.</li></ol><div style='font-size:12.5px;color:#556'>Nếu không thấy mục này, hãy mở bằng Chrome (Android) hoặc Edge/Chrome (máy tính).</div>";
    var d = document.createElement("div"); d.id = "fs-install-sheet";
    d.innerHTML = "<div class='box' role='dialog' aria-label='Cài đặt app FoodSave'><h3>Cài app FoodSave</h3><div>" + (ios ? "iPhone không có hộp thoại cài tự động. Làm theo các bước:" : "Trình duyệt này chưa hiện hộp thoại cài tự động. Làm theo các bước:") + "</div>" + steps + "<button type='button'>Đã hiểu</button></div>";
    d.addEventListener("click", function (e) { if (e.target === d || e.target.tagName === "BUTTON") closeSheet(); });
    document.body.appendChild(d);
  }

  function install() {
    if (evt) {
      var p = evt; evt = null;
      try {
        p.prompt();
        if (p.userChoice) p.userChoice.then(function (c) { if (c && c.outcome === "accepted") markInstalled(); refresh(); }).catch(refresh);
      } catch (e) { guide(); }
      refresh();
      return;
    }
    guide();
  }

  function markInstalled() { store(function () { localStorage.setItem(INSTALLED_KEY, "1"); }); }
  function dismiss() { store(function () { localStorage.setItem(DISMISS_KEY, String(Date.now())); }); var b = document.getElementById("fs-install-bar"); if (b) b.remove(); }

  function showBar() {
    if (document.getElementById("fs-install-bar")) return;
    var b = document.createElement("div"); b.id = "fs-install-bar"; b.setAttribute("role", "region"); b.setAttribute("aria-label", "Cài app FoodSave");
    b.innerHTML = "<img src='/icons/icon-192.png' alt=''><span>Cài app FoodSave để dùng tiện hơn – bấm để cài</span><button class='go' type='button'>Cài</button><button class='x' type='button' aria-label='Để sau'>×</button>";
    b.querySelector(".go").addEventListener("click", install);
    b.querySelector(".x").addEventListener("click", dismiss);
    document.body.appendChild(b);
  }

  function refresh() {
    if (!document.body) return;
    css();
    var hide = installed();
    if (hide) { var bar = document.getElementById("fs-install-bar"); if (bar) bar.remove(); }
    else if (isMobile() && !dismissedRecently()) showBar();
    var show = canOfferMenu();
    [].forEach.call(document.querySelectorAll("[data-fs-install]"), function (n) { n.style.display = show ? "" : "none"; });
  }

  window.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); evt = e; refresh(); });
  window.addEventListener("appinstalled", function () { evt = null; markInstalled(); refresh(); });
  window.FSInstall = { open: install, refresh: refresh };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", refresh); else refresh();
  setTimeout(refresh, 1500);   // sau khi sự kiện beforeinstallprompt (nếu có) đã tới
})();
