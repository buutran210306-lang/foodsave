(function () {
  "use strict";

  const LOCAL_API_BASE_URL = "http://localhost:8080/api/v1";
  const API_PATH = "/api/v1";
  const AUTH_STORAGE_KEY = "foodsave.auth.session";
  const PHONE_OTP_STORAGE_KEY = "foodsave.auth.phoneOtp";
  const SUPABASE_URL = "https://pggcbgtoxlhlgmwxupoc.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_SYM7q7GKZviIk4u66-ECRw_HwBlh96p";
  let oauthNoticeTimer = 0;
  let customerLoginPending = false;
  let customerRegisterPending = false;
  let googleLoginPending = false;
  let facebookLoginPending = false;
  let phoneLoginOtpPending = false;
  let phoneOtpPending = null;
  let phoneOtpTimer = 0;
  let portalLoginPending = false;
  let portalRegisterPending = false;
  let supabaseAuthInitialized = false;

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

  function getFoodSaveSupabase() {
    if (window.foodsaveSupabase) return window.foodsaveSupabase;
    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      throw new Error("Supabase JS chưa sẵn sàng. Hãy kiểm tra thứ tự nhúng script @supabase/supabase-js.");
    }

    window.foodsaveSupabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    return window.foodsaveSupabase;
  }

  window.getFoodSaveSupabaseClient = getFoodSaveSupabase;

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

  function customerProfileFromSupabaseSession(session) {
    const user = session && session.user ? session.user : {};
    const metadata = user.user_metadata || {};
    const appMetadata = user.app_metadata || {};
    const fullName = metadata.full_name || metadata.name || metadata.display_name || user.email || user.phone || "bạn";
    const provider = appMetadata.provider || (user.email ? "email" : user.phone ? "phone" : "supabase");

    return {
      id: user.id,
      email: user.email || "",
      phone: user.phone || "",
      full_name: fullName,
      avatar_url: metadata.avatar_url || metadata.picture || "",
      provider
    };
  }

  function syncSupabaseCustomerSession(session, options) {
    if (!session || !session.access_token) return null;

    const profile = customerProfileFromSupabaseSession(session);
    const authSession = saveSession({
      session: {
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_at: session.expires_at
      },
      profile,
      context: {
        provider: profile.provider,
        source: "supabase"
      }
    }, "customer");

    updateCustomerUiFromProfile(profile);
    setOAuthButtonPending("google", false);
    setOAuthButtonPending("facebook", false);
    googleLoginPending = false;
    facebookLoginPending = false;

    if (options && options.navigateHome && typeof window.navTo === "function") {
      window.navTo("home");
    }

    return authSession;
  }

  function shouldNavigateHomeAfterSupabaseAuth() {
    const activePage = document.querySelector(".page.active");
    return !activePage || ["page-landing", "page-login", "page-register"].includes(activePage.id);
  }

  function shouldHoldEmailOtpNavigation() {
    const flow = window.__foodsaveEmailOtpFlow;
    return Boolean(flow && ["pending", "details"].includes(flow.phase));
  }

  function initSupabaseCustomerAuth() {
    if (supabaseAuthInitialized) return;
    supabaseAuthInitialized = true;

    let client;
    try {
      client = getFoodSaveSupabase();
    } catch (error) {
      return;
    }

    client.auth.onAuthStateChange((event, session) => {
      if (session) {
        syncSupabaseCustomerSession(session, {
          navigateHome: !shouldHoldEmailOtpNavigation() && (event === "SIGNED_IN" || shouldNavigateHomeAfterSupabaseAuth())
        });
        return;
      }

      if (event === "SIGNED_OUT") {
        clearSession();
      }
    });

    client.auth.getSession().then(({ data, error }) => {
      if (error || !data || !data.session) return;
      syncSupabaseCustomerSession(data.session, {
        navigateHome: !shouldHoldEmailOtpNavigation() && shouldNavigateHomeAfterSupabaseAuth()
      });
    }).catch(() => {
      // Supabase session hydration can fail when storage is blocked; login can still be retried.
    });
  }

  async function loginCustomer() {
    if (customerLoginPending) return;
    customerLoginPending = true;
    try {
      const emailTab = select("#login-email-tab");
      if (emailTab && visible(emailTab)) {
        if (typeof window.sendEmailLoginOtp === "function") {
          await window.sendEmailLoginOtp();
          return;
        }
        notify("Đang tải OTP Email", "Vui lòng thử lại sau vài giây.", "warn");
        return;
      }

      await startPhoneLoginOtp();
    } catch (error) {
      notify("Không thể gửi OTP", error.message, "error");
    } finally {
      customerLoginPending = false;
    }
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
    let remaining = Math.max(0, Number(seconds || 180));

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
    const expiresInSeconds = Number(otpData.expires_in_seconds || 180);
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();
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
    startPhoneOtpTimer(expiresInSeconds);
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

  function supabaseOAuthRedirectUrl(provider) {
    const location = window.location;
    const isHttp = location.protocol === "http:" || location.protocol === "https:";
    if (!isHttp) {
      const label = provider === "facebook" ? "Facebook" : "Google";
      throw new Error(`${label} OAuth cần mở FOODSAVE_USER.html qua HTTP/HTTPS, không hỗ trợ file://.`);
    }

    const url = new URL(location.href);
    url.hash = "";
    url.searchParams.delete("oauth_provider");
    return url.toString();
  }

  async function startGoogleLogin() {
    if (googleLoginPending) return;
    window.__foodsaveEmailOtpFlow = null;
    googleLoginPending = true;
    setOAuthButtonPending("google", true);

    try {
      const { error } = await getFoodSaveSupabase().auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: supabaseOAuthRedirectUrl("google")
        }
      });
      if (error) throw error;
    } catch (error) {
      googleLoginPending = false;
      setOAuthButtonPending("google", false);
      notify("Không thể mở Google", error.message, "error");
    }
  }

  async function startFacebookLogin() {
    if (facebookLoginPending) return;
    window.__foodsaveEmailOtpFlow = null;
    facebookLoginPending = true;
    setOAuthButtonPending("facebook", true);

    try {
      const { error } = await getFoodSaveSupabase().auth.signInWithOAuth({
        provider: "facebook",
        options: {
          redirectTo: supabaseOAuthRedirectUrl("facebook")
        }
      });
      if (error) throw error;
    } catch (error) {
      facebookLoginPending = false;
      setOAuthButtonPending("facebook", false);
      notify("Không thể mở Facebook", error.message, "error");
    }
  }

  function restorePhoneOtpAfterReload() {
    const storedPhoneOtp = readStoredPhoneOtp();
    if (!storedPhoneOtp) return;

    const remainingSeconds = Math.max(0, Math.ceil((new Date(storedPhoneOtp.expiresAt).getTime() - Date.now()) / 1000));
    showPhoneLoginOtpPanel({
      phone: storedPhoneOtp.phone,
      expires_in_seconds: remainingSeconds
    });
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

  function verifyCustomerOtp() {
    registerCustomer();
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

  window.loginSupabaseGoogle = startGoogleLogin;
  window.loginSupabaseFacebook = startFacebookLogin;

  window.FoodSaveAuth = {
    request,
    readSession,
    saveSession,
    clearSession,
    loginCustomer,
    registerCustomer,
    getSupabaseClient: getFoodSaveSupabase,
    syncSupabaseCustomerSession,
    startGoogleLogin,
    startFacebookLogin,
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
    window.loginSupabaseGoogle = startGoogleLogin;
    window.loginSupabaseFacebook = startFacebookLogin;
    window.loginWithGoogle = startGoogleLogin;
    window.loginWithFacebook = startFacebookLogin;
    window.beginPhoneSignup = beginPhoneSignup;
    window.backToRegisterMethods = backToRegisterMethods;
    window.loginWithOTP = startPhoneLoginOtp;
    window.phoneOtpMove = phoneOtpMove;
    window.phoneOtpKey = phoneOtpKey;
    window.resendPhoneLoginOtp = resendPhoneLoginOtp;
    window.verifyPhoneLoginOtp = verifyPhoneLoginOtp;
    window.cancelPhoneLoginOtp = cancelPhoneLoginOtp;
    window.logout = function () { logout("customer"); };
    restorePhoneOtpAfterReload();
    initSupabaseCustomerAuth();
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
