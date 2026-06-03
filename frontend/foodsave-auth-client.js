(function () {
  "use strict";

  const LOCAL_API_BASE_URL = "http://localhost:8080/api/v1";
  const API_PATH = "/api/v1";
  const AUTH_STORAGE_KEY = "foodsave.auth.session";
  const GOOGLE_OTP_STORAGE_KEY = "foodsave.auth.googleOtp";
  const PHONE_OTP_STORAGE_KEY = "foodsave.auth.phoneOtp";
  const OAUTH_PROVIDER_STORAGE_KEY = "foodsave.auth.oauthProvider";
  let oauthNoticeTimer = 0;
  let customerLoginPending = false;
  let customerRegisterPending = false;
  let googleLoginPending = false;
  let facebookLoginPending = false;
  let phoneLoginOtpPending = false;
  let googleOtpPending = null;
  let googleOtpTimer = 0;
  let phoneOtpPending = null;
  let phoneOtpTimer = 0;
  let portalLoginPending = false;
  let portalRegisterPending = false;

  function trimTrailingSlash(value) {
    return String(value || "").replace(/\/+$/, "");
  }

  function explicitApiBase() {
    const script = document.currentScript;
    const scriptBase = script && script.getAttribute ? script.getAttribute("data-api-base") : "";
    const meta = document.querySelector('meta[name="foodsave-api-base"]');
    const metaBase = meta && meta.getAttribute ? meta.getAttribute("content") : "";
    return window.FOODSAVE_API_BASE || scriptBase || metaBase || "";
  }

  function resolveApiBaseUrl() {
    const explicit = trimTrailingSlash(explicitApiBase());
    if (explicit) return explicit;

    const location = window.location;
    const isHttp = location.protocol === "http:" || location.protocol === "https:";
    const isLocalHost = location.hostname === "localhost" || location.hostname === "127.0.0.1" || location.hostname === "::1";

    if (isHttp && !isLocalHost) {
      return `${location.origin}${API_PATH}`;
    }

    if (isHttp && isLocalHost && location.port === "8080") {
      return `${location.origin}${API_PATH}`;
    }

    return LOCAL_API_BASE_URL;
  }

  const API_BASE_URL = resolveApiBaseUrl();

  const portalConfig = {
    partner: {
      expectedRole: "partner",
      registerEndpoint: "/auth/register/partner",
      loginTitle: "Đăng nhập thành công",
      loginMessage: "Cửa hàng đã được xác thực.",
      pendingMessage: "Hồ sơ cửa hàng đang chờ Admin duyệt.",
      accent: "var(--green-800)",
      defaultName: "cửa hàng"
    },
    charity: {
      expectedRole: "charity",
      registerEndpoint: "/auth/register/charity",
      loginTitle: "Đăng nhập thành công",
      loginMessage: "Tổ chức đã được xác thực.",
      pendingMessage: "Hồ sơ tổ chức đang chờ Admin duyệt.",
      accent: "var(--rose)",
      defaultName: "tổ chức"
    }
  };

  const pageRole = (function detectPageRole() {
    const file = window.location.pathname.toLowerCase();
    if (file.includes("foodsave_partner")) return "partner";
    if (file.includes("foodsave_charity")) return "charity";
    return "customer";
  })();

  function select(selector) {
    return document.querySelector(selector);
  }

  function visible(element) {
    return !!element && window.getComputedStyle(element).display !== "none";
  }

  function notify(title, message, type) {
    if (typeof window.tst === "function") {
      window.tst(title, message || "", type || "info");
      return;
    }
    if (typeof window.toast === "function") {
      const mappedType = type === "error" ? "error" : type === "warn" ? "warn" : "info";
      const key = mappedType === "error" ? "auth-error" : mappedType === "warn" ? "auth-warn" : "";
      window.toast(message ? `${title}: ${message}` : title, mappedType, key);
      return;
    }
    window.alert(message ? `${title}\n${message}` : title);
  }

  function notifyOnce(key, title, message, type, cooldownMs) {
    const now = Date.now();
    const stateKey = `__foodsaveNotify_${key}`;
    const last = Number(window[stateKey] || 0);

    if (last && now - last < cooldownMs) return;
    window[stateKey] = now;
    notify(title, message, type);
  }

  function normalizePhone(value) {
    const trimmed = String(value || "").trim();
    if (trimmed.startsWith("+")) return `+${trimmed.slice(1).replace(/\D/g, "")}`;
    return trimmed.replace(/\D/g, "");
  }

  function phoneLoginValue() {
    return `${readValue("#login-country") || "+84"} ${requireValue("#login-phone", "số điện thoại")}`;
  }

  function setRegisterStepperVisible(isVisible) {
    const stepper = select("#register-stepper");
    if (stepper) stepper.style.display = isVisible ? "flex" : "none";
  }

  function resetRegisterStepper() {
    const step1 = select("#rstep-1");
    const step2 = select("#rstep-2");
    const step3 = select("#rstep-3");
    const resetStep = (step, number) => {
      if (!step) return;
      step.classList.remove("active", "done");
      const num = step.querySelector(".stepper-num");
      if (num) num.textContent = String(number);
    };

    resetStep(step1, 1);
    resetStep(step2, 2);
    resetStep(step3, 3);
    if (step1) step1.classList.add("active");
  }

  function splitSignupPhone(value) {
    const raw = String(value || "").trim();
    const compact = raw.replace(/\s+/g, "");
    const prefixes = ["+84", "+1", "+65", "+82", "+81"];
    const country = prefixes.find((prefix) => compact.startsWith(prefix));

    if (!country) return { country: "+84", local: raw };

    return {
      country,
      local: compact.slice(country.length).replace(/^0+/, "")
    };
  }

  function beginPhoneSignup() {
    const phone = readValue("#signup-phone-entry");
    const digitCount = normalizePhone(phone).replace(/\D/g, "").length;
    if (digitCount < 8) {
      notify("Số điện thoại chưa đúng", "Vui lòng nhập số điện thoại thật để nhận OTP.", "warn");
      return;
    }

    clearGoogleOtpPending();
    const parsedPhone = splitSignupPhone(phone);
    const countryInput = select("#reg-country");
    const phoneInput = select("#reg-phone");
    if (countryInput) countryInput.value = parsedPhone.country;
    if (phoneInput) phoneInput.value = parsedPhone.local;

    const methods = select("#register-methods");
    const details = select("#register-details");
    const step1 = select("#reg-step-1");
    const step2 = select("#reg-step-2");
    const step3 = select("#reg-step-3");

    if (methods) methods.style.display = "none";
    if (details) details.style.display = "block";
    if (step1) step1.style.display = "block";
    if (step2) step2.style.display = "none";
    if (step3) step3.style.display = "none";
    setRegisterStepperVisible(true);
    resetRegisterStepper();
    const otpBackButton = select("#otp-back-button");
    if (otpBackButton) {
      otpBackButton.textContent = "← Sai số điện thoại? Sửa lại";
      otpBackButton.onclick = function () {
        if (typeof window.backToStep1 === "function") window.backToStep1();
      };
    }
    window.setTimeout(() => select("#reg-name")?.focus(), 100);
  }

  function backToRegisterMethods() {
    const methods = select("#register-methods");
    const details = select("#register-details");
    const step1 = select("#reg-step-1");
    const step2 = select("#reg-step-2");
    const step3 = select("#reg-step-3");

    if (methods) methods.style.display = "block";
    if (details) details.style.display = "none";
    if (step1) step1.style.display = "block";
    if (step2) step2.style.display = "none";
    if (step3) step3.style.display = "none";
    clearGoogleOtpPending();
    setRegisterStepperVisible(false);
    resetRegisterStepper();
  }

  function maskPhone(value) {
    const normalized = normalizePhone(value);
    const tail = normalized.slice(-3);
    const head = normalized.startsWith("+") ? normalized.slice(0, 3) : normalized.slice(0, 2);
    return `${head} ••• ••• ${tail}`;
  }

  function readValue(selector) {
    const element = select(selector);
    return element && "value" in element ? String(element.value).trim() : "";
  }

  function requireValue(selector, label) {
    const value = readValue(selector);
    if (!value) throw new Error(`Vui lòng nhập ${label}`);
    return value;
  }

  function saveSession(payload, role) {
    const session = {
      role,
      accessToken: payload.session.access_token,
      refreshToken: payload.session.refresh_token,
      expiresAt: payload.session.expires_at,
      profile: payload.profile,
      context: payload.context,
      savedAt: new Date().toISOString()
    };
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
    window.FoodSaveCurrentAuth = session;
    return session;
  }

  function readSession() {
    try {
      const raw = localStorage.getItem(AUTH_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      localStorage.removeItem(AUTH_STORAGE_KEY);
      return null;
    }
  }

  function clearSession() {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    window.FoodSaveCurrentAuth = null;
  }

  function readStoredGoogleOtp() {
    try {
      const raw = sessionStorage.getItem(GOOGLE_OTP_STORAGE_KEY);
      if (!raw) return null;
      const pending = JSON.parse(raw);
      if (!pending || !pending.expiresAt || new Date(pending.expiresAt).getTime() <= Date.now()) {
        sessionStorage.removeItem(GOOGLE_OTP_STORAGE_KEY);
        return null;
      }
      return pending;
    } catch (error) {
      sessionStorage.removeItem(GOOGLE_OTP_STORAGE_KEY);
      return null;
    }
  }

  function setGoogleOtpPending(pending) {
    googleOtpPending = pending;
    try {
      sessionStorage.setItem(GOOGLE_OTP_STORAGE_KEY, JSON.stringify(pending));
    } catch (error) {
      // Session storage can be unavailable in strict privacy modes; in-memory still works for this tab.
    }
  }

  function clearGoogleOtpPending() {
    googleOtpPending = null;
    clearInterval(googleOtpTimer);
    try {
      sessionStorage.removeItem(GOOGLE_OTP_STORAGE_KEY);
    } catch (error) {
      // Nothing to clear.
    }
  }

  function readStoredPhoneOtp() {
    try {
      const raw = sessionStorage.getItem(PHONE_OTP_STORAGE_KEY);
      if (!raw) return null;
      const pending = JSON.parse(raw);
      if (!pending || !pending.expiresAt || new Date(pending.expiresAt).getTime() <= Date.now()) {
        sessionStorage.removeItem(PHONE_OTP_STORAGE_KEY);
        return null;
      }
      return pending;
    } catch (error) {
      sessionStorage.removeItem(PHONE_OTP_STORAGE_KEY);
      return null;
    }
  }

  function setPhoneOtpPending(pending) {
    phoneOtpPending = pending;
    try {
      sessionStorage.setItem(PHONE_OTP_STORAGE_KEY, JSON.stringify(pending));
    } catch (error) {
      // Session storage can be unavailable in strict privacy modes; in-memory still works for this tab.
    }
  }

  function clearPhoneOtpPending() {
    phoneOtpPending = null;
    clearInterval(phoneOtpTimer);
    try {
      sessionStorage.removeItem(PHONE_OTP_STORAGE_KEY);
    } catch (error) {
      // Nothing to clear.
    }
  }

  function setPendingOAuthProvider(provider) {
    try {
      sessionStorage.setItem(OAUTH_PROVIDER_STORAGE_KEY, provider);
    } catch (error) {
      window.__foodsavePendingOAuthProvider = provider;
    }
  }

  function readPendingOAuthProvider() {
    try {
      return sessionStorage.getItem(OAUTH_PROVIDER_STORAGE_KEY) || window.__foodsavePendingOAuthProvider || "";
    } catch (error) {
      return window.__foodsavePendingOAuthProvider || "";
    }
  }

  function normalizeOAuthProvider(provider) {
    return provider === "google" || provider === "facebook" ? provider : "";
  }

  function clearPendingOAuthProvider() {
    try {
      sessionStorage.removeItem(OAUTH_PROVIDER_STORAGE_KEY);
    } catch (error) {
      // Nothing to clear.
    }
    window.__foodsavePendingOAuthProvider = "";
  }

  function setOAuthButtonPending(provider, pending) {
    const buttons = document.querySelectorAll(`[data-oauth-provider="${provider}"]`);
    buttons.forEach((button) => {
      button.disabled = pending;
      button.setAttribute("aria-busy", pending ? "true" : "false");
      button.style.opacity = pending ? ".72" : "";

      const status = button.querySelector("[data-oauth-status]");
      if (!status) return;
      if (!status.dataset.defaultText) status.dataset.defaultText = status.textContent.trim();
      status.textContent = pending
        ? provider === "facebook"
          ? "Đang mở Facebook..."
          : "Đang mở Google..."
        : status.dataset.defaultText;
    });
  }

  function oauthRedirectUrl(provider) {
    const location = window.location;
    const isHttp = location.protocol === "http:" || location.protocol === "https:";
    if (!isHttp) {
      const label = provider === "facebook" ? "Facebook" : "Google";
      throw new Error(`${label} OAuth cần mở FOODSAVE_USER.html qua HTTP/HTTPS, không hỗ trợ file://. Hãy chạy backend/frontend hoặc deploy Netlify rồi thử lại.`);
    }

    const url = new URL(location.href);
    url.hash = "";
    url.searchParams.set("oauth_provider", provider);
    return url.toString();
  }

  function readOAuthProviderFromUrl() {
    return normalizeOAuthProvider(new URLSearchParams(window.location.search).get("oauth_provider"));
  }

  function readOAuthHash() {
    const hash = window.location.hash ? window.location.hash.slice(1) : "";
    if (!hash) return null;

    const params = new URLSearchParams(hash);
    const errorDescription = params.get("error_description") || params.get("error");
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    const expiresAt = params.get("expires_at");
    const tokenType = params.get("token_type") || "bearer";

    if (errorDescription) {
      return { error: errorDescription };
    }

    if (!accessToken) return null;
    return {
      accessToken,
      refreshToken,
      expiresAt: expiresAt ? Number(expiresAt) : null,
      tokenType
    };
  }

  function clearOAuthHash() {
    if (!window.history || !window.history.replaceState) return;
    const url = new URL(window.location.href);
    url.hash = "";
    url.searchParams.delete("oauth_provider");
    window.history.replaceState(null, document.title, `${url.pathname}${url.search}`);
  }

  function oauthPopupFeatures() {
    const width = 920;
    const height = 780;
    const left = Math.max(0, Math.round((window.screenX || 0) + ((window.outerWidth || width) - width) / 2));
    const top = Math.max(0, Math.round((window.screenY || 0) + ((window.outerHeight || height) - height) / 2));
    return `popup=yes,width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes,status=yes`;
  }

  function openOAuthPopup(provider) {
    const label = provider === "google" ? "Google" : "Facebook";
    const color = provider === "google" ? "#fff" : "#1877f2";
    const textColor = provider === "google" ? "#1f2937" : "#fff";
    const mark = provider === "google" ? "G" : "f";
    const shadow = provider === "google" ? "0 0 0 1px #d1d5db inset" : "none";
    const popup = window.open("about:blank", `foodsave-${provider}-oauth`, oauthPopupFeatures());
    if (!popup) return null;

    try {
      popup.document.title = `${label} - FoodSave`;
      popup.document.body.style.cssText = "margin:0;font-family:Arial,sans-serif;background:#f0f2f5;color:#1c1e21;display:grid;place-items:center;min-height:100vh";
      popup.document.body.innerHTML = `<div style="text-align:center;padding:28px"><div style="width:54px;height:54px;margin:0 auto 16px;border-radius:50%;background:${color};color:${textColor};box-shadow:${shadow};display:grid;place-items:center;font-size:34px;font-weight:700">${mark}</div><p style="font-size:17px;margin:0 0 6px">Đang mở ${label}</p><p style="font-size:13px;color:#606770;margin:0">Hãy xác nhận trên ${label} để tiếp tục với FoodSave.</p></div>`;
    } catch (error) {
      // Some browsers prevent writing to the popup before navigation; the OAuth redirect still works.
    }

    return popup;
  }

  function notifyOAuthOpener(provider, payload) {
    if (!window.opener || window.opener === window) return false;

    try {
      const message = {
        type: "foodsave:oauth-complete",
        provider
      };
      if (provider === "facebook") message.authResult = payload;
      if (provider === "google") message.googleOtp = payload;
      window.opener.postMessage(message, window.location.origin);
      return true;
    } catch (error) {
      return false;
    }
  }

  function handleOAuthPopupMessage(event) {
    if (event.origin !== window.location.origin) return;

    const message = event.data || {};
    if (message.type !== "foodsave:oauth-complete") return;

    const provider = normalizeOAuthProvider(message.provider);
    if (provider === "google" && message.googleOtp) {
      googleLoginPending = false;
      clearPendingOAuthProvider();
      setOAuthButtonPending("google", false);
      showGoogleOtpStep(message.googleOtp.otpData, message.googleOtp.accessToken);
      return;
    }

    if (provider !== "facebook" || !message.authResult) return;

    facebookLoginPending = false;
    clearPendingOAuthProvider();
    setOAuthButtonPending("facebook", false);
    saveSession(message.authResult, "customer");
    updateCustomerUiFromProfile(message.authResult.profile);
    notify("Đăng nhập Facebook thành công", "Bạn đã đồng ý liên kết Facebook với FoodSave.", "info");
    if (typeof window.navTo === "function") window.navTo("home");
  }

  function watchOAuthPopup(provider, popup) {
    if (!popup) return;

    const timer = window.setInterval(() => {
      if (!popup.closed) return;
      window.clearInterval(timer);
      if (provider === "google" && !googleLoginPending) return;
      if (provider === "facebook" && !facebookLoginPending) return;
      if (provider === "google") googleLoginPending = false;
      if (provider === "facebook") facebookLoginPending = false;
      clearPendingOAuthProvider();
      setOAuthButtonPending(provider, false);
    }, 500);
  }

  async function request(path, options) {
    let response;
    try {
      response = await fetch(`${API_BASE_URL}${path}`, {
        method: options.method || "GET",
        headers: {
          "Content-Type": "application/json",
          ...(options.token ? { Authorization: `Bearer ${options.token}` } : {})
        },
        body: options.body ? JSON.stringify(options.body) : undefined
      });
    } catch (error) {
      throw new Error(`Không thể kết nối FoodSave API tại ${API_BASE_URL}. Hãy kiểm tra backend đang chạy và CORS_ORIGINS đã cho phép domain frontend.`);
    }

    let payload = null;
    try {
      payload = await response.json();
    } catch (error) {
      payload = null;
    }

    if (!response.ok || !payload || payload.success !== true) {
      const message = payload && payload.error && payload.error.message ? payload.error.message : "Không thể kết nối FoodSave API";
      throw new Error(message);
    }

    return payload.data;
  }

  function updateCustomerUiFromProfile(profile) {
    const name = profile && profile.full_name ? profile.full_name : "bạn";
    const firstName = name.split(" ").slice(-1)[0] || name;
    const initials = name.split(" ").map((item) => item[0]).join("").slice(0, 2).toUpperCase();

    if (select("#hello-name")) select("#hello-name").textContent = firstName;
    if (select("#acc-name-big")) select("#acc-name-big").textContent = name;
    if (select("#user-avatar")) select("#user-avatar").innerHTML = initials;
    if (select("#prof-name")) select("#prof-name").value = name;
    if (select("#acc-avatar-big")) {
      select("#acc-avatar-big").innerHTML = `${initials}<button style="position:absolute;bottom:-2px;right:-2px;width:26px;height:26px;border-radius:50%;background:var(--orange-500);color:#fff;border:2px solid var(--green-900);display:grid;place-items:center;font-size:13px"><i class="ti ti-camera"></i></button>`;
    }
  }

  async function loginCustomer() {
    if (customerLoginPending) return;
    customerLoginPending = true;
    try {
      const emailTab = select("#login-email-tab");
      const identifier = visible(emailTab)
        ? requireValue("#login-email", "email")
        : `${readValue("#login-country") || "+84"} ${requireValue("#login-phone", "số điện thoại")}`;
      const password = requireValue("#login-password", "mật khẩu");

      const data = await request("/auth/login", {
        method: "POST",
        body: {
          identifier,
          password,
          expected_role: "customer"
        }
      });

      saveSession(data, "customer");
      updateCustomerUiFromProfile(data.profile);
      notify("Đăng nhập thành công", "Chào mừng bạn quay lại FoodSave.", "info");
      if (typeof window.navTo === "function") window.navTo("home");
    } catch (error) {
      notify("Đăng nhập thất bại", error.message, "error");
    } finally {
      customerLoginPending = false;
    }
  }

  function clearOtpInputs() {
    document.querySelectorAll(".otp-input").forEach((input) => {
      input.value = "";
      input.classList.remove("filled");
    });
  }

  function startGoogleOtpTimer(seconds) {
    clearInterval(googleOtpTimer);
    const timer = select("#otp-timer");
    const resend = select("#otp-resend");
    let remaining = Math.max(0, Number(seconds || 0));

    if (resend) {
      resend.disabled = true;
      resend.onclick = resendGoogleOtp;
    }

    const tick = () => {
      const minutes = String(Math.floor(remaining / 60)).padStart(2, "0");
      const secondsText = String(remaining % 60).padStart(2, "0");
      if (timer) timer.textContent = `${minutes}:${secondsText}`;

      if (remaining <= 0) {
        clearInterval(googleOtpTimer);
        if (resend) resend.disabled = false;
        return;
      }

      remaining -= 1;
    };

    tick();
    googleOtpTimer = window.setInterval(tick, 1000);
  }

  function clearPhoneLoginOtpInputs() {
    document.querySelectorAll(".phone-otp-input").forEach((input) => {
      input.value = "";
      input.classList.remove("filled");
    });
  }

  function phoneOtpMove(input, idx) {
    input.value = String(input.value || "").replace(/\D/g, "").slice(0, 1);
    if (input.value.length > 0) {
      input.classList.add("filled");
      const next = document.querySelectorAll(".phone-otp-input")[idx + 1];
      if (next) next.focus();
    } else {
      input.classList.remove("filled");
    }
  }

  function phoneOtpKey(input, idx, event) {
    if (event.key === "Backspace" && !input.value) {
      const previous = document.querySelectorAll(".phone-otp-input")[idx - 1];
      if (previous) previous.focus();
    }
  }

  function readPhoneOtpInput() {
    return Array.from(document.querySelectorAll(".phone-otp-input")).map((input) => input.value).join("");
  }

  function startPhoneOtpTimer(seconds) {
    clearInterval(phoneOtpTimer);
    const timer = select("#phone-login-otp-timer");
    const resend = select("#phone-login-otp-resend");
    let remaining = Math.max(0, Number(seconds || 0));

    if (resend) {
      resend.disabled = true;
      resend.onclick = resendPhoneLoginOtp;
    }

    const tick = () => {
      const minutes = String(Math.floor(remaining / 60)).padStart(2, "0");
      const secondsText = String(remaining % 60).padStart(2, "0");
      if (timer) timer.textContent = `${minutes}:${secondsText}`;

      if (remaining <= 0) {
        clearInterval(phoneOtpTimer);
        if (resend) resend.disabled = false;
        return;
      }

      remaining -= 1;
    };

    tick();
    phoneOtpTimer = window.setInterval(tick, 1000);
  }

  function showPhoneLoginOtpPanel(otpData) {
    const expiresAt = new Date(Date.now() + Number(otpData.expires_in_seconds || 0) * 1000).toISOString();
    setPhoneOtpPending({
      phone: otpData.phone,
      expiresAt
    });

    const form = select("#login-password-form");
    const panel = select("#phone-login-otp-panel");
    const target = select("#phone-login-otp-target");

    if (!panel) {
      const otp = window.prompt(`FoodSave đã gửi OTP SMS về ${otpData.phone}. Nhập mã 6 số:`);
      if (otp) verifyPhoneLoginOtp(otp);
      return;
    }

    if (form) form.style.display = "none";
    panel.style.display = "block";
    if (target) target.textContent = maskPhone(otpData.phone);
    clearPhoneLoginOtpInputs();
    startPhoneOtpTimer(otpData.expires_in_seconds);
    window.setTimeout(() => document.querySelector(".phone-otp-input")?.focus(), 100);
  }

  function cancelPhoneLoginOtp() {
    clearPhoneOtpPending();
    const form = select("#login-password-form");
    const panel = select("#phone-login-otp-panel");
    if (panel) panel.style.display = "none";
    if (form) form.style.display = "block";
    clearPhoneLoginOtpInputs();
  }

  function showGoogleOtpStep(otpData, accessToken) {
    setGoogleOtpPending({
      challengeId: otpData.challenge_id,
      email: otpData.email,
      expiresAt: otpData.expires_at,
      accessToken
    });

    if (typeof window.navTo === "function") window.navTo("register");

    const step1 = select("#reg-step-1");
    const step2 = select("#reg-step-2");
    const step3 = select("#reg-step-3");
    if (!step1 || !step2) {
      const otp = window.prompt(`FoodSave đã gửi OTP về ${otpData.email}. Nhập mã 6 số:`);
      if (otp) verifyGoogleOtp(otp);
      return;
    }

    step1.style.display = "none";
    step2.style.display = "block";
    if (step3) step3.style.display = "none";
    setRegisterStepperVisible(true);
    const otpBackButton = select("#otp-back-button");
    if (otpBackButton) {
      otpBackButton.textContent = "← Chọn cách đăng ký khác";
      otpBackButton.onclick = backToRegisterMethods;
    }

    const target = select("#otp-target");
    if (target) target.textContent = otpData.email;

    const stepper1 = select("#rstep-1");
    const stepper2 = select("#rstep-2");
    const stepper3 = select("#rstep-3");
    if (stepper1) {
      stepper1.classList.remove("active");
      stepper1.classList.add("done");
      const num = stepper1.querySelector(".stepper-num");
      if (num) num.innerHTML = '<i class="ti ti-brand-google"></i>';
    }
    if (stepper2) stepper2.classList.add("active");
    if (stepper3) stepper3.classList.remove("active");

    clearOtpInputs();
    startGoogleOtpTimer(otpData.expires_in_seconds);
    notify("Đã gửi OTP Google", `Kiểm tra Gmail ${otpData.email} để hoàn tất đăng nhập.`, "info");
    window.setTimeout(() => document.querySelector(".otp-input")?.focus(), 100);
  }

  async function startGoogleLogin() {
    if (googleLoginPending) return;
    googleLoginPending = true;
    setOAuthButtonPending("google", true);
    let popup = null;
    try {
      setPendingOAuthProvider("google");
      const redirectTo = oauthRedirectUrl("google");
      popup = openOAuthPopup("google");
      const data = await request("/auth/google/start", {
        method: "POST",
        body: {
          redirect_to: redirectTo
        }
      });

      notify("Đang mở Google", "Sau khi chọn Gmail, FoodSave sẽ gửi OTP xác thực về email đó.", "info");
      if (popup && !popup.closed) {
        popup.location.href = data.auth_url;
        watchOAuthPopup("google", popup);
        return;
      }
      window.location.assign(data.auth_url);
    } catch (error) {
      if (popup && !popup.closed) popup.close();
      clearPendingOAuthProvider();
      notify("Không thể đăng nhập Google", error.message, "error");
      googleLoginPending = false;
      setOAuthButtonPending("google", false);
    }
  }

  async function startFacebookLogin() {
    if (facebookLoginPending) return;
    facebookLoginPending = true;
    setOAuthButtonPending("facebook", true);
    let popup = null;
    try {
      setPendingOAuthProvider("facebook");
      const redirectTo = oauthRedirectUrl("facebook");
      popup = openOAuthPopup("facebook");
      const data = await request("/auth/facebook/start", {
        method: "POST",
        body: {
          redirect_to: redirectTo
        }
      });

      notify("Đang mở Facebook", "Facebook sẽ hỏi bạn đồng ý liên kết FoodSave trước khi quay lại website.", "info");
      if (popup && !popup.closed) {
        popup.location.href = data.auth_url;
        watchOAuthPopup("facebook", popup);
        return;
      }
      window.location.assign(data.auth_url);
    } catch (error) {
      if (popup && !popup.closed) popup.close();
      clearPendingOAuthProvider();
      notify("Không thể đăng nhập Facebook", error.message, "error");
      facebookLoginPending = false;
      setOAuthButtonPending("facebook", false);
    }
  }

  async function requestGoogleOtp(accessToken, options) {
    const data = await request("/auth/google/otp", {
      method: "POST",
      body: {
        access_token: accessToken,
        expected_role: "customer"
      }
    });

    if (!options || options.showStep !== false) {
      showGoogleOtpStep(data, accessToken);
    }
    return data;
  }

  async function completeFacebookLogin(oauthHash) {
    if (!oauthHash.refreshToken) {
      throw new Error("Facebook callback thiếu refresh token. Vui lòng thử đăng nhập lại.");
    }

    const data = await request("/auth/facebook/callback", {
      method: "POST",
      body: {
        access_token: oauthHash.accessToken,
        refresh_token: oauthHash.refreshToken,
        expires_at: oauthHash.expiresAt,
        token_type: oauthHash.tokenType || "bearer",
        expected_role: "customer"
      }
    });

    clearPendingOAuthProvider();
    setOAuthButtonPending("facebook", false);
    saveSession(data, "customer");
    updateCustomerUiFromProfile(data.profile);
    notify("Đăng nhập Facebook thành công", "Bạn đã đồng ý liên kết Facebook với FoodSave.", "info");
    if (notifyOAuthOpener("facebook", data)) {
      window.setTimeout(() => window.close(), 250);
      return;
    }
    if (typeof window.navTo === "function") window.navTo("home");
  }

  async function handleOAuthCallback() {
    const oauthHash = readOAuthHash();
    if (!oauthHash) {
      const storedPhoneOtp = readStoredPhoneOtp();
      if (storedPhoneOtp) {
        const remainingSeconds = Math.max(0, Math.ceil((new Date(storedPhoneOtp.expiresAt).getTime() - Date.now()) / 1000));
        showPhoneLoginOtpPanel({
          phone: storedPhoneOtp.phone,
          expires_in_seconds: remainingSeconds
        });
        return;
      }

      const stored = readStoredGoogleOtp();
      if (stored) {
        const remainingSeconds = Math.max(0, Math.ceil((new Date(stored.expiresAt).getTime() - Date.now()) / 1000));
        showGoogleOtpStep({
          challenge_id: stored.challengeId,
          email: stored.email,
          expires_at: stored.expiresAt,
          expires_in_seconds: remainingSeconds
        }, stored.accessToken);
      }
      return;
    }

    const provider = normalizeOAuthProvider(readPendingOAuthProvider()) || readOAuthProviderFromUrl() || "google";
    clearOAuthHash();

    if (oauthHash.error) {
      notify(provider === "facebook" ? "Đăng nhập Facebook thất bại" : "Đăng nhập Google thất bại", oauthHash.error, "error");
      clearPendingOAuthProvider();
      setOAuthButtonPending(provider, false);
      return;
    }

    try {
      if (provider === "facebook") {
        notify("Facebook đã xác nhận", "FoodSave đang hoàn tất đăng nhập.", "info");
        await completeFacebookLogin(oauthHash);
        return;
      }

      notify("Google đã xác thực", "FoodSave đang gửi OTP về Gmail của bạn.", "info");
      if (window.opener && window.opener !== window) {
        const otpData = await requestGoogleOtp(oauthHash.accessToken, { showStep: false });
        if (notifyOAuthOpener("google", { otpData, accessToken: oauthHash.accessToken })) {
          window.setTimeout(() => window.close(), 250);
          return;
        }
        showGoogleOtpStep(otpData, oauthHash.accessToken);
      } else {
        await requestGoogleOtp(oauthHash.accessToken);
      }
      setOAuthButtonPending("google", false);
    } catch (error) {
      clearPendingOAuthProvider();
      clearGoogleOtpPending();
      setOAuthButtonPending(provider, false);
      notify(provider === "facebook" ? "Không thể đăng nhập Facebook" : "Không thể gửi OTP Google", error.message, "error");
    }
  }

  async function resendGoogleOtp() {
    const pending = googleOtpPending || readStoredGoogleOtp();
    if (!pending || !pending.accessToken) {
      notify("Cần đăng nhập Google lại", "Phiên Google đã hết hạn trước khi gửi lại OTP.", "warn");
      return;
    }

    try {
      await requestGoogleOtp(pending.accessToken);
    } catch (error) {
      notify("Không thể gửi lại OTP", error.message, "error");
    }
  }

  async function requestPhoneLoginOtp(phone) {
    const data = await request("/auth/phone/otp", {
      method: "POST",
      body: {
        phone,
        expected_role: "customer"
      }
    });

    showPhoneLoginOtpPanel(data);
    notify("Đã gửi OTP SMS", `Kiểm tra tin nhắn được gửi tới ${maskPhone(data.phone)}.`, "info");
  }

  async function startPhoneLoginOtp() {
    if (phoneLoginOtpPending) return;
    phoneLoginOtpPending = true;
    try {
      const phoneTab = select("#login-phone-tab");
      if (phoneTab && !visible(phoneTab)) {
        notify("Chọn số điện thoại", "Vui lòng mở tab Số điện thoại rồi nhập số cần nhận OTP.", "warn");
        return;
      }

      await requestPhoneLoginOtp(phoneLoginValue());
    } catch (error) {
      notify("Không thể gửi OTP SMS", error.message, "error");
    } finally {
      phoneLoginOtpPending = false;
    }
  }

  async function resendPhoneLoginOtp() {
    const pending = phoneOtpPending || readStoredPhoneOtp();
    if (!pending || !pending.phone) {
      notify("Cần nhập lại số điện thoại", "Phiên OTP SMS đã hết hạn trước khi gửi lại mã.", "warn");
      cancelPhoneLoginOtp();
      return;
    }

    try {
      await requestPhoneLoginOtp(pending.phone);
    } catch (error) {
      notify("Không thể gửi lại OTP SMS", error.message, "error");
    }
  }

  async function verifyPhoneLoginOtp(otpOverride) {
    const pending = phoneOtpPending || readStoredPhoneOtp();
    if (!pending || !pending.phone) {
      notify("OTP đã hết hạn", "Vui lòng nhập số điện thoại để nhận mã mới.", "warn");
      cancelPhoneLoginOtp();
      return;
    }

    const otp = otpOverride || readPhoneOtpInput();
    if (!/^\d{6}$/.test(otp)) {
      notify("Thiếu mã OTP", "Vui lòng nhập đủ 6 số OTP trong SMS.", "warn");
      return;
    }

    try {
      const data = await request("/auth/phone/verify", {
        method: "POST",
        body: {
          phone: pending.phone,
          otp,
          expected_role: "customer"
        }
      });

      clearPhoneOtpPending();
      saveSession(data, "customer");
      updateCustomerUiFromProfile(data.profile);
      notify("Đăng nhập thành công", "OTP SMS đã được xác thực.", "info");
      if (typeof window.navTo === "function") window.navTo("home");
    } catch (error) {
      notify("Xác thực OTP thất bại", error.message, "error");
    }
  }

  async function verifyGoogleOtp(otp) {
    const pending = googleOtpPending || readStoredGoogleOtp();
    if (!pending) {
      notify("OTP đã hết hạn", "Vui lòng đăng nhập Google lại để nhận mã mới.", "warn");
      return;
    }

    try {
      const data = await request("/auth/google/verify", {
        method: "POST",
        body: {
          challenge_id: pending.challengeId,
          otp,
          expected_role: "customer"
        }
      });

      clearGoogleOtpPending();
      clearPendingOAuthProvider();
      saveSession(data, "customer");
      updateCustomerUiFromProfile(data.profile);
      notify("Đăng nhập Google thành công", "OTP đã được xác thực và phiên FoodSave đã sẵn sàng.", "info");
      if (typeof window.navTo === "function") window.navTo("home");
    } catch (error) {
      notify("Xác thực OTP thất bại", error.message, "error");
    }
  }

  function verifyCustomerOtp() {
    if (!googleOtpPending && !readStoredGoogleOtp()) {
      registerCustomer();
      return;
    }

    const otp = Array.from(document.querySelectorAll(".otp-input")).map((input) => input.value).join("");
    if (!/^\d{6}$/.test(otp)) {
      notify("Thiếu mã OTP", "Vui lòng nhập đủ 6 số OTP trong Gmail.", "warn");
      return;
    }

    verifyGoogleOtp(otp);
  }

  function socialLogin(provider) {
    if (provider === "google") {
      startGoogleLogin();
      return;
    }

    if (provider === "facebook") {
      startFacebookLogin();
      return;
    }

    oauthNotice();
  }

  async function registerCustomer() {
    if (customerRegisterPending) return;
    customerRegisterPending = true;
    try {
      const fullName = requireValue("#reg-name", "họ tên");
      const phone = `${readValue("#reg-country") || "+84"} ${requireValue("#reg-phone", "số điện thoại")}`;
      const email = requireValue("#reg-email", "email");
      const password = requireValue("#reg-password", "mật khẩu");
      const passwordConfirm = requireValue("#reg-password2", "mật khẩu xác nhận");

      if (password !== passwordConfirm) throw new Error("Mật khẩu xác nhận không khớp");
      if (!select("#reg-terms") || !select("#reg-terms").checked) throw new Error("Vui lòng đồng ý điều khoản dịch vụ");

      const data = await request("/auth/register/customer", {
        method: "POST",
        body: {
          full_name: fullName,
          email,
          phone,
          password,
          date_of_birth: readValue("#reg-dob") || undefined,
          gender: readValue("#reg-gender") || undefined,
          referral_code: readValue("#reg-referral") || undefined,
          marketing_opt_in: !!(select("#reg-marketing") && select("#reg-marketing").checked),
          terms_accepted: true
        }
      });

      saveSession(data, "customer");
      updateCustomerUiFromProfile(data.profile);
      window.registrationData = { name: fullName, phone, email };

      if (select("#reg-step-1")) select("#reg-step-1").style.display = "none";
      if (select("#reg-step-2")) select("#reg-step-2").style.display = "none";
      if (select("#reg-step-3")) select("#reg-step-3").style.display = "block";
      if (select("#reg-welcome-name")) select("#reg-welcome-name").textContent = fullName;
      if (select("#rstep-1")) select("#rstep-1").classList.add("done");
      if (select("#rstep-2")) select("#rstep-2").classList.add("done");
      if (select("#rstep-3")) select("#rstep-3").classList.add("active");

      notify("Tạo tài khoản thành công", "Session đã được lưu an toàn trên trình duyệt.", "info");
    } catch (error) {
      notify("Đăng ký thất bại", error.message, "error");
    } finally {
      customerRegisterPending = false;
    }
  }

  async function resetPassword(identifier) {
    const value = identifier || readValue("#fp-email-tab input") || readValue("#fp-phone-tab input") || readValue("#auth-reset-email");
    if (!value) {
      notify("Thiếu thông tin", "Vui lòng nhập email hoặc số điện thoại.", "warn");
      return;
    }

    try {
      await request("/auth/password-reset", {
        method: "POST",
        body: { identifier: value }
      });
      notify("Đã gửi yêu cầu", "Nếu tài khoản tồn tại, FoodSave sẽ gửi email đặt lại mật khẩu.", "info");
      if (typeof window.navTo === "function") window.navTo("login");
      if (typeof window.rAuth === "function") {
        window.aS = "login";
        window.rAuth();
      }
    } catch (error) {
      notify("Không thể gửi yêu cầu", error.message, "error");
    }
  }

  async function logout(role) {
    const session = readSession();
    try {
      if (session && session.accessToken) {
        await request("/auth/logout", {
          method: "POST",
          token: session.accessToken
        });
      }
    } catch (error) {
      notify("Đăng xuất cục bộ", "Phiên backend không phản hồi, token trình duyệt đã được xóa.", "warn");
    } finally {
      clearSession();
      if (role === "customer" && typeof window.navTo === "function") window.navTo("landing");
      if ((role === "partner" || role === "charity") && typeof window.goView === "function") window.goView("landing");
      notify("Đã đăng xuất", "Phiên đăng nhập đã được xóa khỏi trình duyệt.", "info");
    }
  }

  function portalLoginPage(role) {
    const config = portalConfig[role];
    const label = role === "partner" ? "cửa hàng" : "tổ chức";
    const registerLabel = role === "partner" ? "Đăng ký cửa hàng đối tác" : "Đăng ký tổ chức từ thiện";
    const sampleEmail = "email@domain.com";

    return `
<h2 class="auth-h">Đăng nhập ${label}</h2>
<p class="auth-sub">Backend sẽ xác thực Supabase Auth và chỉ cho đúng vai trò ${config.expectedRole} vào cổng này</p>
<div class="field"><label>Email / Số điện thoại</label><input class="inp" id="auth-login-identifier" autocomplete="username" placeholder="${sampleEmail}"></div>
<div class="field"><div class="f ac jb m6"><label style="margin-bottom:0">Mật khẩu</label><span style="font-size:11.5px;color:${config.accent};cursor:pointer;font-weight:800" onclick="aS='forgot';rAuth()">Quên mật khẩu?</span></div><input class="inp" id="auth-login-password" type="password" autocomplete="current-password" placeholder="Nhập mật khẩu"></div>
<div class="f ac g8 m16"><input type="checkbox" id="rmm" style="accent-color:${config.accent};width:16px;height:16px"><label for="rmm" style="font-size:12.5px;color:var(--muted);cursor:pointer;font-weight:500">Ghi nhớ đăng nhập</label></div>
<button class="btn btn-primary btn-lg" style="width:100%;justify-content:center;margin-bottom:12px" onclick="FoodSaveAuth.loginPortal('${role}')"><i class="ti ti-login"></i> Đăng nhập</button>
<button class="btn btn-o btn-lg" style="width:100%;justify-content:center;margin-bottom:24px" onclick="FoodSaveAuth.oauthNotice()"><i class="ti ti-fingerprint"></i> Sinh trắc học / SSO</button>
<div style="text-align:center;border-top:1px solid var(--line);padding-top:18px">
  <p style="font-size:13px;color:var(--muted);margin-bottom:14px;font-weight:600">Chưa có tài khoản ${label}?</p>
  <button class="btn btn-accent btn-lg" style="width:100%;justify-content:center" onclick="aS='register';regStep=0;rAuth()"><i class="ti ti-rocket"></i> ${registerLabel}</button>
</div>`;
  }

  function portalForgotPage(role) {
    const label = role === "partner" ? "cửa hàng" : "tổ chức";
    const sampleEmail = "email@domain.com";

    return `
<h2 class="auth-h">Quên mật khẩu</h2>
<p class="auth-sub">Nhập email ${label} để nhận link đặt lại mật khẩu</p>
<div class="field"><label>Email ${label}</label><input class="inp" id="auth-reset-email" autocomplete="email" placeholder="${sampleEmail}"></div>
<button class="btn btn-primary btn-lg" style="width:100%;justify-content:center;margin-bottom:10px;margin-top:8px" onclick="FoodSaveAuth.resetPassword(document.querySelector('#auth-reset-email') ? document.querySelector('#auth-reset-email').value : '')"><i class="ti ti-mail"></i> Gửi link đặt lại</button>
<button class="btn btn-o" style="width:100%;justify-content:center" onclick="aS='login';rAuth()"><i class="ti ti-arrow-left"></i> Quay lại</button>`;
  }

  function portalRegisterAccountPage(role) {
    const isPartner = role === "partner";
    return `
<h2 class="auth-h" style="font-size:28px">${isPartner ? "Tạo tài khoản cửa hàng" : "Tạo tài khoản tổ chức"}</h2>
<p class="auth-sub">${isPartner ? "Thông tin cơ bản của cửa hàng đối tác" : "Thông tin cơ bản của tổ chức từ thiện"}</p>
<div class="field"><label>${isPartner ? "Tên cửa hàng" : "Tên tổ chức"}</label><input class="inp" id="auth-register-name" placeholder="${isPartner ? "Nhập tên cửa hàng" : "Nhập tên tổ chức"}"></div>
<div class="field"><label>Email đăng nhập</label><input class="inp" id="auth-register-email" type="email" autocomplete="email" placeholder="email@domain.com"></div>
<div class="field"><label>Số điện thoại</label><input class="inp" id="auth-register-phone" autocomplete="tel" placeholder="+84 912 345 678"></div>
<div class="field"><label>Người đại diện</label><input class="inp" id="auth-register-representative" autocomplete="name" placeholder="Nhập họ tên người đại diện"></div>
<div class="field"><label>Mật khẩu</label><input class="inp" id="auth-register-password" type="password" autocomplete="new-password" placeholder="Tối thiểu 8 ký tự, có chữ hoa và số"></div>
<div class="field"><label>${isPartner ? "Địa chỉ cửa hàng" : "Địa chỉ trụ sở"}</label><input class="inp" id="auth-register-address" placeholder="Nhập địa chỉ hoạt động"></div>
<label style="display:flex;gap:10px;align-items:flex-start;font-size:12.5px;margin:12px 0 16px;color:var(--muted);cursor:pointer"><input type="checkbox" id="auth-register-terms" style="accent-color:${isPartner ? "var(--green-700)" : "var(--rose)"};margin-top:2px">Tôi đồng ý với điều khoản dịch vụ và chính sách bảo mật FoodSave.</label>
<button class="btn btn-primary btn-lg" style="width:100%;justify-content:center;margin-top:8px" onclick="FoodSaveAuth.capturePortalAccount('${role}')">Tiếp tục <i class="ti ti-arrow-right"></i></button>`;
  }

  function capturePortalAccount(role) {
    try {
      const name = requireValue("#auth-register-name", role === "partner" ? "tên cửa hàng" : "tên tổ chức");
      const email = requireValue("#auth-register-email", "email");
      const phone = normalizePhone(requireValue("#auth-register-phone", "số điện thoại"));
      const representative = requireValue("#auth-register-representative", "người đại diện");
      const password = requireValue("#auth-register-password", "mật khẩu");
      const address = requireValue("#auth-register-address", "địa chỉ");
      if (!select("#auth-register-terms") || !select("#auth-register-terms").checked) throw new Error("Vui lòng đồng ý điều khoản dịch vụ");

      window.FoodSavePortalRegistration = {
        name,
        email,
        phone,
        representative,
        password,
        address
      };

      regStep = 2;
      window.rAuth();
    } catch (error) {
      notify("Thiếu thông tin", error.message, "warn");
    }
  }

  async function registerPortal(role) {
    if (portalRegisterPending) return;
    portalRegisterPending = true;
    const account = window.FoodSavePortalRegistration || {};
    const selectedType = typeof selBType === "string" && selBType ? selBType : "other";

    try {
      if (!account.email || !account.password || !account.name) {
        regStep = 0;
        window.rAuth();
        throw new Error("Vui lòng nhập lại thông tin tài khoản");
      }

      const body = role === "partner"
        ? {
            store_name: account.name,
            email: account.email,
            phone: account.phone,
            password: account.password,
            address: account.address,
            city: "TP.HCM",
            business_type: selectedType,
            representative_name: account.representative,
            terms_accepted: true
          }
        : {
            organization_name: account.name,
            email: account.email,
            phone: account.phone,
            password: account.password,
            address: account.address,
            city: "TP.HCM",
            organization_type: selectedType,
            representative_name: account.representative,
            beneficiaries_count: 0,
            meals_per_day: 0,
            volunteer_count: 0,
            service_radius_km: 5,
            terms_accepted: true
          };

      const data = await request(portalConfig[role].registerEndpoint, {
        method: "POST",
        body
      });

      saveSession(data, role);
      notify("Đăng ký thành công", portalConfig[role].pendingMessage, "info");
      enterPortalWithAuth(role, data);
    } catch (error) {
      notify("Đăng ký thất bại", error.message, "error");
    } finally {
      portalRegisterPending = false;
    }
  }

  async function loginPortal(role) {
    if (portalLoginPending) return;
    portalLoginPending = true;
    try {
      const data = await request("/auth/login", {
        method: "POST",
        body: {
          identifier: requireValue("#auth-login-identifier", "email hoặc số điện thoại"),
          password: requireValue("#auth-login-password", "mật khẩu"),
          expected_role: portalConfig[role].expectedRole
        }
      });

      saveSession(data, role);
      enterPortalWithAuth(role, data);
    } catch (error) {
      notify("Đăng nhập thất bại", error.message, "error");
    } finally {
      portalLoginPending = false;
    }
  }

  function enterPortalWithAuth(role, data) {
    const contextName = role === "partner"
      ? data.context && data.context.store && data.context.store.name
      : data.context && data.context.charity && data.context.charity.name;
    const name = contextName || (data.profile && data.profile.full_name) || portalConfig[role].defaultName;
    const message = data.profile && data.profile.status === "pending"
      ? portalConfig[role].pendingMessage
      : portalConfig[role].loginMessage;

    if (typeof window.goView === "function") window.goView("portal");
    if (typeof window.R === "function") window.R();
    notify(portalConfig[role].loginTitle, `Chào ${name}. ${message}`, "info");
  }

  function oauthNotice() {
    clearTimeout(oauthNoticeTimer);
    notifyOnce(
      "oauth",
      "Nhà cung cấp chưa bật",
      "Zalo và Apple cần cấu hình OAuth provider riêng. Hiện tại Google và Facebook đã dùng flow OAuth qua Supabase.",
      "warn",
      2500
    );
    oauthNoticeTimer = window.setTimeout(() => {
      window.__foodsaveNotify_oauth = 0;
    }, 2500);
  }

  window.FoodSaveAuth = {
    request,
    readSession,
    saveSession,
    clearSession,
    loginCustomer,
    registerCustomer,
    startGoogleLogin,
    startFacebookLogin,
    requestGoogleOtp,
    verifyGoogleOtp,
    resendGoogleOtp,
    startPhoneLoginOtp,
    resendPhoneLoginOtp,
    verifyPhoneLoginOtp,
    resetPassword,
    logout,
    loginPortal,
    registerPortal,
    capturePortalAccount,
    beginPhoneSignup,
    backToRegisterMethods,
    oauthNotice
  };

  if (pageRole === "customer") {
    window.doLogin = loginCustomer;
    window.goToOTP = registerCustomer;
    window.verifyOTP = verifyCustomerOtp;
    window.sendReset = function () { resetPassword(); };
    window.socialLogin = socialLogin;
    window.beginPhoneSignup = beginPhoneSignup;
    window.backToRegisterMethods = backToRegisterMethods;
    window.loginWithOTP = startPhoneLoginOtp;
    window.phoneOtpMove = phoneOtpMove;
    window.phoneOtpKey = phoneOtpKey;
    window.resendPhoneLoginOtp = resendPhoneLoginOtp;
    window.verifyPhoneLoginOtp = verifyPhoneLoginOtp;
    window.cancelPhoneLoginOtp = cancelPhoneLoginOtp;
    window.otpUseEmail = function () {
      if (googleOtpPending || readStoredGoogleOtp()) {
        resendGoogleOtp();
        return;
      }
      notify("OTP email", "Vui lòng dùng nút Google để nhận OTP qua Gmail.", "warn");
    };
    window.otpUseVoice = function () {
      notify("OTP qua cuộc gọi chưa bật", "Google login hiện xác thực bằng OTP gửi về Gmail.", "warn");
    };
    window.logout = function () { logout("customer"); };
    window.addEventListener("message", handleOAuthPopupMessage);
    handleOAuthCallback();
    return;
  }

  if (portalConfig[pageRole]) {
    window.loginPage = function () { return portalLoginPage(pageRole); };
    window.forgotPage = function () { return portalForgotPage(pageRole); };
    window.regAccount = function () { return portalRegisterAccountPage(pageRole); };
    window.regNext = function () {
      if (regStep === 0) {
        capturePortalAccount(pageRole);
        return;
      }
      if (regStep < 7) {
        regStep += 1;
        window.rAuth();
        return;
      }
      registerPortal(pageRole);
    };
    window.regBack = function () {
      if (regStep <= 2) regStep = 0;
      else regStep -= 1;
      window.rAuth();
    };
    window.enterPortal = function () {
      const session = readSession();
      if (session && session.role === pageRole) {
        enterPortalWithAuth(pageRole, {
          profile: session.profile,
          context: session.context
        });
        return;
      }
      loginPortal(pageRole);
    };
  }
})();
