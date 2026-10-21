(function () {
  "use strict";

  var PAGE_CONFIG = window.FOODSAVE_COOKIE_CONFIG || {};
  var ROLE = PAGE_CONFIG.role || "brand";
  var STORAGE_KEY = "foodsave.cookie.consent.v2";
  var LEGACY_KEY = "foodsave-cookie-consent-v2";
  var CONSENT_DAYS = 180;
  var lastFocus = null;

  var ROLE_COPY = {
    brand: {
      kicker: "Quyền riêng tư tại FoodSave",
      title: "Bạn kiểm soát dữ liệu của mình",
      description: "Cookie cần thiết giúp hệ sinh thái FoodSave hoạt động ổn định. Cookie tùy chọn chỉ được bật khi bạn đồng ý.",
      dialogDescription: "Chọn loại cookie FoodSave được phép sử dụng trên toàn bộ hệ sinh thái.",
      personalization: "Ghi nhớ cổng truy cập, khu vực và nội dung phù hợp với lựa chọn của bạn."
    },
    user: {
      kicker: "Quyền riêng tư của bạn",
      title: "FoodSave tôn trọng lựa chọn cookie của bạn",
      description: "Cookie cần thiết giúp đặt hàng và thanh toán an toàn. Cookie tùy chọn chỉ được bật khi bạn đồng ý.",
      dialogDescription: "Chọn loại cookie FoodSave được phép sử dụng trên khu vực người dùng.",
      personalization: "Ghi nhớ khu vực, bộ lọc sản phẩm và nội dung phù hợp với lựa chọn của bạn."
    },
    charity: {
      kicker: "Quyền riêng tư của tổ chức",
      title: "Bảo vệ dữ liệu tổ chức của bạn",
      description: "Cookie cần thiết duy trì đăng nhập và điều phối an toàn. Cookie tùy chọn chỉ được bật khi tổ chức đồng ý.",
      dialogDescription: "Chọn loại cookie được phép sử dụng trên cổng tổ chức từ thiện.",
      personalization: "Ghi nhớ khu vực tiếp nhận, bộ lọc điều phối và tùy chọn báo cáo của tổ chức."
    },
    partner: {
      kicker: "Quyền riêng tư của đối tác",
      title: "Bạn kiểm soát dữ liệu vận hành",
      description: "Cookie cần thiết duy trì phiên làm việc và vận hành cửa hàng an toàn. Cookie tùy chọn chỉ được bật khi bạn đồng ý.",
      dialogDescription: "Chọn loại cookie được phép sử dụng trên cổng đối tác cửa hàng.",
      personalization: "Ghi nhớ cửa hàng, bộ lọc kho và tùy chọn dashboard của đối tác."
    }
  };

  function defaultCategories(enabled) {
    return {
      necessary: true,
      analytics: Boolean(enabled),
      personalization: Boolean(enabled),
      marketing: Boolean(enabled)
    };
  }

  function readConsent() {
    try {
      var saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (saved && saved.expiresAt > Date.now() && saved.categories) return saved;
      if (saved) localStorage.removeItem(STORAGE_KEY);

      var legacy = sessionStorage.getItem(LEGACY_KEY);
      if (legacy === "accept" || legacy === "reject") {
        return saveConsent(legacy, defaultCategories(legacy === "accept"), false);
      }
    } catch (error) {
      console.warn("[FoodSave] Cookie consent could not be read:", error);
    }
    return null;
  }

  function saveConsent(choice, categories, announce) {
    var consent = {
      version: 2,
      choice: choice,
      sourceRole: ROLE,
      categories: categories,
      savedAt: Date.now(),
      expiresAt: Date.now() + CONSENT_DAYS * 24 * 60 * 60 * 1000
    };

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(consent));
      sessionStorage.setItem(LEGACY_KEY, choice);
    } catch (error) {
      console.warn("[FoodSave] Cookie consent could not be saved:", error);
    }

    window.FoodSaveConsent = window.FoodSaveConsent || {};
    window.FoodSaveConsent.current = consent;
    if (announce !== false) {
      window.dispatchEvent(new CustomEvent("foodsave:consent-changed", { detail: consent }));
    }
    return consent;
  }

  function ensureInterface() {
    if (document.getElementById("cookie-banner")) return;

    document.body.insertAdjacentHTML("beforeend", [
      '<div id="cookie-banner" class="fs-cookie-banner" role="region" aria-label="Thông báo quyền riêng tư" aria-hidden="true">',
      '  <div class="fs-cookie-mark" aria-hidden="true"><i class="ti ti-shield-lock"></i></div>',
      '  <div class="fs-cookie-copy">',
      '    <div class="fs-cookie-kicker">Quyền riêng tư của bạn</div>',
      '    <h2>FoodSave tôn trọng lựa chọn cookie của bạn</h2>',
      '    <p>Cookie cần thiết giúp website hoạt động. Cookie tùy chọn chỉ được bật khi bạn đồng ý. <button type="button" class="fs-cookie-link" onclick="openCookiePolicy()">Xem Chính sách Cookie</button></p>',
      '  </div>',
      '  <div class="fs-cookie-actions">',
      '    <button type="button" class="fs-cookie-btn secondary" onclick="setCookieConsent(\'reject\')">Chỉ cookie cần thiết</button>',
      '    <button type="button" class="fs-cookie-btn secondary" onclick="setCookieConsent(\'customize\')"><i class="ti ti-adjustments-horizontal" aria-hidden="true"></i>Tùy chỉnh</button>',
      '    <button type="button" class="fs-cookie-btn primary" onclick="setCookieConsent(\'accept\')"><i class="ti ti-check" aria-hidden="true"></i>Đồng ý tất cả</button>',
      '  </div>',
      '</div>',
      '<div id="cookie-preferences" class="fs-cookie-preferences" aria-hidden="true">',
      '  <div class="fs-cookie-dialog" role="dialog" aria-modal="true" aria-labelledby="cookie-preferences-title">',
      '    <header class="fs-cookie-dialog-head">',
      '      <div class="fs-cookie-mark" aria-hidden="true"><i class="ti ti-cookie"></i></div>',
      '      <div><h2 id="cookie-preferences-title">Tùy chỉnh quyền riêng tư</h2><p>Chọn loại cookie FoodSave được phép sử dụng trên trình duyệt này.</p></div>',
      '      <button type="button" class="fs-cookie-close" onclick="closeCookiePreferences()" aria-label="Đóng tùy chỉnh cookie"><i class="ti ti-x" aria-hidden="true"></i></button>',
      '    </header>',
      '    <div class="fs-cookie-dialog-body">',
      cookieOption("lock", "Cookie bắt buộc", "Duy trì đăng nhập, giỏ hàng, bảo mật và các chức năng cốt lõi của website.", "necessary", true),
      cookieOption("chart-bar", "Phân tích và hiệu suất", "Giúp FoodSave hiểu cách website được sử dụng để cải thiện tốc độ và trải nghiệm.", "analytics", false),
      cookieOption("sparkles", "Cá nhân hóa", "Ghi nhớ khu vực, bộ lọc và nội dung phù hợp với lựa chọn của bạn.", "personalization", false),
      cookieOption("speakerphone", "Tiếp thị", "Đo lường chiến dịch và giới hạn nội dung quảng bá lặp lại.", "marketing", false),
      '    </div>',
      '    <div class="fs-cookie-dialog-foot">',
      '      <button type="button" class="fs-cookie-link" onclick="openCookiePolicy()">Chính sách Cookie</button>',
      '      <div class="fs-cookie-dialog-foot-actions">',
      '        <button type="button" class="fs-cookie-btn secondary" onclick="setCookieConsent(\'reject\')">Từ chối tùy chọn</button>',
      '        <button type="button" class="fs-cookie-btn secondary" onclick="saveCookiePreferences()">Lưu lựa chọn</button>',
      '        <button type="button" class="fs-cookie-btn primary" onclick="setCookieConsent(\'accept\')">Đồng ý tất cả</button>',
      '      </div>',
      '    </div>',
      '  </div>',
      '</div>'
    ].join(""));

    var preferences = document.getElementById("cookie-preferences");
    applyRolePresentation(document.getElementById("cookie-banner"), preferences);
    ensureManagementLink();
    preferences.addEventListener("click", function (event) {
      if (event.target === preferences) closeCookiePreferences();
    });
  }

  function ensureManagementLink() {
    var footer = document.querySelector("footer");
    if (!footer || footer.querySelector('.fs-cookie-manage-link, [onclick*="openCookiePreferences"]')) return;
    var target = footer.querySelector(".footer-bottom .wrap, .foot-bottom, .footer-bottom");
    if (!target) return;
    var button = document.createElement("button");
    button.type = "button";
    button.className = "fs-cookie-manage-link";
    button.textContent = "Quản lý Cookie";
    button.addEventListener("click", window.openCookiePreferences);
    target.appendChild(button);
  }

  function cookieOption(icon, title, description, key, required) {
    var control = required
      ? '<span class="fs-cookie-required">Luôn hoạt động</span>'
      : '<label class="fs-cookie-switch"><input id="cookie-' + key + '" type="checkbox"><span class="fs-cookie-track" aria-hidden="true"></span><span class="sr-only">' + title + '</span></label>';
    return '<div class="fs-cookie-option"><div><div class="fs-cookie-option-title"><i class="ti ti-' + icon + '" aria-hidden="true"></i>' + title + '</div><p>' + description + '</p></div>' + control + '</div>';
  }

  function applyRolePresentation(banner, preferences) {
    var copy = ROLE_COPY[ROLE] || ROLE_COPY.brand;
    var themeClass = "fs-cookie-theme-" + ROLE;
    banner.classList.add(themeClass);
    preferences.classList.add(themeClass);

    banner.querySelector(".fs-cookie-kicker").textContent = copy.kicker;
    banner.querySelector(".fs-cookie-copy h2").textContent = copy.title;
    var bannerParagraph = banner.querySelector(".fs-cookie-copy p");
    var policyButton = bannerParagraph.querySelector(".fs-cookie-link");
    bannerParagraph.textContent = copy.description + " ";
    bannerParagraph.appendChild(policyButton);

    preferences.querySelector(".fs-cookie-dialog-head p").textContent = copy.dialogDescription;
    var optionDescriptions = preferences.querySelectorAll(".fs-cookie-option p");
    if (optionDescriptions[2]) optionDescriptions[2].textContent = copy.personalization;

    if (PAGE_CONFIG.iconSet === "lucide") convertToLucideIcons([banner, preferences]);
  }

  function convertToLucideIcons(roots) {
    var names = {
      "ti-shield-lock": "shield-check",
      "ti-adjustments-horizontal": "sliders-horizontal",
      "ti-check": "check",
      "ti-cookie": "cookie",
      "ti-x": "x",
      "ti-lock": "lock-keyhole",
      "ti-chart-bar": "chart-no-axes-column-increasing",
      "ti-sparkles": "sparkles",
      "ti-speakerphone": "megaphone"
    };

    roots.forEach(function (root) {
      root.querySelectorAll("i").forEach(function (element) {
        var iconClass = Array.from(element.classList).find(function (name) { return name.indexOf("ti-") === 0; });
        element.removeAttribute("class");
        element.setAttribute("data-lucide", names[iconClass] || "circle");
      });
    });
    if (window.lucide && typeof window.lucide.createIcons === "function") {
      window.lucide.createIcons({ strokeWidth: 2 });
    }
  }

  function showBanner() {
    ensureInterface();
    var banner = document.getElementById("cookie-banner");
    banner.classList.add("is-visible");
    banner.setAttribute("aria-hidden", "false");
  }

  function hideBanner() {
    var banner = document.getElementById("cookie-banner");
    if (!banner) return;
    banner.classList.remove("is-visible");
    banner.setAttribute("aria-hidden", "true");
  }

  function syncPreferenceControls() {
    var saved = readConsent();
    var categories = saved ? saved.categories : defaultCategories(false);
    ["analytics", "personalization", "marketing"].forEach(function (key) {
      var input = document.getElementById("cookie-" + key);
      if (input) input.checked = Boolean(categories[key]);
    });
  }

  function closePreferences(restoreBanner) {
    var preferences = document.getElementById("cookie-preferences");
    if (!preferences) return;
    preferences.classList.remove("is-visible");
    preferences.setAttribute("aria-hidden", "true");
    document.body.classList.remove("fs-cookie-modal-open");
    if (restoreBanner !== false && !readConsent()) showBanner();
    if (lastFocus && typeof lastFocus.focus === "function") lastFocus.focus();
  }

  window.openCookiePreferences = function () {
    ensureInterface();
    lastFocus = document.activeElement;
    syncPreferenceControls();
    hideBanner();
    var preferences = document.getElementById("cookie-preferences");
    preferences.classList.add("is-visible");
    preferences.setAttribute("aria-hidden", "false");
    document.body.classList.add("fs-cookie-modal-open");
    var closeButton = preferences.querySelector(".fs-cookie-close");
    if (closeButton) closeButton.focus();
  };

  window.closeCookiePreferences = function () {
    closePreferences(true);
  };

  window.setCookieConsent = function (choice) {
    if (choice === "customize") {
      window.openCookiePreferences();
      return;
    }
    var enabled = choice === "accept";
    saveConsent(choice, defaultCategories(enabled), true);
    hideBanner();
    closePreferences(false);
  };

  window.saveCookiePreferences = function () {
    var categories = defaultCategories(false);
    ["analytics", "personalization", "marketing"].forEach(function (key) {
      var input = document.getElementById("cookie-" + key);
      categories[key] = Boolean(input && input.checked);
    });
    saveConsent("custom", categories, true);
    hideBanner();
    closePreferences(false);
  };

  window.openCookiePolicy = function () {
    closePreferences(false);
    if (!readConsent()) showBanner();
    if (typeof window.openLegal === "function") {
      window.openLegal("cookie");
    } else if (PAGE_CONFIG.policyUrl) {
      window.location.href = PAGE_CONFIG.policyUrl;
    }
  };

  window.FoodSaveConsent = {
    current: null,
    get: readConsent,
    has: function (category) {
      var consent = readConsent();
      return Boolean(consent && consent.categories && consent.categories[category]);
    },
    open: window.openCookiePreferences
  };

  function initConsent() {
    ensureInterface();
    ensureManagementLink();
    var consent = readConsent();
    window.FoodSaveConsent.current = consent;
    if (!consent) window.setTimeout(showBanner, 700);

    var landing = document.getElementById("landing");
    if (landing && window.MutationObserver) {
      new MutationObserver(ensureManagementLink).observe(landing, { childList: true });
    }
  }

  document.addEventListener("keydown", function (event) {
    var preferences = document.getElementById("cookie-preferences");
    if (!preferences || !preferences.classList.contains("is-visible")) return;

    if (event.key === "Escape") {
      closePreferences(true);
      return;
    }

    if (event.key === "Tab") {
      var focusable = Array.from(preferences.querySelectorAll('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'));
      if (!focusable.length) return;
      var first = focusable[0];
      var last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initConsent, { once: true });
  } else {
    initConsent();
  }
})();
