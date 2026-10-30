/* FoodSave service worker (người mua + tình nguyện viên). Scope "/" nhờ nằm ở thư mục gốc.
 * - Cache vỏ ứng dụng (frontend/*.js, *.css, icon, offline.html): stale-while-revalidate.
 * - Trang HTML: ưu tiên mạng, mất mạng thì hiện offline.html.
 * - KHÔNG BAO GIỜ cache /api/, Supabase hay bất kỳ nội dung khác nguồn gốc / có token.
 * - Nhận Web Push và mở đúng đơn / nhiệm vụ khi bấm thông báo.
 * Đổi CACHE_VERSION khi muốn xóa sạch cache cũ ở mọi máy. */
var CACHE_VERSION = "fs-v2";
var CDN_CACHE = "fs-cdn-v1";   // thư viện bên thứ ba có phiên bản cố định (Leaflet, Supabase JS, biểu tượng, QR); không chứa dữ liệu người dùng
var SHELL = [
  "/offline.html", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/maskable-512.png", "/icons/apple-touch-icon-180.png",
  "/manifest-user.webmanifest", "/manifest-app.webmanifest", "/manifest-volunteer.webmanifest",
  // vỏ app người mua: mã dùng chung (không có dữ liệu đơn hàng / thanh toán)
  "/frontend/foodsave-auth-client.js", "/frontend/foodsave-live-data.js", "/frontend/foodsave-pwa.js", "/frontend/foodsave-map.js",
  "/frontend/foodsave-legal-content.js", "/frontend/foodsave-install.js"
];
var CDN_ALLOW = [/^https:\/\/cdn\.jsdelivr\.net\/npm\/(leaflet@|@supabase\/supabase-js|@tabler\/icons-webfont@)/, /^https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/qrcode-generator\//];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function (cache) { return Promise.all(SHELL.map(function (u) { return cache.add(u).catch(function () {}); })); }).catch(function () {}).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (key) { return key !== CACHE_VERSION && key !== CDN_CACHE; }).map(function (key) { return caches.delete(key); }));
    }).then(function () { return self.clients.claim(); })
  );
});

function isStaticAsset(url) {
  return url.origin === self.location.origin && (/\.(?:js|css|png|jpg|jpeg|svg|webp|woff2?|webmanifest)$/i.test(url.pathname) && url.pathname.indexOf("/api/") !== 0);
}

self.addEventListener("fetch", function (event) {
  var request = event.request;
  if (request.method !== "GET") return;
  var url = new URL(request.url);
  if (url.origin !== self.location.origin && CDN_ALLOW.some(function (re) { return re.test(request.url); })) {
    event.respondWith(
      caches.open(CDN_CACHE).then(function (cache) {
        return cache.match(request).then(function (cached) {
          var network = fetch(request).then(function (response) {
            if (response && (response.ok || response.type === "opaque")) cache.put(request, response.clone());
            return response;
          }).catch(function () { return cached; });
          return cached || network;
        });
      })
    );
    return;
  }
  // Chỉ xử lý cùng nguồn gốc; không đụng /api/, Supabase, bản đồ, font ngoài...
  if (url.origin !== self.location.origin || url.pathname.indexOf("/api/") === 0 || url.pathname.indexOf("/.netlify/") === 0) return;
  if (url.pathname === "/sw.js") return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(function () { return caches.match("/offline.html"); })
    );
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(
      caches.open(CACHE_VERSION).then(function (cache) {
        return cache.match(request).then(function (cached) {
          var network = fetch(request).then(function (response) {
            if (response && response.ok) cache.put(request, response.clone());
            return response;
          }).catch(function () { return cached; });
          return cached || network;
        });
      })
    );
  }
});

self.addEventListener("push", function (event) {
  var data = {};
  try { data = event.data ? event.data.json() : {}; } catch (error) { data = { title: "FoodSave", body: event.data ? event.data.text() : "" }; }
  var title = data.title || "FoodSave";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: data.tag || undefined,
      renotify: !!data.tag,
      data: { url: data.url || "/", type: data.type || "" }
    })
  );
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var target = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin);
  // Chỉ mở địa chỉ của chính FoodSave
  if (target.origin !== self.location.origin) target = new URL("/", self.location.origin);
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (clientList) {
      for (var i = 0; i < clientList.length; i += 1) {
        var client = clientList[i];
        var clientUrl = new URL(client.url);
        if (clientUrl.pathname === target.pathname && "focus" in client) {
          // Cùng trang đang mở: đưa lên và báo trang tự chuyển tới đúng đơn / nhiệm vụ (qua #hash)
          client.postMessage({ type: "fs-open", hash: target.hash });
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target.href);
      return undefined;
    })
  );
});
