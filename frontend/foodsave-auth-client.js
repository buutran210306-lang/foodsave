(function () {
  "use strict";

  const LOCAL_API_BASE_URL = "http://localhost:8080/api/v1";
  const API_PATH = "/api/v1";
  const AUTH_STORAGE_KEY = "foodsave.auth.session";
  const PHONE_OTP_STORAGE_KEY = "foodsave.auth.phoneOtp";
  const SUPABASE_URL = "https://uqyqayrwhcicuctfnwix.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_tUk1J3EpJfW4h9SkPDg_hg_FAJPOUuX";
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
  let charityOtpPending = false;
  let charityVerifyPending = false;
  let charitySubmitPending = false;
  let partnerOtpPending = false;
  let partnerVerifyPending = false;
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

  // PARTNER SECTION START
  function getPartnerLoginSupabaseClient() {
    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      throw new Error("Supabase JS chưa sẵn sàng. Hãy kiểm tra thứ tự nhúng script @supabase/supabase-js.");
    }

    return window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    });
  }
  // PARTNER SECTION END

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

  async function getCurrentSupabaseUser(client) {
    if (client && client.auth && typeof client.auth.getUser === "function") {
      const { data, error } = await client.auth.getUser();
      if (error) throw error;
      if (data && data.user) return data.user;
    }

    if (client && client.auth && typeof client.auth.user === "function") {
      return client.auth.user();
    }

    return null;
  }

  async function upsertCustomerProfile(profileInput) {
    const client = getFoodSaveSupabase();
    const user = await getCurrentSupabaseUser(client);
    const userId = user && user.id ? user.id : "";

    if (!userId) {
      throw new Error("Không tìm thấy phiên người dùng Supabase để cập nhật hồ sơ.");
    }

    const acceptedAt = profileInput.terms_accepted_at || new Date().toISOString();
    const metadata = {
      ...(profileInput.metadata || {}),
      terms_accepted: true,
      profile_completed_at: acceptedAt
    };

    const payload = {
      id: userId,
      role: "customer",
      email: user.email ? String(user.email).toLowerCase() : undefined,
      full_name: profileInput.full_name,
      phone: profileInput.phone,
      auth_provider: "email",
      terms_accepted_at: acceptedAt,
      metadata
    };

    Object.keys(payload).forEach((key) => {
      if (payload[key] === undefined || payload[key] === "") delete payload[key];
    });

    const { data, error } = await client
      .from("profiles")
      .upsert(payload, { onConflict: "id" })
      .select("*")
      .single();

    if (error) throw error;
    return data;
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

  const PARTNER_REGISTER_STEPS = [
    "Liên hệ",
    "OTP",
    "eKYC",
    "Cửa hàng",
    "Tài chính",
    "Vận hành",
    "Chờ duyệt"
  ];

  const PARTNER_BUSINESS_TYPES = [
    { id: "bakery", label: "Tiệm bánh", icon: "ti-bread" },
    { id: "restaurant", label: "Nhà hàng/Bếp ăn", icon: "ti-chef-hat" },
    { id: "convenience", label: "Cửa hàng tiện lợi", icon: "ti-building-store" },
    { id: "supermarket", label: "Siêu thị", icon: "ti-shopping-cart" }
  ];

  const PARTNER_BANKS = ["Vietcombank", "Techcombank", "BIDV", "MB Bank", "VPBank", "ACB", "Sacombank", "VietinBank"];
  const PARTNER_STORAGE_BUCKET = "partner-assets";
  const PARTNER_DOCUMENT_FIELDS = ["cccdFront", "cccdBack", "businessLicense", "businessLicenseExtra", "foodSafety", "logo", "cover"];
  const CHARITY_STORAGE_BUCKET = "charity_documents";
  const CHARITY_DOCUMENT_FIELDS = ["logo", "cover", "cccdFront", "cccdBack", "decision", "license", "finance", "coverImage", "financialReport", "idCard"];
  const PORTAL_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const VIETNAM_PROVINCE_2025_MAP = {
    "yen bai": "Lào Cai",
    "lao cai": "Lào Cai",
    "bac kan": "Thái Nguyên",
    "thai nguyen": "Thái Nguyên",
    "vinh phuc": "Phú Thọ",
    "hoa binh": "Phú Thọ",
    "phu tho": "Phú Thọ",
    "bac giang": "Bắc Ninh",
    "bac ninh": "Bắc Ninh",
    "thai binh": "Hưng Yên",
    "hung yen": "Hưng Yên",
    "hai duong": "Hải Phòng",
    "hai phong": "Hải Phòng",
    "ha nam": "Ninh Bình",
    "nam dinh": "Ninh Bình",
    "ninh binh": "Ninh Bình",
    "quang binh": "Quảng Trị",
    "quang tri": "Quảng Trị",
    "quang nam": "Đà Nẵng",
    "da nang": "Đà Nẵng",
    "kon tum": "Quảng Ngãi",
    "quang ngai": "Quảng Ngãi",
    "binh dinh": "Gia Lai",
    "gia lai": "Gia Lai",
    "ninh thuan": "Khánh Hòa",
    "khanh hoa": "Khánh Hòa",
    "dak nong": "Lâm Đồng",
    "binh thuan": "Lâm Đồng",
    "lam dong": "Lâm Đồng",
    "phu yen": "Đắk Lắk",
    "dak lak": "Đắk Lắk",
    "ba ria vung tau": "TP.HCM",
    "ba ria - vung tau": "TP.HCM",
    "binh duong": "TP.HCM",
    "ho chi minh": "TP.HCM",
    "thanh pho ho chi minh": "TP.HCM",
    "tp hcm": "TP.HCM",
    "tphcm": "TP.HCM",
    "binh phuoc": "Đồng Nai",
    "dong nai": "Đồng Nai",
    "long an": "Tây Ninh",
    "tay ninh": "Tây Ninh",
    "soc trang": "Cần Thơ",
    "hau giang": "Cần Thơ",
    "can tho": "Cần Thơ",
    "ben tre": "Vĩnh Long",
    "tra vinh": "Vĩnh Long",
    "vinh long": "Vĩnh Long",
    "tien giang": "Đồng Tháp",
    "dong thap": "Đồng Tháp",
    "bac lieu": "Cà Mau",
    "ca mau": "Cà Mau",
    "kien giang": "An Giang",
    "an giang": "An Giang",
    "ha giang": "Tuyên Quang",
    "tuyen quang": "Tuyên Quang",
    "cao bang": "Cao Bằng",
    "dien bien": "Điện Biên",
    "ha tinh": "Hà Tĩnh",
    "lai chau": "Lai Châu",
    "lang son": "Lạng Sơn",
    "nghe an": "Nghệ An",
    "quang ninh": "Quảng Ninh",
    "son la": "Sơn La",
    "thanh hoa": "Thanh Hóa",
    "ha noi": "Hà Nội",
    "hue": "Huế"
  };

  function partnerState() {
    const current = window.FoodSavePortalRegistration || {};
    window.FoodSavePortalRegistration = {
      ...current,
      account: current.account || {},
      profile: current.profile || {},
      location: current.location || {},
      operations: current.operations || {},
      docs: current.docs || {},
      uploads: current.uploads || {},
      ekyc: current.ekyc || {},
      otp: current.otp || {},
      automation: current.automation || { dynamicPricing: true, charityTransfer: true },
      finance: current.finance || {}
    };
    return window.FoodSavePortalRegistration;
  }

  function setPartnerStep(step) {
    window.regStep = Math.max(0, Math.min(PARTNER_REGISTER_STEPS.length - 1, Number(step) || 0));
    try { regStep = window.regStep; } catch (error) { /* global regStep can be absent outside portal pages. */ }
  }

  function partnerStep() {
    let current = window.regStep;
    try {
      if (typeof regStep !== "undefined") current = regStep;
    } catch (error) {
      /* global regStep can be absent outside portal pages. */
    }
    const step = Number(current);
    return Number.isFinite(step) ? Math.max(0, Math.min(PARTNER_REGISTER_STEPS.length - 1, step)) : 0;
  }

  function setPortalAuthState(nextState) {
    window.aS = nextState;
    try { aS = nextState; } catch (error) { /* global aS can be absent outside portal pages. */ }
  }

  function portalAuthState() {
    let state = window.aS;
    try {
      if (typeof aS !== "undefined") state = aS;
    } catch (error) {
      /* global aS can be absent outside portal pages. */
    }
    return state || "login";
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function stripVietnameseTone(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[đĐ]/g, "D");
  }

  function normalizeKey(value) {
    return stripVietnameseTone(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  function removeVietnamAdminPrefix(value) {
    return String(value || "")
      .replace(/^(thành phố|tp\.?|tỉnh|quận|huyện|thị xã|phường|xã|thị trấn)\s+/i, "")
      .trim();
  }

  function normalizeVietnamAdminName(value, level) {
    const cleaned = removeVietnamAdminPrefix(value);
    if (!cleaned) return "";
    if (level === "province") return VIETNAM_PROVINCE_2025_MAP[normalizeKey(cleaned)] || cleaned;
    return cleaned;
  }

  function componentFromPlace(components, type) {
    const found = (components || []).find((item) => Array.isArray(item.types) && item.types.includes(type));
    return found ? found.long_name || found.short_name || "" : "";
  }

  function parseVietnamAddressFromPlace(place) {
    const components = place?.address_components || [];
    const streetNumber = componentFromPlace(components, "street_number");
    const route = componentFromPlace(components, "route");
    const street = [streetNumber, route].filter(Boolean).join(" ").trim() || place?.name || "";
    const ward = normalizeVietnamAdminName(
      componentFromPlace(components, "sublocality_level_1")
      || componentFromPlace(components, "administrative_area_level_3")
      || componentFromPlace(components, "locality"),
      "ward"
    );
    const district = normalizeVietnamAdminName(
      componentFromPlace(components, "administrative_area_level_2")
      || componentFromPlace(components, "sublocality_level_2"),
      "district"
    );
    const city = normalizeVietnamAdminName(
      componentFromPlace(components, "administrative_area_level_1")
      || componentFromPlace(components, "locality"),
      "province"
    );
    const location = place?.geometry?.location;
    const lat = location && typeof location.lat === "function" ? location.lat() : "";
    const lng = location && typeof location.lng === "function" ? location.lng() : "";

    return {
      formattedAddress: place?.formatted_address || [street, ward, district, city].filter(Boolean).join(", "),
      street,
      ward,
      district,
      city,
      lat,
      lng
    };
  }

  function applySellerAddress(parsed) {
    const state = partnerState();
    state.location = { ...(state.location || {}), ...parsed };
    const fields = {
      "#seller-street": parsed.street,
      "#seller-ward": parsed.ward,
      "#seller-district": parsed.district,
      "#seller-city": parsed.city,
      "#seller-lat": parsed.lat,
      "#seller-lng": parsed.lng
    };

    Object.entries(fields).forEach(([selector, value]) => {
      const input = select(selector);
      if (input) input.value = value || "";
    });
  }

  function readPartnerTags(value) {
    return String(value || "")
      .split(/[\s,]+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => item.startsWith("#") ? item : `#${item}`)
      .slice(0, 5);
  }

  function passwordRules(value) {
    const password = String(value || "");
    return {
      length: password.length >= 8,
      upper: /[A-Z]/.test(password),
      lower: /[a-z]/.test(password),
      number: /\d/.test(password),
      special: /[^A-Za-z0-9]/.test(password)
    };
  }

  function passwordErrorText(password, confirm) {
    const rules = passwordRules(password);
    const missing = [];
    if (!rules.length) missing.push("tối thiểu 8 ký tự");
    if (!rules.upper) missing.push("1 chữ in HOA");
    if (!rules.lower) missing.push("1 chữ thường");
    if (!rules.number) missing.push("1 chữ số");
    if (!rules.special) missing.push("1 ký tự đặc biệt");
    if (missing.length > 0) return `Mật khẩu cần ${missing.join(", ")}.`;
    if (confirm !== undefined && String(confirm || "") !== password) return "Mật khẩu xác nhận chưa khớp 100%.";
    return "";
  }

  function validatePartnerPasswords() {
    const password = readValue("#auth-register-password");
    const confirm = readValue("#auth-register-password-confirm");
    const error = passwordErrorText(password, confirm);
    const target = select("#auth-register-password-error");
    const confirmTarget = select("#auth-register-confirm-error");
    if (target) target.textContent = error && !error.includes("xác nhận") ? error : "";
    if (confirmTarget) confirmTarget.textContent = error && error.includes("xác nhận") ? error : "";
    return !error;
  }

  function togglePartnerPassword(inputId, iconId) {
    const input = select(`#${inputId}`);
    const icon = select(`#${iconId}`);
    if (!input) return;
    input.type = input.type === "password" ? "text" : "password";
    if (icon) icon.className = input.type === "password" ? "ti ti-eye" : "ti ti-eye-off";
  }

  function formatBankAccountName(input) {
    if (!input) return;
    input.value = stripVietnameseTone(input.value).toUpperCase().replace(/\s+/g, " ").trimStart();
    const state = partnerState();
    state.finance = { ...(state.finance || {}), accountHolder: input.value.trim() };
  }

  function savePartnerStep(step) {
    const state = partnerState();

    if (step === 0) {
      state.account = {
        representative: readValue("#auth-register-representative"),
        email: readValue("#auth-register-email").toLowerCase(),
        phone: normalizePhone(readValue("#auth-register-phone")),
        password: readValue("#auth-register-password"),
        passwordConfirm: readValue("#auth-register-password-confirm")
      };
    }

    if (step === 1) {
      state.profile = {
        ...(state.profile || {}),
        storeName: readValue("#auth-register-name"),
        description: readValue("#seller-store-description"),
        hashtags: readPartnerTags(readValue("#seller-hashtags")),
        businessType: readValue("#seller-business-type") || state.profile?.businessType || ""
      };
      state.location = {
        ...(state.location || {}),
        formattedAddress: readValue("#seller-address-search") || state.location?.formattedAddress || "",
        street: readValue("#seller-street"),
        ward: readValue("#seller-ward"),
        district: readValue("#seller-district"),
        city: readValue("#seller-city"),
        lat: readValue("#seller-lat"),
        lng: readValue("#seller-lng")
      };
    }

    if (step === 2) {
      const schedule = Array.from(document.querySelectorAll(".seller-day-row")).map((row) => ({
        day: row.getAttribute("data-day"),
        open: !row.querySelector(".tgl")?.classList.contains("off"),
        from: row.querySelector("[data-time='from']")?.value || "",
        to: row.querySelector("[data-time='to']")?.value || ""
      }));
      state.operations = { schedule };
    }

    if (step === 3) {
      state.finance = {
        bankName: readValue("#seller-bank-name"),
        accountNumber: readValue("#seller-bank-account"),
        accountHolder: readValue("#seller-bank-holder")
      };
    }
  }

  function validatePartnerStep(step) {
    const state = partnerState();
    savePartnerStep(step);

    if (step === 0) {
      const account = state.account || {};
      if (!account.representative) return "Vui lòng nhập tên người đại diện.";
      if (!PORTAL_EMAIL_RE.test(account.email || "")) return "Email đăng nhập không hợp lệ.";
      if (!account.phone || account.phone.length < 8) return "Số điện thoại không hợp lệ.";
      const passwordError = passwordErrorText(account.password, account.passwordConfirm);
      if (passwordError) return passwordError;
    }

    if (step === 1) {
      const profile = state.profile || {};
      const location = state.location || {};
      if (!state.logoFileName) return "Vui lòng upload logo cửa hàng.";
      if (!state.coverFileName) return "Vui lòng upload ảnh bìa cửa hàng.";
      if (!profile.storeName) return "Vui lòng nhập tên cửa hàng.";
      if (!profile.description || profile.description.length < 12) return "Mô tả cửa hàng cần ít nhất 12 ký tự.";
      if ((profile.hashtags || []).length > 5) return "Hashtag tối đa 5 tag.";
      if (!profile.businessType) return "Vui lòng chọn loại hình kinh doanh.";
      if (!location.street || !location.ward || !location.city) return "Vui lòng chọn địa chỉ từ Google Places hoặc nhập đủ thông tin địa chỉ.";
    }

    if (step === 2) {
      const docs = state.docs || {};
      if (!docs.businessLicense) return "Giấy phép kinh doanh là bắt buộc.";
      if (!docs.cccdFront) return "CCCD mặt trước là bắt buộc.";
      if (!docs.cccdBack) return "CCCD mặt sau là bắt buộc.";
    }

    if (step === 3) {
      const finance = state.finance || {};
      if (!finance.bankName) return "Vui lòng chọn ngân hàng.";
      if (!/^\d{6,24}$/.test(String(finance.accountNumber || "").replace(/\s/g, ""))) return "Số tài khoản phải gồm 6-24 chữ số.";
      if (!finance.accountHolder) return "Vui lòng nhập tên chủ tài khoản.";
    }

    return "";
  }

  function partnerStepper() {
    const step = partnerStep();
    const progress = Math.round(((step + 1) / PARTNER_REGISTER_STEPS.length) * 100);
    return `
<div class="f ac jb m16">
  <div style="font-size:12px;color:var(--muted);cursor:pointer;font-weight:700" onclick="${step === 4 ? "FoodSaveAuth.finishPartnerPending()" : "FoodSaveAuth.cancelPartnerRegistration()"}"><i class="ti ti-arrow-left"></i> ${step === 4 ? "Trang chủ" : "Đăng nhập"}</div>
  <div style="font-size:11.5px;color:var(--green-800);font-weight:900;font-family:'Plus Jakarta Sans'">Bước ${step + 1}/${PARTNER_REGISTER_STEPS.length} · ${PARTNER_REGISTER_STEPS[step]}</div>
</div>
<div style="height:4px;background:var(--line);border-radius:3px;margin-bottom:14px;overflow:hidden"><div style="height:100%;width:${progress}%;background:linear-gradient(90deg,var(--green-700),var(--yellow));border-radius:3px;transition:.4s"></div></div>
<div class="f g6 m16" style="align-items:stretch;overflow-x:auto;padding-bottom:2px">
  ${PARTNER_REGISTER_STEPS.map((label, index) => `<div class="f ac g6" style="min-width:max-content;padding:7px 9px;border-radius:999px;border:1px solid ${index <= step ? "var(--green-700)" : "var(--line)"};background:${index === step ? "var(--green-50)" : "#fff"};color:${index <= step ? "var(--green-800)" : "var(--muted)"};font-size:10.5px;font-weight:900"><span style="width:18px;height:18px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:${index <= step ? "var(--green-700)" : "var(--soft)"};color:${index <= step ? "#fff" : "var(--muted)"};font-family:'Plus Jakarta Sans';font-size:10px">${index + 1}</span>${label}</div>`).join("")}
</div>`;
  }

  function partnerPasswordField(id, iconId, label, placeholder) {
    return `<div class="field"><label>${label}</label><div style="position:relative"><input class="inp" id="${id}" type="password" autocomplete="new-password" placeholder="${placeholder}" style="padding-right:42px" oninput="FoodSaveAuth.validatePartnerPasswords()"><button type="button" class="btn btn-icon" style="position:absolute;right:4px;top:4px;width:36px;height:36px;border:0;background:transparent;color:var(--muted);box-shadow:none" onclick="FoodSaveAuth.togglePartnerPassword('${id}','${iconId}')"><i class="ti ti-eye" id="${iconId}"></i></button></div><div id="${id === "auth-register-password" ? "auth-register-password-error" : "auth-register-confirm-error"}" style="font-size:11.5px;color:var(--red);font-weight:700;margin-top:6px;min-height:16px"></div></div>`;
  }

  function partnerFileUpload(field, label, requiredText, icon) {
    const state = partnerState();
    const fileName = field === "logo" ? state.logoFileName : field === "cover" ? state.coverFileName : state.docs?.[field];
    return `<div style="flex:1"><div class="f ac jb m6"><span style="font-size:11px;color:var(--muted);font-weight:800;text-transform:uppercase;letter-spacing:.04em">${label}</span>${requiredText ? `<span class="tg ${requiredText === "Bắt buộc" ? "tg-r" : "tg-y"}">${requiredText}</span>` : ""}</div><div id="seller-upload-${field}" style="border:2px dashed ${fileName ? "var(--green-700)" : "var(--line)"};border-radius:13px;padding:22px;text-align:center;cursor:pointer;background:${fileName ? "var(--green-50)" : "var(--soft)"};transition:.2s" onclick="document.getElementById('seller-file-${field}').click()">${fileName ? `<i class="ti ti-check" style="font-size:22px;color:var(--green-700)"></i><div style="font-size:10.5px;color:var(--green-800);font-weight:800;margin-top:4px">${escapeHtml(fileName)}</div>` : `<i class="ti ${icon}" style="font-size:24px;color:var(--muted)"></i><div style="font-size:10.5px;color:var(--muted);font-weight:800;margin-top:4px">Tải ảnh lên</div>`}</div><input id="seller-file-${field}" type="file" accept="image/*" style="display:none" onchange="FoodSaveAuth.markSellerFileUploaded('${field}',this)"></div>`;
  }

  function partnerStepAccount() {
    const account = partnerState().account || {};
    return `
<h2 class="auth-h" style="font-size:28px">Thông tin tài khoản đăng nhập</h2>
<p class="auth-sub">Thông tin cơ bản để tạo tài khoản quản trị cửa hàng</p>
<div class="field"><label>Tên người đại diện</label><input class="inp" id="auth-register-representative" autocomplete="name" placeholder="Nhập họ tên người đại diện" value="${escapeHtml(account.representative || "")}"></div>
<div class="field"><label>Email đăng nhập</label><input class="inp" id="auth-register-email" type="email" autocomplete="email" placeholder="email@domain.com" value="${escapeHtml(account.email || "")}"></div>
<div class="field"><label>Số điện thoại</label><input class="inp" id="auth-register-phone" autocomplete="tel" placeholder="+84 912 345 678" value="${escapeHtml(account.phone || "")}"></div>
${partnerPasswordField("auth-register-password", "auth-register-password-icon", "Mật khẩu", "Tối thiểu 8 ký tự, có HOA/thường/số/ký tự đặc biệt")}
${partnerPasswordField("auth-register-password-confirm", "auth-register-confirm-icon", "Xác nhận mật khẩu", "Nhập lại mật khẩu")}
<button class="btn btn-primary btn-lg" style="width:100%;justify-content:center;margin-top:8px" onclick="FoodSaveAuth.nextPartnerRegisterStep()">Tiếp tục <i class="ti ti-arrow-right"></i></button>`;
  }

  function partnerStepProfile() {
    const state = partnerState();
    const profile = state.profile || {};
    const location = state.location || {};
    return `
<h2 class="auth-h" style="font-size:28px">Hồ sơ cửa hàng & Định vị địa chỉ</h2>
<p class="auth-sub">Thông tin sẽ hiển thị cho khách hàng và giúp FoodSave xác thực vị trí</p>
<div class="f g12 m12">${partnerFileUpload("logo", "Logo", "", "ti-photo")}${partnerFileUpload("cover", "Ảnh bìa", "", "ti-photo")}</div>
<div class="field"><label>Tên cửa hàng</label><input class="inp" id="auth-register-name" placeholder="VD: Cửa hàng của bạn" value="${escapeHtml(profile.storeName || "")}"></div>
<div class="field"><label>Mô tả cửa hàng</label><textarea class="inp" id="seller-store-description" rows="3" placeholder="Tiệm bánh mì tươi mỗi ngày, sourdough truyền thống...">${escapeHtml(profile.description || "")}</textarea></div>
<div class="field"><label>Hashtag (tối đa 5)</label><input class="inp" id="seller-hashtags" placeholder="#bakery #freshbread #handcraft" value="${escapeHtml((profile.hashtags || []).join(" "))}" oninput="FoodSaveAuth.limitPartnerHashtags(this)"></div>
<div class="field"><label>Loại hình kinh doanh</label><select class="inp" id="seller-business-type" onchange="FoodSaveAuth.selectPartnerBusinessType(this.value)"><option value="">Chọn loại hình</option>${PARTNER_BUSINESS_TYPES.map((type) => `<option value="${type.id}" ${profile.businessType === type.id ? "selected" : ""}>${type.label}</option>`).join("")}</select></div>
${PARTNER_BUSINESS_TYPES.map((type) => `<div style="display:flex;align-items:center;gap:14px;padding:16px;border:1.5px solid ${profile.businessType === type.id ? "var(--green-700)" : "var(--line)"};border-radius:16px;margin-bottom:10px;cursor:pointer;background:${profile.businessType === type.id ? "var(--green-50)" : "#fff"};transition:.2s" onclick="FoodSaveAuth.selectPartnerBusinessType('${type.id}')">
<div style="width:46px;height:46px;border-radius:13px;background:${profile.businessType === type.id ? "var(--green-700)" : "var(--green-50)"};color:${profile.businessType === type.id ? "#fff" : "var(--green-800)"};display:flex;align-items:center;justify-content:center;flex-shrink:0"><i class="ti ${type.icon}" style="font-size:22px"></i></div>
<div class="f1"><div style="font-size:15px;font-weight:800;color:${profile.businessType === type.id ? "var(--green-950)" : "var(--ink-soft)"};font-family:'Plus Jakarta Sans';letter-spacing:-.015em">${type.label}</div></div>
${profile.businessType === type.id ? '<i class="ti ti-check" style="color:var(--green-700);font-size:22px"></i>' : ""}
</div>`).join("")}
<div style="height:1px;background:var(--line);margin:18px 0"></div>
<div class="field"><label>Tìm kiếm địa chỉ trên Google Maps</label><input class="inp" id="seller-address-search" placeholder="Gõ địa chỉ cửa hàng để dùng Google Places Autocomplete" value="${escapeHtml(location.formattedAddress || "")}" onblur="FoodSaveAuth.parseSellerTypedAddress()"></div>
<div id="seller-map" style="height:180px;border:1.5px solid var(--line);border-radius:16px;background:var(--soft);margin-bottom:14px;display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:12px;font-weight:800;text-align:center;padding:16px"><i class="ti ti-map-pin" style="font-size:22px;color:var(--green-700);margin-right:6px"></i> Google Maps sẽ hiển thị khi API đã được nạp</div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
  <div class="field"><label>Số nhà & Tên đường</label><input class="inp" id="seller-street" value="${escapeHtml(location.street || "")}"></div>
  <div class="field"><label>Phường/Xã</label><input class="inp" id="seller-ward" value="${escapeHtml(location.ward || "")}"></div>
  <div class="field"><label>Quận/Huyện</label><input class="inp" id="seller-district" value="${escapeHtml(location.district || "")}"></div>
  <div class="field"><label>Tỉnh/Thành phố</label><input class="inp" id="seller-city" value="${escapeHtml(location.city || "")}"></div>
  <div class="field"><label>Latitude</label><input class="inp" id="seller-lat" value="${escapeHtml(location.lat || "")}"></div>
  <div class="field"><label>Longitude</label><input class="inp" id="seller-lng" value="${escapeHtml(location.lng || "")}"></div>
</div>
<div class="f g8" style="margin-top:8px"><button class="btn btn-o btn-lg" style="flex:1;justify-content:center" onclick="FoodSaveAuth.backPartnerRegisterStep()"><i class="ti ti-arrow-left"></i> Quay lại</button><button class="btn btn-primary btn-lg" style="flex:1;justify-content:center" onclick="FoodSaveAuth.nextPartnerRegisterStep()">Tiếp tục <i class="ti ti-arrow-right"></i></button></div>`;
  }

  function partnerStepOperations() {
    const state = partnerState();
    const schedule = state.operations?.schedule || [];
    const docs = state.docs || {};
    const days = ["Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7", "Chủ nhật"];
    const scheduleByDay = Object.fromEntries(schedule.map((item) => [item.day, item]));
    return `
<h2 class="auth-h" style="font-size:28px">Vận hành & Giấy tờ</h2>
<p class="auth-sub">Thiết lập giờ hoạt động, quy tắc nhãn HSD và hồ sơ KYC</p>
<div class="m12" style="max-height:220px;overflow-y:auto;border:1px solid var(--line);border-radius:14px;padding:10px">${days.map((day) => {
  const item = scheduleByDay[day] || { open: true, from: "06:00", to: "21:00" };
  return `<div class="f ac jb seller-day-row" data-day="${day}" style="padding:8px 10px;border-radius:10px;margin-bottom:4px"><div class="f ac g8"><div class="tgl ${item.open === false ? "off" : ""}" onclick="FoodSaveAuth.toggleSellerDay('${day}',this)"></div><span style="font-size:12.5px;font-weight:800;color:var(--ink-soft);min-width:64px">${day}</span></div><div class="f ac g6"><input data-time="from" type="time" value="${item.from || "06:00"}" ${item.open === false ? "disabled" : ""} style="background:#fff;padding:5px 9px;border-radius:8px;border:1px solid var(--line);font-family:inherit;font-size:11px;color:var(--ink-soft);outline:none;font-weight:600"><span style="font-size:10px;color:var(--muted)">→</span><input data-time="to" type="time" value="${item.to || "21:00"}" ${item.open === false ? "disabled" : ""} style="background:#fff;padding:5px 9px;border-radius:8px;border:1px solid var(--line);font-family:inherit;font-size:11px;color:var(--ink-soft);outline:none;font-weight:600"></div></div>`;
}).join("")}</div>
<div style="background:linear-gradient(135deg,var(--green-50),var(--green-100));border-radius:16px;padding:16px;margin-bottom:14px;border:1px solid var(--green-200)">
<div style="font-size:11.5px;font-weight:900;color:var(--green-800);margin-bottom:10px;text-transform:uppercase;letter-spacing:.06em;display:flex;align-items:center;gap:7px;font-family:'Plus Jakarta Sans'"><i class="ti ti-clock-hour-4"></i> Hệ thống nhãn HSD tự động</div>
<div class="f g8 m10">${[{c:"var(--green-700)",l:"Xanh",d:"3-5 ngày"},{c:"var(--yellow)",l:"Vàng",d:"48h"},{c:"var(--red)",l:"Đỏ",d:"24h"}].map((item) => `<div style="flex:1;text-align:center;padding:10px;background:#fff;border-radius:10px;border:1px solid var(--line)"><div style="width:12px;height:12px;border-radius:50%;background:${item.c};margin:0 auto 5px"></div><div style="font-size:11.5px;font-weight:900;color:${item.c};font-family:'Plus Jakarta Sans'">${item.l}</div><div style="font-size:9.5px;color:var(--muted);font-weight:700">${item.d}</div></div>`).join("")}</div>
<div style="font-size:10px;color:var(--ink-soft);line-height:1.7;font-weight:600"><i class="ti ti-ban" style="color:var(--red)"></i> Chặn tự động: Gỡ SP khi còn ≤30-45p<br><i class="ti ti-tag" style="color:var(--yellow-600)"></i> Điều chỉnh giá linh hoạt khi gần hạn<br><i class="ti ti-heart" style="color:var(--green-700)"></i> Chuyển tặng từ thiện khi không bán được</div></div>
${[
  {field:"businessLicense",label:"Giấy phép kinh doanh",required:"Bắt buộc",icon:"ti-file-certificate"},
  {field:"cccdFront",label:"CCCD mặt trước",required:"Bắt buộc",icon:"ti-id"},
  {field:"cccdBack",label:"CCCD mặt sau",required:"Bắt buộc",icon:"ti-id-badge-2"},
  {field:"foodSafety",label:"Giấy ATVSTP",required:"Khuyến nghị",icon:"ti-shield-check"}
].map((doc) => `<div class="m12">${partnerFileUpload(doc.field, doc.label, doc.required, doc.icon)}</div>`).join("")}
<div style="padding:14px 16px;background:var(--blue-100);border-radius:12px;margin-bottom:14px;font-size:12px;color:var(--blue);display:flex;align-items:center;gap:8px"><i class="ti ti-robot" style="font-size:17px"></i><strong>AI + OCR</strong> tự động kiểm tra giấy tờ giả mạo trong 30 giây</div>
<div class="f g8"><button class="btn btn-o btn-lg" style="flex:1;justify-content:center" onclick="FoodSaveAuth.backPartnerRegisterStep()"><i class="ti ti-arrow-left"></i> Quay lại</button><button class="btn btn-primary btn-lg" style="flex:1;justify-content:center" onclick="FoodSaveAuth.nextPartnerRegisterStep()">Tiếp tục <i class="ti ti-arrow-right"></i></button></div>`;
  }

  function partnerStepFinance() {
    const finance = partnerState().finance || {};
    return `
<h2 class="auth-h" style="font-size:28px">Thiết lập Tài chính</h2>
<p class="auth-sub">Ví người bán & tài khoản nhận thanh toán</p>
<div class="card gradient-card-k" style="margin-bottom:16px;padding:22px"><div style="position:relative;z-index:1"><div style="font-size:11px;opacity:.7;font-weight:800;letter-spacing:.08em;text-transform:uppercase">Ví người bán · Ký quỹ bảo vệ</div><div style="font-family:'Plus Jakarta Sans';font-size:34px;font-weight:900;margin-top:5px;letter-spacing:-.025em">0 đ</div><div style="font-size:11.5px;opacity:.65;margin-top:5px;font-weight:500">Khách mua → Ký quỹ → Nhận hàng → Thanh toán</div></div></div>
<div class="field"><label>Ngân hàng</label><select class="inp" id="seller-bank-name"><option value="">Chọn ngân hàng</option>${PARTNER_BANKS.map((bank) => `<option value="${bank}" ${finance.bankName === bank ? "selected" : ""}>${bank}</option>`).join("")}</select></div>
<div class="field"><label>Số tài khoản</label><input class="inp" id="seller-bank-account" inputmode="numeric" placeholder="0123456789" value="${escapeHtml(finance.accountNumber || "")}"></div>
<div class="field"><label>Tên chủ tài khoản</label><input class="inp" id="seller-bank-holder" placeholder="NGUYEN VAN A" style="text-transform:uppercase" value="${escapeHtml(finance.accountHolder || "")}" oninput="FoodSaveAuth.formatBankAccountName(this)"></div>
<div class="f g8 m12"><button class="btn btn-o btn-lg" style="flex:1;justify-content:center" onclick="FoodSaveAuth.backPartnerRegisterStep()"><i class="ti ti-arrow-left"></i> Quay lại</button><button class="btn btn-primary btn-lg" style="flex:1;justify-content:center" onclick="FoodSaveAuth.nextPartnerRegisterStep()">Hoàn tất <i class="ti ti-check"></i></button></div>`;
  }

  function partnerStepPending() {
    return `
<div style="text-align:center"><div style="width:90px;height:90px;border-radius:24px;background:linear-gradient(135deg,var(--green-50),var(--green-100));display:flex;align-items:center;justify-content:center;margin:0 auto 20px;animation:pulse 2s infinite"><i class="ti ti-hourglass" style="font-size:42px;color:var(--green-800)"></i></div>
<h2 class="auth-h" style="font-size:28px">Đang chờ Admin duyệt</h2>
<p class="auth-sub" style="margin-bottom:20px;line-height:1.7">Đang chờ Admin duyệt. Thời gian duyệt: <strong style="color:var(--green-800)">24-48 giờ</strong>.</p></div>
${["OCR giấy phép kinh doanh", "Xác minh vị trí GPS", "Kiểm tra tài khoản ngân hàng"].map((label) => `<div class="f ac jb" style="padding:12px 14px;background:var(--soft);border-radius:12px;margin-bottom:6px;border:1px solid var(--line)"><span style="font-size:12.5px;color:var(--ink-soft);font-weight:700">${label}</span><span style="font-size:11px;font-weight:900;color:var(--yellow-600);display:flex;align-items:center;gap:5px;font-family:'Plus Jakarta Sans'"><i class="ti ti-loader"></i> Đang xử lý</span></div>`).join("")}
<button class="btn btn-primary btn-lg" style="width:100%;justify-content:center;margin-top:16px" onclick="FoodSaveAuth.finishPartnerPending()"><i class="ti ti-home"></i> Về trang chủ</button>`;
  }

  function partnerRegisterWizardPage() {
    const pages = [partnerStepAccount, partnerStepProfile, partnerStepOperations, partnerStepFinance, partnerStepPending];
    return partnerStepper() + pages[partnerStep()]();
  }

  function afterPartnerRegisterRender() {
    if (portalAuthState() !== "register") return;
    if (partnerStep() === 0) {
      const state = partnerState().account || {};
      const password = select("#auth-register-password");
      const confirm = select("#auth-register-password-confirm");
      if (password) password.value = state.password || "";
      if (confirm) confirm.value = state.passwordConfirm || "";
      validatePartnerPasswords();
    }
    if (partnerStep() === 1) {
      window.setTimeout(initSellerGoogleMaps, 80);
    }
  }

  function portalRegisterAccountPage(role) {
    if (role === "partner") return partnerRegisterWizardPage();
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
<label style="display:flex;gap:10px;align-items:flex-start;font-size:12.5px;margin:12px 0 16px;color:var(--muted);cursor:pointer"><input type="checkbox" id="auth-register-terms" style="accent-color:${isPartner ? "var(--green-700)" : "var(--rose)"};margin-top:2px"><span>Tôi đồng ý với <a href="dieu-khoan.html?source=partner" style="color:var(--green-700);font-weight:900;text-decoration:none">điều khoản dịch vụ</a> và <a href="chinh-sach.html?source=partner" style="color:var(--green-700);font-weight:900;text-decoration:none">chính sách bảo mật</a> FoodSave.</span></label>
<button class="btn btn-primary btn-lg" style="width:100%;justify-content:center;margin-top:8px" onclick="FoodSaveAuth.capturePortalAccount('${role}')">Tiếp tục <i class="ti ti-arrow-right"></i></button>`;
  }

  function selectPartnerBusinessType(type) {
    if (partnerStep() === 1) savePartnerStep(1);
    partnerState().profile = { ...(partnerState().profile || {}), businessType: type };
    const selectInput = select("#seller-business-type");
    if (selectInput) selectInput.value = type;
    window.rAuth();
  }

  function limitPartnerHashtags(input) {
    const tags = readPartnerTags(input?.value || "");
    if (input && readPartnerTags(input.value).length >= 5) input.value = tags.join(" ");
    partnerState().profile = { ...(partnerState().profile || {}), hashtags: tags };
  }

  function markSellerFileUploaded(field, input) {
    const file = input?.files?.[0];
    if (!file) return;
    const state = partnerState();
    const previousPreview = state.uploads?.[field]?.preview;
    if (previousPreview && String(previousPreview).startsWith("blob:")) URL.revokeObjectURL(previousPreview);
    state.uploads = {
      ...(state.uploads || {}),
      [field]: {
        ...(state.uploads?.[field] || {}),
        name: file.name,
        rawFile: file,
        preview: file.type && file.type.startsWith("image/") ? URL.createObjectURL(file) : "",
        dataUrl: "",
        url: "",
        mimeType: file.type || "",
        size: file.size || 0,
        status: "uploaded"
      }
    };
    if (field === "logo") state.logoFileName = file.name;
    else if (field === "cover") state.coverFileName = file.name;
    else state.docs = { ...(state.docs || {}), [field]: file.name };

    const box = select(`#seller-upload-${field}`);
    if (box) {
      box.style.borderColor = "var(--green-700)";
      box.style.background = "var(--green-50)";
      box.innerHTML = `<i class="ti ti-check" style="font-size:22px;color:var(--green-700)"></i><div style="font-size:10.5px;color:var(--green-800);font-weight:800;margin-top:4px">${escapeHtml(file.name)}</div>`;
    }
  }

  function toggleSellerDay(day, toggle) {
    const row = toggle?.closest(".seller-day-row") || document.querySelector(`.seller-day-row[data-day="${day}"]`);
    if (!row) return;
    toggle.classList.toggle("off");
    row.querySelectorAll("input[type='time']").forEach((input) => {
      input.disabled = toggle.classList.contains("off");
    });
    savePartnerStep(2);
  }

  function parseSellerTypedAddress() {
    const input = select("#seller-address-search");
    const value = input?.value || "";
    if (!value.trim()) return;
    const parts = value.split(",").map((item) => item.trim()).filter(Boolean);
    applySellerAddress({
      formattedAddress: value,
      street: parts[0] || "",
      ward: normalizeVietnamAdminName(parts[1] || "", "ward"),
      district: normalizeVietnamAdminName(parts[2] || "", "district"),
      city: normalizeVietnamAdminName(parts[parts.length - 1] || "", "province"),
      lat: partnerState().location?.lat || "",
      lng: partnerState().location?.lng || ""
    });
  }

  function initSellerGoogleMaps() {
    const input = select("#seller-address-search");
    const mapEl = select("#seller-map");
    if (!input || !mapEl) return;

    if (!window.google?.maps?.places) {
      mapEl.innerHTML = '<i class="ti ti-map-pin" style="font-size:22px;color:var(--green-700);margin-right:6px"></i> Chưa nạp Google Maps API. Bạn vẫn có thể nhập địa chỉ, hệ thống sẽ bóc tách theo dấu phẩy.';
      return;
    }

    const autocomplete = new window.google.maps.places.Autocomplete(input, {
      componentRestrictions: { country: "vn" },
      fields: ["address_components", "geometry", "formatted_address", "name"]
    });

    let map = null;
    let marker = null;
    if (window.google.maps.Map) {
      const center = { lat: 10.7769, lng: 106.7009 };
      map = new window.google.maps.Map(mapEl, { center, zoom: 13, mapTypeControl: false, streetViewControl: false, fullscreenControl: false });
      marker = new window.google.maps.Marker({ map, position: center, draggable: true });
      const geocoder = new window.google.maps.Geocoder();

      const updateFromLatLng = (latLng) => {
        marker.setPosition(latLng);
        map.panTo(latLng);
        partnerState().location = { ...(partnerState().location || {}), lat: latLng.lat(), lng: latLng.lng() };
        if (!geocoder) return;
        geocoder.geocode({ location: latLng }, (results, status) => {
          if (status === "OK" && results?.[0]) {
            const parsed = parseVietnamAddressFromPlace(results[0]);
            applySellerAddress(parsed);
            input.value = parsed.formattedAddress;
          }
        });
      };

      map.addListener("click", (event) => updateFromLatLng(event.latLng));
      marker.addListener("dragend", (event) => updateFromLatLng(event.latLng));
    }

    autocomplete.addListener("place_changed", () => {
      const place = autocomplete.getPlace();
      const parsed = parseVietnamAddressFromPlace(place);
      applySellerAddress(parsed);
      if (place.geometry?.location && map && marker) {
        map.setCenter(place.geometry.location);
        map.setZoom(16);
        marker.setPosition(place.geometry.location);
      }
    });
  }

  function captureLegacyPortalAccount(role) {
    try {
      const name = requireValue("#auth-register-name", role === "partner" ? "tên cửa hàng" : "tên tổ chức");
      const email = requireValue("#auth-register-email", "email");
      const phone = normalizePhone(requireValue("#auth-register-phone", "số điện thoại"));
      const representative = requireValue("#auth-register-representative", "người đại diện");
      const password = requireValue("#auth-register-password", "mật khẩu");
      const address = requireValue("#auth-register-address", "địa chỉ");
      if (!select("#auth-register-terms") || !select("#auth-register-terms").checked) throw new Error("Vui lòng đồng ý điều khoản dịch vụ");

      window.FoodSavePortalRegistration = { name, email, phone, representative, password, address };
      setPartnerStep(2);
      window.rAuth();
    } catch (error) {
      notify("Thiếu thông tin", error.message, "warn");
    }
  }

  function capturePortalAccount(role) {
    if (role === "partner") return nextPartnerRegisterStep();
    return captureLegacyPortalAccount(role);
  }

  async function submitPartnerRegistration() {
    if (portalRegisterPending) return;
    portalRegisterPending = true;
    savePartnerStep(Math.min(5, PARTNER_REGISTER_STEPS.length - 2));
    const state = partnerState();

    try {
      state.submitted = true;
      stopPartnerFaceStream();
      // PARTNER SECTION START
      showPartnerPendingStep();
      // PARTNER SECTION END
    } catch (error) {
      // PARTNER SECTION START
      console.error('Lỗi ở Bước 6:', error);
      showPartnerPendingStep();
      // PARTNER SECTION END
    } finally {
      portalRegisterPending = false;
    }
  }

  async function nextPartnerRegisterStep() {
    const step = partnerStep();
    const pendingStep = PARTNER_REGISTER_STEPS.length - 1;
    if (step === pendingStep) return finishPartnerPending();
    const error = validatePartnerStep(step);
    if (error) {
      if (step === 0) validatePartnerPasswords();
      notify("Thiếu thông tin", error, "warn");
      return;
    }
    if (step === pendingStep - 1) {
      await submitPartnerRegistration();
      return;
    }
    setPartnerStep(step + 1);
    window.rAuth();
  }

  function backPartnerRegisterStep() {
    const step = partnerStep();
    savePartnerStep(step);
    if (step <= 0) {
      setPortalAuthState("login");
      setPartnerStep(0);
    } else {
      setPartnerStep(step - 1);
    }
    window.rAuth();
  }

  function finishPartnerPending() {
    stopPartnerFaceStream();
    setPortalAuthState("login");
    setPartnerStep(0);
    if (typeof window.goView === "function") window.goView("landing");
    else window.rAuth();
  }

  function cancelPartnerRegistration() {
    stopPartnerFaceStream();
    setPortalAuthState("login");
    setPartnerStep(0);
    window.rAuth();
  }

  function partnerWeekDays() {
    return ["Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7", "Chủ nhật"];
  }

  function ensurePartnerRegistrationDefaults() {
    const state = partnerState();
    state.operations = {
      ...(state.operations || {}),
      schedule: (state.operations?.schedule?.length ? state.operations.schedule : partnerWeekDays().map((day) => ({ day, open: true, from: "08:00", to: "22:00" })))
    };
    state.uploads = state.uploads || {};
    state.docs = state.docs || {};
    state.ekyc = state.ekyc || {};
    state.otp = state.otp || {};
    state.profile = state.profile || {};
    state.account = state.account || {};
    state.location = state.location || {};
    state.finance = state.finance || {};
    state.automation = {
      dynamicPricing: state.automation?.dynamicPricing !== false,
      charityTransfer: state.automation?.charityTransfer !== false
    };
    return state;
  }

  function splitPartnerContact(value) {
    const contact = String(value || "").trim();
    if (!contact) return { contact: "", email: "", phone: "" };
    if (contact.includes("@")) return { contact, email: contact.toLowerCase(), phone: "" };
    return { contact, email: "", phone: normalizePhone(contact) };
  }

  function partnerContactValue() {
    const account = partnerState().account || {};
    return account.contact || account.email || account.phone || "";
  }

  function normalizePartnerEmail(value) {
    return String(value || "").trim().toLowerCase();
  }

  function partnerVerifiedEmail(state) {
    const otp = state?.otp || {};
    return normalizePartnerEmail(state?.authEmail || state?.otpEmail || otp.email || "");
  }

  function partnerContactEmail(state) {
    const account = state?.account || {};
    const profile = state?.profile || {};
    const contact = splitPartnerContact(account.contact || "");
    return normalizePartnerEmail(account.email || profile.adminEmail || contact.email || partnerVerifiedEmail(state));
  }

  function partnerContactPhone(state) {
    const account = state?.account || {};
    const profile = state?.profile || {};
    const contact = splitPartnerContact(account.contact || "");
    return normalizePhone(account.phone || profile.adminPhone || profile.hotline || contact.phone || "");
  }

  // PARTNER SECTION START
  function partnerUserMetadata() {
    // Lấy state hiện tại (tuỳ thuộc vào cách bạn khai báo biến state)
    const state = typeof partnerState === 'function' ? partnerState() : (window.FS?.partnerState || {});

    // Chỉ trả về đúng role và tên, không nhồi nhét thêm data lớn
    return {
        role: "partner",
        name: state.profile?.storeName || state.account?.representative || "Cửa hàng đối tác"
    };
  }
  // PARTNER SECTION END

  function partnerRegistrationCredentials(state = partnerState()) {
    state.account = state.account || {};
    const passwordInput = select("#auth-register-password");
    const confirmInput = select("#auth-register-password-confirm");
    const passwordVar = passwordInput && "value" in passwordInput
      ? String(passwordInput.value || "").trim()
      : String(state.account.password || "").trim();
    const confirmVar = confirmInput && "value" in confirmInput
      ? String(confirmInput.value || "").trim()
      : String(state.account.passwordConfirm || "").trim();

    state.account.password = passwordVar;
    state.account.passwordConfirm = confirmVar;

    return {
      emailVar: partnerContactEmail(state),
      passwordVar,
      confirmVar,
      passwordInputFound: !!passwordInput,
      confirmInputFound: !!confirmInput
    };
  }

  async function updatePartnerAuthPassword(supabaseClient, user, state = partnerState()) {
    const credentials = partnerRegistrationCredentials(state);
    const emailVar = normalizePartnerEmail(user?.email || credentials.emailVar);
    const passwordVar = credentials.passwordVar;
    const passwordError = passwordErrorText(passwordVar, credentials.confirmVar);

    if (passwordError) {
      setPartnerStep(0);
      if (typeof window.rAuth === "function") window.rAuth();
      throw new Error(passwordError);
    }

    console.log("=== DEBUG DỮ LIỆU ĐĂNG KÝ PARTNER ===", {
      emailTruyenVao: emailVar,
      passTruyenVao: passwordVar,
      passLength: passwordVar.length,
      passwordInputFound: credentials.passwordInputFound,
      confirmInputFound: credentials.confirmInputFound
    });

    // PARTNER SECTION START
    const minimalPartnerAuthMetadata = partnerUserMetadata({
      ...state,
      account: {
        ...(state.account || {}),
        email: emailVar
      }
    });
    const { data, error } = await supabaseClient.auth.updateUser({
      password: passwordVar,
      data: minimalPartnerAuthMetadata
    });
    // PARTNER SECTION END

    if (error) throw error;
    return data?.user || user;
  }

  function setPartnerWizardMode(enabled) {
    const wrap = select(".auth-wrap");
    if (wrap) wrap.classList.toggle("partner-wizard-mode", Boolean(enabled));
  }

  function ensurePartnerOtp(reset) {
    const state = ensurePartnerRegistrationDefaults();
    if (reset || !state.otp.expiresAt) {
      state.otp = {
        value: reset ? "" : state.otp.value || "",
        expiresAt: Date.now() + 180000,
        error: "",
        verified: false
      };
    }
    return state.otp;
  }

  function partnerOtpRemainingSeconds() {
    const otp = ensurePartnerOtp(false);
    return Math.max(0, Math.ceil((Number(otp.expiresAt || 0) - Date.now()) / 1000));
  }

  function formatPartnerOtpTime(seconds) {
    const minutes = String(Math.floor(seconds / 60)).padStart(2, "0");
    const rest = String(seconds % 60).padStart(2, "0");
    return `${minutes}:${rest}`;
  }

  function stopPartnerOtpTimer() {
    if (window.__partnerOtpTimer) {
      window.clearInterval(window.__partnerOtpTimer);
      window.__partnerOtpTimer = null;
    }
  }

  function startPartnerOtpTimer() {
    stopPartnerOtpTimer();
    ensurePartnerOtp(false);
    const tick = () => {
      const seconds = partnerOtpRemainingSeconds();
      const timer = select("#partner-otp-timer");
      const resend = select("#partner-otp-resend");
      if (timer) timer.textContent = formatPartnerOtpTime(seconds);
      if (resend) resend.style.display = seconds <= 0 ? "inline-flex" : "none";
      if (seconds <= 0) stopPartnerOtpTimer();
    };
    tick();
    window.__partnerOtpTimer = window.setInterval(tick, 1000);
  }

  async function sendPartnerEmailOtp() {
    if (partnerOtpPending) return;
    if (select("#partner-contact")) savePartnerStep(0);
    const state = ensurePartnerRegistrationDefaults();
    const contact = splitPartnerContact(state.account?.contact || "");
    const email = normalizePartnerEmail(contact.email || state.account?.email || "");

    if (!PORTAL_EMAIL_RE.test(email)) {
      state.otp = { ...(state.otp || {}), error: "Vui lòng nhập email hợp lệ để nhận mã OTP." };
      window.rAuth();
      notify("Email chưa hợp lệ", state.otp.error, "warn");
      return;
    }

    partnerOtpPending = true;
    state.otp = { ...(state.otp || {}), sending: true, error: "" };
    window.rAuth();

    try {
      const { error } = await getFoodSaveSupabase().auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: true,
          data: partnerUserMetadata({
            ...state,
            account: { ...(state.account || {}), email }
          })
        }
      });

      if (error) throw error;

      state.account = { ...(state.account || {}), email, contact: email };
      state.profile = {
        ...(state.profile || {}),
        adminEmail: state.profile?.adminEmail || email
      };
      state.otpEmail = email;
      state.otp = {
        value: "",
        email,
        expiresAt: Date.now() + 180000,
        error: "",
        verified: false,
        sending: false,
        sentAt: new Date().toISOString()
      };
      setPartnerStep(1);
      notify("Đã gửi OTP", `Kiểm tra email ${email} để lấy mã 6 số.`, "info");
    } catch (error) {
      state.otp = {
        ...(state.otp || {}),
        sending: false,
        error: error.message || "Không thể gửi OTP. Vui lòng thử lại."
      };
      notify("Không thể gửi OTP", state.otp.error, "error");
    } finally {
      partnerOtpPending = false;
      window.rAuth();
    }
  }

  async function verifyPartnerEmailOtp() {
    if (partnerVerifyPending) return;
    savePartnerStep(1);
    const state = ensurePartnerRegistrationDefaults();
    const email = normalizePartnerEmail(state.otp?.email || state.otpEmail || state.account?.email || "");
    const token = String(state.otp?.value || "").replace(/\D/g, "");

    if (!PORTAL_EMAIL_RE.test(email)) {
      state.otp = { ...(state.otp || {}), error: "Không tìm thấy email nhận OTP. Vui lòng quay lại bước 1." };
      window.rAuth();
      notify("Thiếu email OTP", state.otp.error, "warn");
      return;
    }

    if (partnerOtpRemainingSeconds() <= 0) {
      state.otp = { ...(state.otp || {}), error: "Mã OTP đã hết hạn. Vui lòng gửi lại mã mới." };
      window.rAuth();
      notify("OTP đã hết hạn", state.otp.error, "warn");
      return;
    }

    if (!/^\d{6}$/.test(token)) {
      state.otp = { ...(state.otp || {}), error: "Vui lòng nhập đủ mã OTP 6 chữ số." };
      window.rAuth();
      notify("Thiếu mã OTP", state.otp.error, "warn");
      return;
    }

    partnerVerifyPending = true;
    state.otp = { ...(state.otp || {}), verifying: true, error: "" };
    window.rAuth();

    try {
      const { data, error } = await getFoodSaveSupabase().auth.verifyOtp({
        email,
        token,
        type: "email"
      });

      if (error) throw error;

      const user = data?.user || data?.session?.user;
      state.account = { ...(state.account || {}), email };
      state.otpEmail = email;
      state.authUserId = user?.id || state.authUserId || "";
      state.authEmail = user?.email || email;
      state.otp = {
        ...(state.otp || {}),
        email,
        verified: true,
        verifying: false,
        error: "",
        verifiedAt: new Date().toISOString()
      };
      // PARTNER SECTION START
      state.sessionVerified = true;
      state.sessionVerifiedAt = state.otp.verifiedAt;
      showPartnerRegisterStep(2);
      // PARTNER SECTION END
    } catch (error) {
      state.otp = {
        ...(state.otp || {}),
        verified: false,
        verifying: false,
        error: error.message || "Mã OTP không chính xác, vui lòng kiểm tra lại."
      };
      notify("OTP không hợp lệ", state.otp.error, "error");
    } finally {
      partnerVerifyPending = false;
      window.rAuth();
    }
  }

  function resendPartnerOtp() {
    sendPartnerEmailOtp();
  }

  function partnerOtpInput(input, index) {
    const state = ensurePartnerRegistrationDefaults();
    const boxes = Array.from(document.querySelectorAll(".partner-otp-box"));
    const value = String(input?.value || "").replace(/\D/g, "").slice(-1);
    if (input) input.value = value;
    state.otp = { ...(state.otp || {}), value: boxes.map((box) => box.value || "").join(""), error: "" };
    if (value && boxes[index + 1]) boxes[index + 1].focus();
  }

  function partnerOtpKey(input, index, event) {
    if (event?.key === "Backspace" && !input?.value) {
      const boxes = Array.from(document.querySelectorAll(".partner-otp-box"));
      if (boxes[index - 1]) boxes[index - 1].focus();
    }
  }

  function partnerUploadPreview(upload) {
    if (upload?.preview) return `<img class="partner-upload-preview" src="${escapeHtml(upload.preview)}" alt="${escapeHtml(upload.name || "preview")}">`;
    return `<div class="partner-upload-preview" style="display:flex;align-items:center;justify-content:center;background:var(--green-50);color:var(--green-700)"><i class="ti ti-file-check" style="font-size:24px"></i></div>`;
  }

  function partnerDocumentLabel(field) {
    return {
      cccdFront: "CCCD mặt trước",
      cccdBack: "CCCD mặt sau",
      businessLicense: "Giấy ĐKKD"
    }[field] || "Tài liệu";
  }

  function partnerUploadBox(field, label, hint, options = {}) {
    const state = partnerState();
    const upload = state.uploads?.[field] || {};
    const fileName = upload.name || (field === "logo" ? state.logoFileName : field === "cover" ? state.coverFileName : state.docs?.[field]);
    const loading = upload.loading;
    const done = Boolean(fileName) && !loading;
    const icon = options.icon || (options.add ? "ti-plus" : "ti-upload");
    const idleHint = hint || "Chọn file ảnh có sẵn";
    return `
<label class="partner-upload ${done ? "done" : ""} ${loading ? "loading" : ""}" for="seller-file-${field}">
  ${loading ? `<span class="partner-spinner"></span><strong>Đang phân tích dữ liệu...</strong><small>${escapeHtml(label)}</small>` : done ? `${partnerUploadPreview(upload)}<span class="partner-upload-success"><i class="ti ti-check"></i></span><strong>${escapeHtml(label)}</strong><small>${escapeHtml(fileName)}</small>` : `<i class="ti ${icon}"></i><strong>${escapeHtml(label)}</strong><small>${escapeHtml(idleHint)}</small>`}
</label>
<input id="seller-file-${field}" type="file" accept="image/*" style="display:none" onchange="FoodSaveAuth.markSellerFileUploaded('${field}',this)">`;
  }

  function isPartnerOcrField(field) {
    return ["cccdFront", "cccdBack", "businessLicense"].includes(field);
  }

  function partnerMockOcrText(field, fileName) {
    if (field === "businessLicense") {
      return `GIẤY CHỨNG NHẬN ĐĂNG KÝ KINH DOANH\nTên doanh nghiệp: CÔNG TY TNHH TIỆM BÁNH ABC\nTên cửa hàng: Tiệm bánh ABC\nMã số thuế: 0317456789\nTệp: ${fileName || "business-license.jpg"}`;
    }
    if (field === "cccdFront" || field === "cccdBack") {
      return `CĂN CƯỚC CÔNG DÂN\nHọ và tên\nNGUYỄN MINH ANH\nNgày sinh 20/03/1990\n079203000123\nTệp: ${fileName || field + ".jpg"}`;
    }
    return `FOODSAVE OCR\nTệp ${fileName || field}`;
  }

  function extractPartnerTaxCode(text) {
    return (String(text || "").match(/\b\d{10,14}\b/) || [])[0] || "";
  }

  function extractPartnerBusinessName(text) {
    const lines = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (let index = 0; index < lines.length; index += 1) {
      const normalized = normalizeOcrText(lines[index]);
      if (["ten doanh nghiep", "ten cong ty", "ten ho kinh doanh", "ho kinh doanh"].some((key) => normalized.includes(key))) {
        const raw = lines[index].includes(":") ? lines[index].split(":").slice(1).join(":") : lines[index + 1] || "";
        if (raw.trim()) return raw.replace(/^[\s:.-]+/, "").replace(/\s+/g, " ").trim();
      }
    }
    return lines.find((line) => /(cong ty|tnhh|co phan|ho kinh doanh|doanh nghiep)/i.test(normalizeOcrText(line))) || "";
  }

  function extractPartnerStoreName(text, legalName) {
    const lines = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (let index = 0; index < lines.length; index += 1) {
      const normalized = normalizeOcrText(lines[index]);
      if (["ten cua hang", "ten thuong mai", "thuong hieu"].some((key) => normalized.includes(key))) {
        const raw = lines[index].includes(":") ? lines[index].split(":").slice(1).join(":") : lines[index + 1] || "";
        if (raw.trim()) return raw.replace(/^[\s:.-]+/, "").replace(/\s+/g, " ").trim();
      }
    }
    return String(legalName || "")
      .replace(/^(công ty|cong ty)\s+(tnhh|trách nhiệm hữu hạn|co phan|cổ phần)?\s*/i, "")
      .replace(/^(hộ kinh doanh|ho kinh doanh)\s*/i, "")
      .trim();
  }

  async function recognizePartnerDocument(field, file, fallbackName) {
    if (file && file.type && file.type.startsWith("image/") && window.Tesseract && typeof window.Tesseract.recognize === "function") {
      try {
        const result = await window.Tesseract.recognize(file, "vie+eng");
        const text = result && result.data ? result.data.text : "";
        if (text && text.trim()) return text;
      } catch (error) {
        notify("OCR chưa sẵn sàng", "Tesseract không đọc được ảnh này, FoodSave dùng dữ liệu mô phỏng để bạn kiểm thử UI.", "warn");
      }
    }
    return partnerMockOcrText(field, fallbackName);
  }

  function applyPartnerOcrToState(field, text) {
    const state = ensurePartnerRegistrationDefaults();
    if (field === "cccdFront" || field === "cccdBack") {
      const representative = extractCharityRepresentativeName(text);
      const cccdNumber = (String(text || "").match(/\b\d{12}\b/) || [])[0] || "";
      state.account = {
        ...(state.account || {}),
        representative: representative || state.account?.representative || "",
        cccdNumber: cccdNumber || state.account?.cccdNumber || ""
      };
    }
    if (field === "businessLicense") {
      const legalName = extractPartnerBusinessName(text);
      const taxCode = extractPartnerTaxCode(text);
      const storeName = extractPartnerStoreName(text, legalName);
      state.profile = {
        ...(state.profile || {}),
        legalName: legalName || state.profile?.legalName || "",
        taxCode: taxCode || state.profile?.taxCode || "",
        storeName: storeName || state.profile?.storeName || ""
      };
    }
  }

  const CHARITY_REGISTER_LAST_STEP = 5;

  function charityState() {
    try {
      if (typeof charityRegState !== "undefined" && charityRegState) return charityRegState;
    } catch (error) {
      // FOODSAVE_USER / PARTNER do not define this state.
    }
    window.FoodSaveCharityRegistration = window.FoodSaveCharityRegistration || {
      docs: {},
      rep: {},
      org: {},
      scale: {},
      face: {}
    };
    return window.FoodSaveCharityRegistration;
  }

  function charityStep() {
    let current = window.regStep;
    try {
      if (typeof regStep !== "undefined") current = regStep;
    } catch (error) {
      // The global lexical binding is absent outside portal pages.
    }
    const step = Number(current);
    return Number.isFinite(step) ? Math.max(0, Math.min(CHARITY_REGISTER_LAST_STEP, step)) : 0;
  }

  function setCharityStep(step) {
    const next = Math.max(0, Math.min(CHARITY_REGISTER_LAST_STEP, Number(step) || 0));
    window.regStep = next;
    try { regStep = next; } catch (error) { /* global regStep can be absent outside portal pages. */ }
  }

  function setCharityAuthState(state) {
    window.aS = state;
    try { aS = state; } catch (error) { /* global aS can be absent outside portal pages. */ }
  }

  function charityAuthState() {
    let state = window.aS;
    try {
      if (typeof aS !== "undefined") state = aS;
    } catch (error) {
      // The global lexical binding is absent outside portal pages.
    }
    return state || "login";
  }

  function renderCharityAuth() {
    if (typeof window.rAuth === "function") window.rAuth();
  }

  function writeCharityValue(path, value) {
    if (typeof window.setCharityValue === "function") {
      window.setCharityValue(path, value);
      return;
    }
    const state = charityState();
    const parts = String(path || "").split(".");
    let target = state;
    parts.slice(0, -1).forEach((part) => {
      target[part] = target[part] || {};
      target = target[part];
    });
    target[parts[parts.length - 1]] = value;
  }

  function readCharityDomValue(selector, options = {}) {
    const input = select(selector);
    if (!input || !("value" in input)) return "";
    const value = String(input.value ?? "");
    return options.trim ? value.trim() : value;
  }

  function syncCharityRegisterValues() {
    [
      ["contact", "#charityContact", true],
      ["rep.name", "#repName", true],
      ["rep.cccd", "#repID", true],
      ["rep.role", "#repTitle", true],
      ["rep.email", "#repEmail", true],
      ["rep.orgPhone", "#orgPhone", true],
      ["rep.password", "#repPassword", true],
      ["rep.confirm", "#repPasswordConfirm", true],
      ["org.name", "#orgName", true],
      ["org.type", "#orgType", true],
      ["org.taxId", "#orgTaxId", true],
      ["org.phone", "#orgContactPhone", true],
      ["org.email", "#orgContactEmail", true],
      ["org.address", "#orgAddress", true],
      ["org.description", "#orgDesc", true],
      ["org.mission", "#orgMission", true],
      ["scale.people", "#scalePeople", true],
      ["scale.meals", "#scaleMeals", true],
      ["scale.volunteers", "#scaleVols", true],
      ["scale.radius", "#serviceRadius", true]
    ].forEach(([path, selector, trim]) => {
      const input = select(selector);
      if (input) writeCharityValue(path, readCharityDomValue(selector, { trim }));
    });
  }

  function charityRegistrationCredentials(state = charityState()) {
    state.rep = state.rep || {};
    const passwordInput = select("#repPassword");
    const confirmInput = select("#repPasswordConfirm");
    const passwordVar = passwordInput
      ? readCharityDomValue("#repPassword", { trim: true })
      : String(state.rep.password || "").trim();
    const confirmVar = confirmInput
      ? readCharityDomValue("#repPasswordConfirm", { trim: true })
      : String(state.rep.confirm || "").trim();

    state.rep.password = passwordVar;
    state.rep.confirm = confirmVar;

    return {
      emailVar: normalizeCharityEmail(state.authEmail || state.otpEmail || state.contact || charityContactEmail(state)),
      passwordVar,
      confirmVar,
      passwordInputFound: !!passwordInput,
      confirmInputFound: !!confirmInput
    };
  }

  function charityRegistrationPasswordError(state = charityState()) {
    const credentials = charityRegistrationCredentials(state);
    return passwordErrorText(credentials.passwordVar, credentials.confirmVar);
  }

  async function updateCharityAuthPassword(supabaseClient, user, state = charityState()) {
    const credentials = charityRegistrationCredentials(state);
    const emailVar = normalizeCharityEmail(user?.email || credentials.emailVar);
    const passwordVar = credentials.passwordVar;
    const passwordError = passwordErrorText(passwordVar, credentials.confirmVar);

    if (passwordError) {
      setCharityStep(2);
      renderCharityAuth();
      throw new Error(passwordError);
    }

    console.log("=== DEBUG DỮ LIỆU ĐĂNG KÝ ===", { emailTruyenVao: emailVar, passTruyenVao: passwordVar, passLength: passwordVar.length });

    const { data, error } = await supabaseClient.auth.updateUser({
      password: passwordVar,
      data: charityUserMetadata({
        ...state,
        contact: emailVar,
        rep: {
          ...(state.rep || {}),
          password: passwordVar,
          confirm: credentials.confirmVar
        }
      })
    });

    if (error) throw error;
    return data?.user || user;
  }

  function normalizeCharityEmail(value) {
    return String(value || "").trim().toLowerCase();
  }

  function charityContactEmail(state) {
    return normalizeCharityEmail(state.org?.email || state.rep?.email || state.otpEmail || state.contact);
  }

  function charityContactPhone(state) {
    const raw = state.org?.phone || state.rep?.orgPhone || (String(state.contact || "").includes("@") ? "" : state.contact);
    return normalizePhone(raw);
  }

  function charityNumber(value) {
    const number = Number(String(value || "").replace(/[^\d]/g, ""));
    return Number.isFinite(number) && number > 0 ? number : 0;
  }

  function charitySlug(value, userId) {
    const base = stripVietnameseTone(value || "to-chuc-tu-thien")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 54) || "to-chuc-tu-thien";
    const suffix = String(userId || Date.now()).replace(/[^a-z0-9]/gi, "").slice(0, 8) || Date.now().toString(36);
    return `${base}-${suffix}`;
  }

  function charityAddressParts(address) {
    const parts = String(address || "").split(",").map((item) => item.trim()).filter(Boolean);
    return {
      address: String(address || "").trim() || "Chưa cập nhật",
      district: parts.length >= 3 ? parts[parts.length - 2] : "",
      city: parts.length >= 2 ? normalizeVietnamAdminName(parts[parts.length - 1], "province") : "TP.HCM"
    };
  }

  function charityDocumentPublicUrl(doc) {
    return partnerStoredAssetUrl(doc?.url || doc?.dataUrl || doc?.publicUrl || "");
  }

  const CHARITY_ORDERED_DOCUMENT_KEYS = [
    "avatar_logo",
    "cover_banner",
    "cccd_front",
    "cccd_back",
    "establishment_decision",
    "operating_license",
    "financial_report"
  ];

  function charityDocumentMetadataEntry(label, ...docs) {
    const url = docs.map((doc) => charityDocumentPublicUrl(doc)).find(Boolean) || "";
    return {
      label,
      url,
      status: url ? "done" : "idle"
    };
  }

  function charityDocumentsMetadata(docs, state = charityState()) {
    const source = docs || {};
    return {
      avatar_logo: charityDocumentMetadataEntry("Ảnh đại diện / Logo tổ chức", source.logo, state.org?.logo),
      cover_banner: charityDocumentMetadataEntry("Ảnh bìa / Banner", source.cover, source.coverImage, state.org?.cover),
      cccd_front: charityDocumentMetadataEntry("Ảnh CCCD mặt trước", source.cccdFront, source.idCard, state.representative?.idCard),
      cccd_back: charityDocumentMetadataEntry("Ảnh CCCD mặt sau", source.cccdBack),
      establishment_decision: charityDocumentMetadataEntry("Ảnh Giấy quyết định thành lập", source.decision),
      operating_license: charityDocumentMetadataEntry("Giấy phép hoạt động của tổ chức", source.license, state.org?.license),
      financial_report: charityDocumentMetadataEntry("Ảnh Báo cáo tài chính", source.finance, source.financialReport)
    };
  }

  function charityStoragePath(userId, field, file) {
    const safeUserId = String(userId || "charity").replace(/[^a-z0-9_-]/gi, "") || "charity";
    const safeField = String(field || "file").replace(/[^a-z0-9_-]/gi, "") || "file";
    const safeFileName = partnerStorageSafeFileName(file?.name || `${safeField}.jpg`);
    const nonce = Math.random().toString(36).slice(2, 10);
    return `${safeUserId}/${safeField}/${Date.now()}-${nonce}-${safeFileName}`;
  }

  function charityLegacyDocumentSources(state) {
    return [
      ["logo", state?.org?.logo],
      ["license", state?.org?.license],
      ["idCard", state?.representative?.idCard || state?.rep?.idCard]
    ].filter(([, doc]) => doc && typeof doc === "object");
  }

  async function ensureCharityDocumentDataUrls(supabaseClient = getFoodSaveSupabase(), userId = "", state = charityState()) {
    if (!supabaseClient?.storage?.from) {
      throw new Error("Supabase Storage chưa sẵn sàng để tải tài liệu tổ chức.");
    }

    state.docs = state.docs || {};
    const bucket = supabaseClient.storage.from(CHARITY_STORAGE_BUCKET);
    const fields = new Set([...CHARITY_DOCUMENT_FIELDS, ...Object.keys(state.docs || {})]);

    charityLegacyDocumentSources(state).forEach(([field, doc]) => {
      fields.add(field);
      state.docs[field] = {
        ...(state.docs[field] || {}),
        name: state.docs[field]?.name || doc.name || doc.file?.name || "",
        rawFile: state.docs[field]?.rawFile || doc.rawFile || doc.file || null,
        url: state.docs[field]?.url || charityDocumentPublicUrl(doc),
        dataUrl: state.docs[field]?.dataUrl || charityDocumentPublicUrl(doc),
        preview: state.docs[field]?.preview || doc.preview || charityDocumentPublicUrl(doc),
        mimeType: state.docs[field]?.mimeType || doc.mimeType || doc.file?.type || "",
        size: state.docs[field]?.size || doc.size || doc.file?.size || 0,
        status: state.docs[field]?.status || doc.status || "uploaded"
      };
    });

    await Promise.all([...fields].map(async (field) => {
      const doc = state.docs[field];
      if (!doc || typeof doc !== "object") return;

      const existingUrl = charityDocumentPublicUrl(doc);
      const file = doc.rawFile || doc.file || null;
      if (!file) {
        if (existingUrl) {
          doc.url = existingUrl;
          doc.dataUrl = existingUrl;
          doc.preview = existingUrl;
        }
        return;
      }

      const path = charityStoragePath(userId, field, file);
      const { data, error } = await bucket.upload(path, file, {
        cacheControl: "3600",
        contentType: file.type || "application/octet-stream",
        upsert: true
      });
      if (error) throw error;

      const storagePath = data?.path || path;
      const { data: publicData } = bucket.getPublicUrl(storagePath);
      const publicUrl = partnerStoredAssetUrl(publicData?.publicUrl);
      if (!publicUrl) throw new Error(`Supabase Storage không trả về public URL cho ${field}.`);

      state.docs[field] = {
        ...doc,
        name: doc.name || file.name || field,
        url: publicUrl,
        dataUrl: publicUrl,
        preview: publicUrl,
        storagePath,
        mimeType: file.type || doc.mimeType || "",
        size: file.size || doc.size || 0,
        status: "done"
      };
    }));

    charityLegacyDocumentSources(state).forEach(([field, doc]) => {
      const uploaded = state.docs[field];
      if (!uploaded) return;
      doc.url = uploaded.url || "";
      doc.dataUrl = uploaded.dataUrl || "";
      doc.preview = uploaded.preview || "";
      doc.storagePath = uploaded.storagePath || "";
      doc.status = uploaded.status || "done";
    });

    return state.docs;
  }

  function charityUserMetadata(state) {
    const email = charityContactEmail(state);
    const phone = charityContactPhone(state);
    return {
      role: "charity",
      full_name: state.rep?.name || state.org?.name || email,
      org_name: state.org?.name || "",
      phone,
      representative_name: state.rep?.name || "",
      representative_role: state.rep?.role || "",
      cccd_number: state.rep?.cccd || "",
      organization_type: state.org?.type || "",
      terms_accepted: true
    };
  }

  function buildCharityRegistrationPayload(userId) {
    const state = charityState();
    const org = state.org || {};
    const scale = state.scale || {};
    const emailCandidate = charityContactEmail(state);
    const verifiedEmail = normalizeCharityEmail(state.otpEmail || state.authEmail || state.contact);
    const email = PORTAL_EMAIL_RE.test(emailCandidate) ? emailCandidate : verifiedEmail;
    const phone = charityContactPhone(state) || "Chưa cập nhật";
    const addressInfo = charityAddressParts(org.address);
    const name = String(org.name || "").trim() || "Chưa cập nhật";
    const logoUrl = charityDocumentPublicUrl(state.docs?.logo) || charityDocumentPublicUrl(org.logo);

    return {
      id: userId,
      owner_id: userId,
      name,
      slug: charitySlug(name, userId),
      phone,
      email,
      avatar_url: logoUrl || "",
      address: addressInfo.address,
      district: addressInfo.district || undefined,
      city: addressInfo.city || "TP.HCM",
      beneficiaries_count: charityNumber(scale.people),
      status: "pending"
    };
  }

  function charityFormValue(id, fallback = "") {
    const element = document.getElementById(id);
    if (!element || !("value" in element)) return String(fallback || "").trim();
    return String(element.value || "").trim();
  }

  function charityLegalDocumentUrls(state = charityState()) {
    const docs = state.docs || {};
    return {
      avatar_logo_url: charityDocumentPublicUrl(docs.logo) || charityDocumentPublicUrl(state.org?.logo),
      cover_banner_url: charityDocumentPublicUrl(docs.cover) || charityDocumentPublicUrl(docs.coverImage) || charityDocumentPublicUrl(state.org?.cover),
      cccd_front_url: charityDocumentPublicUrl(docs.cccdFront) || charityDocumentPublicUrl(docs.idCard) || charityDocumentPublicUrl(state.representative?.idCard),
      cccd_back_url: charityDocumentPublicUrl(docs.cccdBack),
      establishment_decision_url: charityDocumentPublicUrl(docs.decision),
      operating_license_url: charityDocumentPublicUrl(docs.license) || charityDocumentPublicUrl(state.org?.license),
      financial_report_url: charityDocumentPublicUrl(docs.finance) || charityDocumentPublicUrl(docs.financialReport)
    };
  }

  function buildCharityOrganizationInfo(profilePayload) {
    const state = charityState();
    const org = state.org || {};
    const rep = state.rep || {};
    const scale = state.scale || {};
    const documentUrls = charityLegalDocumentUrls(state);

    return {
      organization_name: charityFormValue("orgName", profilePayload.name || org.name || ""),
      organization_type: charityFormValue("orgType", org.type || ""),
      tax_id: charityFormValue("orgTaxId", org.taxId || org.tax_id || ""),
      organization_phone: charityFormValue("orgContactPhone", org.phone || profilePayload.phone || ""),
      organization_email: charityFormValue("orgContactEmail", org.email || profilePayload.email || ""),
      address: charityFormValue("orgAddress", profilePayload.address || org.address || ""),
      district: profilePayload.district || "",
      city: profilePayload.city || "",
      description: charityFormValue("orgDesc", org.description || ""),
      mission: charityFormValue("orgMission", org.mission || ""),
      representative_name: charityFormValue("repName", rep.name || ""),
      representative_role: charityFormValue("repTitle", rep.role || ""),
      representative_email: charityFormValue("repEmail", rep.email || ""),
      representative_phone: charityFormValue("orgPhone", rep.orgPhone || ""),
      representative_cccd: charityFormValue("repID", rep.cccd || ""),
      contact: charityFormValue("charityContact", state.contact || ""),
      verified_email: state.authEmail || state.otpEmail || profilePayload.email || "",
      beneficiaries_count: charityNumber(charityFormValue("scalePeople", scale.people || "")),
      meals_per_day: charityNumber(charityFormValue("scaleMeals", scale.meals || "")),
      volunteers_count: charityNumber(charityFormValue("scaleVols", scale.volunteers || "")),
      pickup_radius: charityFormValue("serviceRadius", scale.radius || ""),
      legal_documents: documentUrls,
      otp_verified: Boolean(state.otpVerified),
      face_status: state.face?.status || "idle"
    };
  }

  function buildCharityProfileMetadata(profilePayload) {
    const state = charityState();
    const organizationInfo = buildCharityOrganizationInfo(profilePayload);
    const documentUrls = charityLegalDocumentUrls(state);
    return {
      role: "charity",
      tax_id: organizationInfo.tax_id || "",
      address: organizationInfo.address || "",
      description: organizationInfo.description || "",
      mission: organizationInfo.mission || "",
      representative_name: organizationInfo.representative_name || "",
      representative_role: organizationInfo.representative_role || "",
      representative_email: organizationInfo.representative_email || "",
      representative_phone: organizationInfo.representative_phone || "",
      representative_cccd: organizationInfo.representative_cccd || "",
      license_image_url: documentUrls.operating_license_url || "",
      decision_image_url: documentUrls.establishment_decision_url || "",
      financial_report_url: documentUrls.financial_report_url || "",
      cover_image_url: documentUrls.cover_banner_url || "",
      avatar_logo_url: documentUrls.avatar_logo_url || "",
      cccd_front_url: documentUrls.cccd_front_url || "",
      cccd_back_url: documentUrls.cccd_back_url || "",
      organization_info: organizationInfo,
      documents: charityDocumentsMetadata(state.docs, state),
      ordered_document_keys: [...CHARITY_ORDERED_DOCUMENT_KEYS]
    };
  }

  async function sendCharityEmailOtp() {
    if (charityOtpPending) return;
    syncCharityRegisterValues();
    const state = charityState();
    const email = normalizeCharityEmail(state.contact);

    if (!PORTAL_EMAIL_RE.test(email)) {
      state.otpError = "Vui lòng nhập email hợp lệ để nhận mã OTP.";
      renderCharityAuth();
      notify("Email chưa hợp lệ", state.otpError, "warn");
      return;
    }

    charityOtpPending = true;
    state.otpSending = true;
    state.otpError = "";
    renderCharityAuth();

    try {
      const { error } = await getFoodSaveSupabase().auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: true,
          data: charityUserMetadata({ ...state, contact: email })
        }
      });

      if (error) throw error;

      state.contact = email;
      state.otpEmail = email;
      state.otp = ["", "", "", "", "", ""];
      state.otpSeconds = 180;
      state.otpExpired = false;
      state.otpVerified = false;
      state.otpSentAt = new Date().toISOString();
      setCharityStep(1);
      notify("Đã gửi OTP", `Kiểm tra email ${email} để lấy mã 6 số.`, "info");
    } catch (error) {
      state.otpError = error.message || "Không thể gửi OTP. Vui lòng thử lại.";
      notify("Không thể gửi OTP", state.otpError, "error");
    } finally {
      state.otpSending = false;
      charityOtpPending = false;
      renderCharityAuth();
    }
  }

  async function verifyCharityEmailOtp() {
    if (charityVerifyPending) return;
    syncCharityRegisterValues();
    const state = charityState();
    const email = normalizeCharityEmail(state.otpEmail || state.contact);
    const token = Array.isArray(state.otp) ? state.otp.join("") : String(state.otp || "");

    if (!PORTAL_EMAIL_RE.test(email)) {
      state.otpError = "Không tìm thấy email nhận OTP. Vui lòng quay lại bước 1.";
      renderCharityAuth();
      notify("Thiếu email OTP", state.otpError, "warn");
      return;
    }

    if (state.otpExpired || state.otpSeconds <= 0) {
      state.otpError = "Mã OTP đã hết hạn. Vui lòng gửi lại mã mới.";
      renderCharityAuth();
      notify("OTP đã hết hạn", state.otpError, "warn");
      return;
    }

    if (!/^\d{6}$/.test(token)) {
      state.otpError = "Vui lòng nhập đủ mã OTP 6 chữ số.";
      renderCharityAuth();
      notify("Thiếu mã OTP", state.otpError, "warn");
      return;
    }

    charityVerifyPending = true;
    state.otpVerifying = true;
    state.otpError = "";
    renderCharityAuth();

    try {
      const { data, error } = await getFoodSaveSupabase().auth.verifyOtp({
        email,
        token,
        type: "email"
      });

      if (error) throw error;

      const user = data?.user || data?.session?.user;
      state.otpVerified = true;
      state.authUserId = user?.id || state.authUserId || "";
      state.authEmail = user?.email || email;
      state.otpError = "";
      setCharityStep(2);
      notify("Xác thực thành công", "Email đã được xác minh bằng OTP.", "info");
    } catch (error) {
      state.otpVerified = false;
      state.otpError = error.message || "Mã OTP không chính xác, vui lòng kiểm tra lại.";
      notify("OTP không hợp lệ", state.otpError, "error");
    } finally {
      state.otpVerifying = false;
      charityVerifyPending = false;
      renderCharityAuth();
    }
  }

  async function saveCharityOwnerProfile(supabaseClient, user, profilePayload, metadata) {
    const state = charityState();
    const phone = profilePayload.phone === "Chưa cập nhật" ? null : profilePayload.phone;
    const { error } = await supabaseClient
      .from("profiles")
      .upsert({
        id: user.id,
        role: "charity",
        email: normalizeCharityEmail(user.email || profilePayload.email),
        full_name: state.rep?.name || profilePayload.name,
        phone,
        status: "pending",
        metadata
      }, { onConflict: "id" });

    if (error) throw error;
  }

  async function saveCharityOrganizationProfile(supabaseClient, charityProfilePayload) {
    const { data: existingRows, error: findError } = await supabaseClient
      .from("charity_profiles")
      .select("id, slug")
      .eq("owner_id", charityProfilePayload.owner_id)
      .limit(1);

    if (findError) throw findError;

    const existing = Array.isArray(existingRows) ? existingRows[0] : null;
    if (existing?.id) {
      const { id, ...updatablePayload } = charityProfilePayload;
      const { data, error } = await supabaseClient
        .from("charity_profiles")
        .update({ ...updatablePayload, slug: existing.slug || charityProfilePayload.slug })
        .eq("id", existing.id)
        .select("*")
        .single();
      if (error) throw error;
      return data;
    }

    const { data, error } = await supabaseClient
      .from("charity_profiles")
      .insert(charityProfilePayload)
      .select("*")
      .single();

    if (error) throw error;
    return data;
  }

  async function submitCharityRegistration() {
    if (charitySubmitPending) return;
    syncCharityRegisterValues();
    const state = charityState();

    if (!state.otpVerified) {
      setCharityStep(1);
      state.otpError = "Vui lòng xác minh OTP trước khi gửi hồ sơ.";
      renderCharityAuth();
      notify("Chưa xác minh OTP", state.otpError, "warn");
      return;
    }

    if (!String(state.org?.name || "").trim()) {
      notify("Thiếu tên tổ chức", "Vui lòng nhập hoặc sửa tên tổ chức trước khi gửi hồ sơ.", "warn");
      setCharityStep(3);
      renderCharityAuth();
      return;
    }

    charitySubmitPending = true;
    state.submitting = true;
    renderCharityAuth();

    try {
      const supabaseClient = getFoodSaveSupabase();
      const { data: userData, error: userError } = await supabaseClient.auth.getUser();
      if (userError || !userData?.user?.id) {
        throw new Error("Phiên OTP đã hết hạn. Vui lòng xác minh lại email.");
      }

      const authUser = await updateCharityAuthPassword(supabaseClient, userData.user, state);
      await ensureCharityDocumentDataUrls(supabaseClient, authUser.id, state);
      const profilePayload = buildCharityRegistrationPayload(authUser.id);
      const metadata = buildCharityProfileMetadata(profilePayload);
      const charityProfilePayload = {
        ...profilePayload,
        metadata
      };

      await saveCharityOwnerProfile(supabaseClient, authUser, profilePayload, metadata);
      const charityProfile = await saveCharityOrganizationProfile(supabaseClient, charityProfilePayload);
      const { data: sessionData } = await supabaseClient.auth.getSession();

      state.submitted = true;
      state.submittedProfile = charityProfile;
      state.authUserId = authUser.id;

      if (sessionData?.session) {
        saveSession({
          session: sessionData.session,
          profile: {
            id: authUser.id,
            role: "charity",
            email: profilePayload.email,
            phone: profilePayload.phone,
            full_name: state.rep?.name || profilePayload.name,
            status: "pending"
          },
          context: { charity: charityProfile }
        }, "charity");
      }

      setCharityStep(5);
      notify("Đăng ký thành công", portalConfig.charity.pendingMessage, "info");
    } catch (error) {
      notify("Gửi hồ sơ thất bại", error.message || "Không thể lưu hồ sơ tổ chức.", "error");
    } finally {
      state.submitting = false;
      charitySubmitPending = false;
      renderCharityAuth();
    }
  }

  function charityMockOcrText(field, fileName) {
    if (field === "decision") {
      return `QUYẾT ĐỊNH THÀNH LẬP\nTên tổ chức\nMÁI ẤM HOA DƯƠNG\nSố hồ sơ: ${fileName || "decision.pdf"}`;
    }
    if (field === "cccdFront" || field === "cccdBack") {
      return "CĂN CƯỚC CÔNG DÂN\nHọ và tên\nNGUYỄN THỊ MINH ANH\nNgày sinh 12/04/1988\n079188012345";
    }
    return `FOODSAVE OCR\nTệp ${fileName || field}`;
  }

  function normalizeOcrText(value) {
    return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  }

  function cleanOcrName(value) {
    return String(value || "").replace(/[^\p{L}\s.'-]/gu, " ").replace(/\s+/g, " ").trim().toLocaleUpperCase("vi-VN");
  }

  function extractCharityRepresentativeName(text) {
    const lines = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const index = lines.findIndex((line) => normalizeOcrText(line).includes("ho va ten"));
    if (index >= 0 && lines[index + 1]) return cleanOcrName(lines[index + 1]);
    const sameLine = lines.find((line) => normalizeOcrText(line).includes("ho va ten") && line.includes(":"));
    return sameLine ? cleanOcrName(sameLine.split(":").slice(1).join(":")) : "";
  }

  function extractCharityOrganizationName(text) {
    const lines = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const index = lines.findIndex((line) => ["ten to chuc", "ten don vi", "to chuc"].some((key) => normalizeOcrText(line).includes(key)));
    if (index >= 0 && lines[index + 1]) return cleanOcrName(lines[index + 1]);
    const candidate = lines.find((line) => /(mai am|bep an|trung tam|vien|to chuc)/i.test(normalizeOcrText(line)));
    return candidate ? cleanOcrName(candidate) : "";
  }

  async function recognizeCharityDocument(field, file, fallbackName) {
    if (file && file.type && file.type.startsWith("image/") && window.Tesseract && typeof window.Tesseract.recognize === "function") {
      try {
        const result = await window.Tesseract.recognize(file, "vie+eng");
        const text = result && result.data ? result.data.text : "";
        if (text && text.trim()) return text;
      } catch (error) {
        notify("OCR chưa sẵn sàng", "Tesseract không đọc được ảnh này, FoodSave dùng dữ liệu mô phỏng để bạn kiểm thử UI.", "warn");
      }
    }
    return charityMockOcrText(field, fallbackName);
  }

  function applyCharityOcrToState(field, text) {
    if (typeof window.applyCharityOcrResult === "function") {
      window.applyCharityOcrResult(field, text);
      return;
    }
    if (field === "cccdFront" || field === "cccdBack") {
      const name = extractCharityRepresentativeName(text);
      const cccd = (String(text || "").match(/\b\d{12}\b/) || [])[0] || "";
      if (name) writeCharityValue("rep.name", name);
      if (cccd) writeCharityValue("rep.cccd", cccd);
    }
    if (field === "decision") {
      const org = extractCharityOrganizationName(text);
      if (org) writeCharityValue("org.name", org);
    }
  }

  function isCharityUpload(field, input, options = {}) {
    const id = input && input.id ? input.id : "";
    return options.role === "charity" ||
      pageRole === "charity" ||
      Boolean(select("#charityRegisterForm")) ||
      /^upload(CCCD|Decision|License|Finance|Logo|Cover)/.test(id);
  }

  async function markCharityFileUploaded(field, input, options = {}) {
    const file = input?.files?.[0] || null;
    if (!file && !options.mock) return;
    const state = charityState();
    state.docs = state.docs || {};
    const preview = file && file.type && file.type.startsWith("image/") ? URL.createObjectURL(file) : "";
    state.docs[field] = {
      ...(state.docs[field] || {}),
      name: file?.name || `${field}-mock.jpg`,
      rawFile: file || null,
      preview,
      dataUrl: "",
      url: "",
      mimeType: file?.type || "",
      size: file?.size || 0,
      status: "analyzing"
    };
    renderCharityAuth();

    const text = await recognizeCharityDocument(field, file, state.docs[field].name);
    const nextState = charityState();
    nextState.docs = nextState.docs || {};
    nextState.docs[field] = {
      ...(nextState.docs[field] || {}),
      name: file?.name || nextState.docs[field]?.name || `${field}-mock.jpg`,
      rawFile: file || nextState.docs[field]?.rawFile || null,
      preview: preview || nextState.docs[field]?.preview || "",
      dataUrl: nextState.docs[field]?.dataUrl || "",
      url: nextState.docs[field]?.url || "",
      mimeType: file?.type || nextState.docs[field]?.mimeType || "",
      size: file?.size || nextState.docs[field]?.size || 0,
      status: "done"
    };
    applyCharityOcrToState(field, text);
    renderCharityAuth();
  }

  function mockCharityOcrProcess(field) {
    return markCharityFileUploaded(field, null, { role: "charity", mock: true });
  }

  function stopFoodSaveFaceStream() {
    const stream = window.__foodsaveFaceStream;
    if (stream && typeof stream.getTracks === "function") {
      stream.getTracks().forEach((track) => track.stop());
    }
    window.__foodsaveFaceStream = null;
  }

  function attachCharityFaceStream() {
    const holder = select("#videoFaceScan");
    const stream = window.__foodsaveFaceStream;
    if (!holder || !stream) return;
    holder.innerHTML = '<video id="regFaceVideo" autoplay muted playsinline style="width:100%;height:100%;object-fit:cover"></video>';
    const video = select("#regFaceVideo");
    if (video) video.srcObject = stream;
  }

  function initPartnerFaceScan(options = {}) {
    if (options.role === "charity" || pageRole === "charity" || select("#videoFaceScan")) {
      attachCharityFaceStream();
    }
  }

  function afterCharityRegisterRender() {
    if (pageRole !== "charity" && !select("#charityRegisterForm")) return;
    if (charityAuthState() !== "register") {
      stopFoodSaveFaceStream();
      return;
    }
    if (charityStep() === 2) initPartnerFaceScan({ role: "charity" });
    else stopFoodSaveFaceStream();
  }

  async function nextCharityRegisterStep() {
    setCharityAuthState("register");
    syncCharityRegisterValues();
    const step = charityStep();
    if (step === 0) {
      await sendCharityEmailOtp();
      return;
    }
    if (step === 1) {
      await verifyCharityEmailOtp();
      return;
    }
    if (step === 2) {
      const passwordError = charityRegistrationPasswordError();
      if (passwordError) {
        notify("Máº­t kháº©u chÆ°a há»£p lá»‡", passwordError, "warn");
        renderCharityAuth();
        return;
      }
    }
    if (step >= CHARITY_REGISTER_LAST_STEP - 1) {
      await submitCharityRegistration();
      return;
    }
    if (step < CHARITY_REGISTER_LAST_STEP) {
      setCharityStep(step + 1);
      renderCharityAuth();
      return;
    }
    setCharityAuthState("login");
    setCharityStep(0);
    renderCharityAuth();
    notify("Đăng ký thành công", portalConfig.charity.pendingMessage, "info");
  }

  function backCharityRegisterStep() {
    syncCharityRegisterValues();
    const step = charityStep();
    if (step <= 0) {
      setCharityAuthState("login");
      setCharityStep(0);
      stopFoodSaveFaceStream();
    } else {
      if (step === 2) stopFoodSaveFaceStream();
      setCharityStep(step - 1);
    }
    renderCharityAuth();
  }

  async function markSellerFileUploaded(field, input, options = {}) {
    if (isCharityUpload(field, input, options)) {
      return markCharityFileUploaded(field, input, { role: "charity" });
    }
    const file = input?.files?.[0];
    if (input) input.value = "";
    if (!file) return;
    savePartnerStep(partnerStep());
    const state = ensurePartnerRegistrationDefaults();
    const previousPreview = state.uploads?.[field]?.preview;
    if (previousPreview && String(previousPreview).startsWith("blob:")) URL.revokeObjectURL(previousPreview);
    const upload = {
      name: file.name,
      loading: true,
      preview: file.type && file.type.startsWith("image/") ? URL.createObjectURL(file) : "",
      dataUrl: "",
      rawFile: file,
      url: "",
      mimeType: file.type || "",
      size: file.size || 0,
      status: "analyzing"
    };
    state.uploads = { ...(state.uploads || {}), [field]: upload };
    if (field === "logo") state.logoFileName = file.name;
    else if (field === "cover") state.coverFileName = file.name;
    else state.docs = { ...(state.docs || {}), [field]: file.name };
    window.rAuth();

    let text = "";
    if (isPartnerOcrField(field)) {
      text = await recognizePartnerDocument(field, file, file.name);
      applyPartnerOcrToState(field, text);
    }
    const nextState = ensurePartnerRegistrationDefaults();
    nextState.uploads = {
      ...(nextState.uploads || {}),
      [field]: {
        ...(nextState.uploads?.[field] || upload),
        loading: false,
        status: "done",
        ocrText: text,
        rawFile: file,
        dataUrl: "",
        url: nextState.uploads?.[field]?.url || "",
        storagePath: nextState.uploads?.[field]?.storagePath || "",
        mimeType: file.type || nextState.uploads?.[field]?.mimeType || "",
        size: file.size || nextState.uploads?.[field]?.size || 0
      }
    };
    if (field !== "logo" && field !== "cover") nextState.docs = { ...(nextState.docs || {}), [field]: file.name };
    window.rAuth();
  }

  function partnerKycUnlocked() {
    const state = partnerState();
    return Boolean(state.docs?.cccdFront && state.docs?.cccdBack);
  }

  function attachPartnerFaceStream() {
    const video = select("#partner-face-video");
    const stream = window.__partnerFaceStream;
    if (!video || !stream) return;
    video.srcObject = stream;
    video.play?.().catch(() => {});
  }

  function stopPartnerFaceStream() {
    const stream = window.__partnerFaceStream;
    if (stream && typeof stream.getTracks === "function") {
      stream.getTracks().forEach((track) => track.stop());
    }
    window.__partnerFaceStream = null;
    const video = select("#partner-face-video");
    if (video) video.srcObject = null;
  }

  function startPartnerFaceScan(options = {}) {
    if (options.role === "charity" || pageRole === "charity" || select("#videoFaceScan")) {
      const state = charityState();
      state.face = { ...(state.face || {}), status: "loading", message: "Đang mở camera. Vui lòng cho phép trình duyệt truy cập camera." };
      renderCharityAuth();

      if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
        state.face = { ...(state.face || {}), status: "error", message: "Trình duyệt không hỗ trợ WebRTC camera." };
        renderCharityAuth();
        notify("Không thể mở camera", "Trình duyệt hiện tại không hỗ trợ getUserMedia.", "warn");
        return;
      }

      navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false })
        .then((stream) => {
          stopFoodSaveFaceStream();
          window.__foodsaveFaceStream = stream;
          const nextState = charityState();
          nextState.face = { ...(nextState.face || {}), status: "scanning", message: "Camera đã bật. Giữ khuôn mặt trong khung oval để FoodSave xác thực." };
          renderCharityAuth();
          attachCharityFaceStream();
          window.setTimeout(() => {
            stopFoodSaveFaceStream();
            const doneState = charityState();
            doneState.face = { ...(doneState.face || {}), status: "done", message: "Xác thực khuôn mặt thành công." };
            renderCharityAuth();
            notify("Xác thực thành công", "Khuôn mặt đã được xác thực cho hồ sơ tổ chức.", "info");
          }, 2600);
        })
        .catch((error) => {
          const errorState = charityState();
          errorState.face = { ...(errorState.face || {}), status: "error", message: "Không thể mở camera. Kiểm tra quyền truy cập hoặc thử lại." };
          renderCharityAuth();
          notify("Không thể mở camera", error.message || "Trình duyệt từ chối quyền camera.", "warn");
        });
      return;
    }
    const state = ensurePartnerRegistrationDefaults();
    state.ekyc = { ...(state.ekyc || {}), faceStatus: "skipped", faceVerified: true, faceError: "" };
    window.rAuth();
    notify("Không cần quyền thiết bị", "Partner hiện xác thực bằng OCR giấy tờ upload ảnh.", "info");
  }

  function partnerPasswordField(id, iconId, label, placeholder, disabled = false) {
    const account = partnerState().account || {};
    const value = id === "auth-register-password-confirm" ? account.passwordConfirm : account.password;
    return `<div class="field"><label>${label}</label><div style="position:relative"><input class="inp" id="${id}" type="password" autocomplete="new-password" placeholder="${placeholder}" value="${escapeHtml(value || "")}" style="padding-right:42px" ${disabled ? "disabled" : ""} oninput="FoodSaveAuth.validatePartnerPasswords()"><button type="button" class="btn btn-icon" style="position:absolute;right:4px;top:4px;width:36px;height:36px;border:0;background:transparent;color:var(--muted);box-shadow:none" onclick="FoodSaveAuth.togglePartnerPassword('${id}','${iconId}')" ${disabled ? "disabled" : ""}><i class="ti ti-eye" id="${iconId}"></i></button></div><div id="${id === "auth-register-password" ? "auth-register-password-error" : "auth-register-confirm-error"}" class="partner-error" style="min-height:16px"></div></div>`;
  }

  function partnerStepper() {
    const step = partnerStep();
    const progress = Math.round(((step + 1) / PARTNER_REGISTER_STEPS.length) * 100);
    return `<div class="partner-wizard-nav">
  <div class="partner-nav-stack">
    <button type="button" class="partner-nav-link" onclick="goView('landing')"><i class="ti ti-arrow-left"></i> Về trang chủ</button>
    <button type="button" class="partner-nav-link" onclick="FoodSaveAuth.cancelPartnerRegistration()"><i class="ti ti-arrow-left"></i> Đăng nhập</button>
  </div>
  <div class="partner-progress-caption">Bước ${step + 1}/${PARTNER_REGISTER_STEPS.length} · ${PARTNER_REGISTER_STEPS[step]}</div>
</div>
<div class="partner-progress-track"><span style="width:${progress}%"></span></div>`;
  }

  function partnerWizardActions() {
    const step = partnerStep();
    const last = PARTNER_REGISTER_STEPS.length - 1;
    if (step === last) return "";
    const isSubmitStep = step === last - 1;
    // PARTNER SECTION START
    const submitAttrs = isSubmitStep ? 'id="partner-step-6-submit" data-partner-step-action="submit"' : "";
    // PARTNER SECTION END
    return `<div class="partner-wizard-actions ${step === 0 ? "single" : ""}">
  <button type="button" class="btn btn-o btn-lg" onclick="FoodSaveAuth.backPartnerRegisterStep()"><i class="ti ti-arrow-left"></i> Quay lại</button>
  <button type="button" class="btn btn-primary btn-lg" ${submitAttrs} onclick="FoodSaveAuth.nextPartnerRegisterStep()">${isSubmitStep ? "Gửi hồ sơ" : "Tiếp tục"} <i class="ti ${isSubmitStep ? "ti-send" : "ti-arrow-right"}"></i></button>
</div>`;
  }

  // PARTNER SECTION START
  function forcePartnerStep6ToPendingDom() {
    const step6 = select("#partner-step-6, [data-partner-step='6']");
    const body = select(".partner-wizard-body");
    if (step6) {
      step6.classList.add("hidden");
      step6.classList.remove("active");
      step6.style.display = "none";
    }

    let step7 = select("#partner-step-7, [data-partner-step='7']");
    if (!step7 && body) {
      body.insertAdjacentHTML("beforeend", partnerStepPending());
      step7 = select("#partner-step-7, [data-partner-step='7']");
    }
    if (step7) {
      step7.classList.remove("hidden");
      step7.classList.add("active");
      step7.style.display = "block";
    }

    const actions = select(".partner-wizard-actions");
    if (actions) {
      actions.classList.add("hidden");
      actions.style.display = "none";
    }
  }

  function showPartnerRegisterStep(step) {
    setPartnerStep(step);

    if (partnerStep() === PARTNER_REGISTER_STEPS.length - 1) {
      forcePartnerStep6ToPendingDom();
    }

    const wizard = select(".partner-wizard");
    const body = select(".partner-wizard-body");
    if (wizard) {
      wizard.classList.remove("hidden");
      wizard.classList.add("active");
      wizard.style.display = "";
    }
    if (body) {
      body.classList.remove("hidden");
      body.style.display = "";
    }

    if (typeof window.rAuth === "function") window.rAuth();

    if (partnerStep() === PARTNER_REGISTER_STEPS.length - 1) {
      forcePartnerStep6ToPendingDom();
    }
  }

  function showPartnerPendingStep() {
    showPartnerRegisterStep(PARTNER_REGISTER_STEPS.length - 1);
  }

  async function handlePartnerStep6SubmitClick(e) {
    if (e?.preventDefault) e.preventDefault();
    if (e?.stopPropagation) e.stopPropagation();
    if (e?.stopImmediatePropagation) e.stopImmediatePropagation();

    try {
      await submitPartnerRegistration(e);
    } catch (error) {
      console.error('Lỗi ở Bước 6:', error);
      showPartnerPendingStep();
    }
  }

  function bindPartnerStep6SubmitButton() {
    const button = select("#partner-step-6-submit, [data-partner-step-action='submit']");
    if (!button || button.__foodsavePartnerStep6Bound) return;
    button.__foodsavePartnerStep6Bound = true;
    button.addEventListener('click', function(e) {
      if (partnerStep() !== PARTNER_REGISTER_STEPS.length - 2) return;
      handlePartnerStep6SubmitClick(e);
    }, true);
  }

  function installPartnerStep6ClickListener() {
    if (window.__foodsavePartnerStep6ClickListener) return;
    window.__foodsavePartnerStep6ClickListener = true;
    document.addEventListener('click', function(e) {
      const button = e.target?.closest ? e.target.closest("button") : null;
      if (!button || !button.closest(".partner-wizard-actions")) return;
      if (!button.classList.contains("btn-primary")) return;
      if (partnerStep() !== PARTNER_REGISTER_STEPS.length - 2) return;
      if (button.__foodsavePartnerStep6Bound) return;
      handlePartnerStep6SubmitClick(e);
    }, true);
    bindPartnerStep6SubmitButton();
    if (window.MutationObserver && document.body) {
      const observer = new MutationObserver(bindPartnerStep6SubmitButton);
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }

  installPartnerStep6ClickListener();
  // PARTNER SECTION END

  function partnerStepContact() {
    const value = partnerContactValue();
    return `
<section class="partner-section">
  <h2>Xác thực thông tin liên hệ</h2>
  <p>FoodSave dùng thông tin này để gửi OTP và điền trước các bước xác thực sau.</p>
  <div class="field"><label>Số điện thoại hoặc Email</label><input class="inp" id="partner-contact" autocomplete="email tel" placeholder="Nhập số điện thoại hoặc email" value="${escapeHtml(value)}" style="height:58px;font-size:16px"></div>
  <div class="partner-help">Bằng việc tiếp tục, bạn đồng ý với <a href="chinh-sach.html?source=partner" style="color:var(--green-700);font-weight:900">Chính sách bảo mật</a> và <a href="dieu-khoan.html?source=partner" style="color:var(--green-700);font-weight:900">Điều khoản sử dụng</a> của FoodSave.</div>
</section>`;
  }

  function partnerStepOtp() {
    const otp = ensurePartnerOtp(false);
    const value = String(otp.value || "").padEnd(6, " ").slice(0, 6).split("");
    const expired = partnerOtpRemainingSeconds() <= 0;
    return `
<section class="partner-section">
  <h2>Xác thực mã OTP</h2>
  <p>Mã xác thực đã được gửi đến ${escapeHtml(partnerContactValue() || "thông tin liên hệ của bạn")}.</p>
  <div style="display:flex;gap:10px;margin:16px 0 12px">${value.map((digit, index) => `<input class="inp partner-otp-box" inputmode="numeric" maxlength="1" value="${escapeHtml(digit.trim())}" oninput="FoodSaveAuth.partnerOtpInput(this,${index})" onkeydown="FoodSaveAuth.partnerOtpKey(this,${index},event)" style="width:52px;height:56px;text-align:center;font-size:22px;font-weight:900;font-family:'Plus Jakarta Sans'">`).join("")}</div>
  <div class="partner-help" style="display:flex;align-items:center;gap:10px"><i class="ti ti-clock"></i> Mã OTP có hiệu lực trong <strong id="partner-otp-timer">${formatPartnerOtpTime(partnerOtpRemainingSeconds())}</strong>.</div>
  <button id="partner-otp-resend" class="btn btn-o" style="margin-top:12px;display:${expired ? "inline-flex" : "none"}" onclick="FoodSaveAuth.resendPartnerOtp()"><i class="ti ti-refresh"></i> Gửi lại mã OTP</button>
  <div class="partner-error" style="margin-top:12px">${escapeHtml(otp.error || "")}</div>
</section>`;
  }

  function partnerStepEkyc() {
    const state = ensurePartnerRegistrationDefaults();
    const account = state.account || {};
    const contact = splitPartnerContact(partnerContactValue());
    if (contact.email && !account.email) account.email = contact.email;
    if (contact.phone && !account.phone) account.phone = contact.phone;
    const unlocked = partnerKycUnlocked();
    return `
<section class="partner-section">
  <h2>Thông tin Người đại diện & Xác thực</h2>
  <p>Tải ảnh CCCD để OCR tự điền dữ liệu người đại diện. Dữ liệu AI/OCR có thể chỉnh sửa trước khi gửi.</p>
  <h3>Khu vực 1: Tải lên ảnh Căn cước công dân</h3>
  <div class="partner-grid-2">
    <div>${partnerUploadBox("cccdFront", "CCCD Mặt trước", "Chọn ảnh có sẵn", { icon: "ti-id" })}</div>
    <div>${partnerUploadBox("cccdBack", "CCCD Mặt sau", "Chọn ảnh có sẵn", { icon: "ti-id-badge-2" })}</div>
  </div>
  <h3>Khu vực 2: Form điền thông tin</h3>
  ${unlocked ? "" : '<div class="partner-help" style="margin-bottom:12px;color:var(--yellow-600)"><i class="ti ti-alert-circle"></i> Cần tải đủ 2 mặt CCCD để qua bước tiếp theo, nhưng các ô đã được mở để bạn kiểm tra và chỉnh sửa dữ liệu OCR.</div>'}
  <div>
    <div class="partner-grid-2">
      <div class="field"><label>Tên người đại diện</label><input class="inp" id="auth-register-representative" value="${escapeHtml(account.representative || "")}"></div>
      <div class="field"><label>Số CCCD</label><input class="inp" id="partner-cccd-number" inputmode="numeric" value="${escapeHtml(account.cccdNumber || "")}"></div>
      <div class="field"><label>Email</label><input class="inp" id="auth-register-email" type="email" value="${escapeHtml(account.email || "")}"></div>
      <div class="field"><label>Số điện thoại</label><input class="inp" id="auth-register-phone" autocomplete="tel" value="${escapeHtml(account.phone || "")}"></div>
    </div>
    <div class="partner-help" style="margin-bottom:12px">Trích xuất tự động từ CCCD, có thể chỉnh sửa.</div>
    <div class="partner-grid-2">
      ${partnerPasswordField("auth-register-password", "auth-register-password-icon", "Mật khẩu", "In hoa, in thường, số và ký tự đặc biệt")}
      ${partnerPasswordField("auth-register-password-confirm", "auth-register-confirm-icon", "Xác nhận Mật khẩu", "Nhập lại mật khẩu")}
    </div>
  </div>
</section>`;
  }

  function partnerHashtagList() {
    const tags = partnerState().profile?.hashtags || [];
    if (!tags.length) return "";
    return `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px">${tags.map((tag) => `<span class="tg" style="background:var(--green-50);color:var(--green-800);border:1px solid var(--green-100)">${escapeHtml(tag)}</span>`).join("")}</div>`;
  }

  function partnerStepStoreLegal() {
    const state = ensurePartnerRegistrationDefaults();
    const profile = state.profile || {};
    const location = state.location || {};
    const account = state.account || {};
    return `
<section class="partner-section">
  <h2>Hồ sơ Cửa hàng & Pháp lý</h2>
  <p>Các nhóm được sắp theo luồng quét giấy tờ trước, sau đó hoàn thiện hồ sơ công khai và quản trị nội bộ.</p>
  <h3>Nhóm 1: Hồ sơ pháp lý & Chứng nhận An toàn</h3>
  <div class="partner-legal-pair-grid">
    <div class="partner-legal-pair">
      ${partnerUploadBox("businessLicense", "Giấy ĐKKD (Trang 1)", "Upload ảnh để tự điền pháp nhân", { icon: "ti-file-certificate" })}
      <div class="field partner-legal-field"><label>Tên pháp nhân công ty / Hộ kinh doanh cá thể</label><input class="inp" id="seller-legal-name" value="${escapeHtml(profile.legalName || "")}"></div>
    </div>
    <div class="partner-legal-pair">
      ${partnerUploadBox("businessLicenseExtra", "Thêm", "Trang 2, trang 3...", { icon: "ti-plus", add: true })}
      <div class="field partner-legal-field"><label>Mã số thuế / Số CMND/CCCD</label><input class="inp" id="seller-tax-code" value="${escapeHtml(profile.taxCode || "")}"></div>
    </div>
  </div>
  <div class="partner-grid-2">
    <div>${partnerUploadBox("foodSafety", "Giấy ATTP", "Chọn giấy chứng nhận", { icon: "ti-shield-check" })}</div>
    <div>${partnerUploadBox("foodSafetyExtra", "Thêm", "Trang bổ sung", { icon: "ti-plus", add: true })}</div>
  </div>

  <h3>Nhóm 2: Thông tin hiển thị cửa hàng</h3>
  <div class="partner-form-pair-grid">
    <div class="partner-form-pair">
      ${partnerUploadBox("logo", "Logo cửa hàng", "Ảnh vuông khuyến nghị", { icon: "ti-photo" })}
      <div class="field partner-form-pair-field"><label>Tên hiển thị của cửa hàng/Thương hiệu</label><input class="inp" id="auth-register-name" value="${escapeHtml(profile.storeName || "")}" placeholder="Tiệm bánh ABC"></div>
    </div>
    <div class="partner-form-pair">
      ${partnerUploadBox("cover", "Banner / Ảnh bìa", "Ảnh ngang khuyến nghị", { icon: "ti-photo-up" })}
      <div class="field partner-form-pair-field"><label>Số điện thoại Hotline Cửa hàng</label><input class="inp" id="seller-public-hotline" value="${escapeHtml(profile.hotline || "")}" placeholder="0900 000 000"><div class="partner-help">Hiển thị công khai để khách hàng liên hệ.</div></div>
    </div>
  </div>
  <div class="field"><label>Loại hình kinh doanh</label><select class="inp" id="seller-business-type" onchange="FoodSaveAuth.selectPartnerBusinessType(this.value)"><option value="">Chọn loại hình</option>${PARTNER_BUSINESS_TYPES.map((type) => `<option value="${type.id}" ${profile.businessType === type.id ? "selected" : ""}>${type.label}</option>`).join("")}</select></div>
  <div class="field"><label>Mô tả cửa hàng</label><textarea class="inp" id="seller-store-description" rows="3" placeholder="Giới thiệu ngắn về cửa hàng">${escapeHtml(profile.description || "")}</textarea></div>
  <div class="field"><label>Hashtag</label><input class="inp" id="seller-hashtag-input" placeholder="Gõ từ khóa và bấm Enter" onkeydown="FoodSaveAuth.handlePartnerHashtagKey(this,event)">${partnerHashtagList()}<div class="partner-help">Tối đa 5 tag.</div></div>
  <div class="field"><label>Địa chỉ chi tiết</label><input class="inp" id="seller-address-search" placeholder="Nhập địa chỉ hoặc dùng Google Places Autocomplete" value="${escapeHtml(location.formattedAddress || "")}" onblur="FoodSaveAuth.parseSellerTypedAddress()"></div>
  <div id="seller-map" style="height:220px;border:1.5px solid var(--line);border-radius:8px;background:var(--soft);margin-bottom:14px;display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:12px;font-weight:800;text-align:center;padding:16px"><i class="ti ti-map-pin" style="font-size:22px;color:var(--green-700);margin-right:6px"></i> Google Maps sẽ hiển thị khi API đã được nạp</div>

  <h3>Nhóm 3: Thông tin quản trị viên</h3>
  <div class="partner-admin-stack">
    <div class="field"><label>Chức vụ người đại diện</label><input class="inp" id="seller-admin-title" value="${escapeHtml(profile.adminTitle || "")}" placeholder="Chủ cửa hàng, Quản lý"></div>
    <div class="field"><label>Email quản trị</label><input class="inp" id="seller-admin-email" type="email" value="${escapeHtml(profile.adminEmail || account.email || "")}"><div class="partner-help">Dùng làm tài khoản đăng nhập hệ thống quản lý của Đối tác.</div></div>
    <div class="field"><label>Số điện thoại cá nhân liên hệ trực tiếp</label><input class="inp" id="seller-admin-phone" value="${escapeHtml(profile.adminPhone || account.phone || "")}"><div class="partner-help">Số bảo mật dùng để FoodSave liên hệ khẩn cấp, không hiển thị cho khách hàng.</div></div>
  </div>
</section>`;
  }

  function partnerBankStyle(bank) {
    const styles = {
      Vietcombank: "linear-gradient(135deg,#047857,#16a34a)",
      Techcombank: "linear-gradient(135deg,#b91c1c,#ef4444)",
      BIDV: "linear-gradient(135deg,#0369a1,#14b8a6)",
      "MB Bank": "linear-gradient(135deg,#1d4ed8,#38bdf8)",
      VPBank: "linear-gradient(135deg,#15803d,#f59e0b)",
      ACB: "linear-gradient(135deg,#075985,#2563eb)",
      Sacombank: "linear-gradient(135deg,#1e40af,#f97316)",
      VietinBank: "linear-gradient(135deg,#0f766e,#0ea5e9)"
    };
    return styles[bank] || "linear-gradient(135deg,#166534,#22c55e)";
  }

  function selectPartnerBank(value) {
    savePartnerStep(4);
    partnerState().finance = { ...(partnerState().finance || {}), bankName: value };
    window.rAuth();
  }

  function partnerStepFinance() {
    const finance = ensurePartnerRegistrationDefaults().finance || {};
    const bank = finance.bankName || "FoodSave Bank";
    return `
<section class="partner-section">
  <h2>Thiết lập Tài chính</h2>
  <p>Thông tin nhận thanh toán cho đơn hàng của đối tác.</p>
  <div class="partner-bank-card" style="background:${partnerBankStyle(finance.bankName)}">
    <div class="partner-bank-logo">${escapeHtml(String(bank).split(/\s+/).map((word) => word[0]).join("").slice(0, 3).toUpperCase())}</div>
    <div>
      <span>Ngân hàng nhận thanh toán</span>
      <strong>${escapeHtml(bank)}</strong>
      <small>${escapeHtml(finance.accountNumber || "•••• •••• ••••")}</small>
    </div>
  </div>
  <div class="field"><label>Lựa chọn Ngân hàng</label><select class="inp" id="seller-bank-name" onchange="FoodSaveAuth.selectPartnerBank(this.value)"><option value="">Chọn ngân hàng</option>${PARTNER_BANKS.map((item) => `<option value="${item}" ${finance.bankName === item ? "selected" : ""}>${item}</option>`).join("")}</select></div>
  <div class="field"><label>Số tài khoản ngân hàng</label><input class="inp" id="seller-bank-account" inputmode="numeric" value="${escapeHtml(finance.accountNumber || "")}" placeholder="0123456789"></div>
  <div class="field"><label>Tên chủ tài khoản</label><input class="inp" id="seller-bank-holder" value="${escapeHtml(finance.accountHolder || "")}" placeholder="NGUYEN MINH ANH" style="text-transform:uppercase" oninput="FoodSaveAuth.formatBankAccountName(this)"><div class="partner-help">Phải trùng khớp với tên trên CCCD/Giấy ĐKKD.</div></div>
</section>`;
  }

  function togglePartnerAutomation(key) {
    savePartnerStep(5);
    const state = ensurePartnerRegistrationDefaults();
    state.automation = { ...(state.automation || {}), [key]: !state.automation?.[key] };
    window.rAuth();
  }

  function partnerSwitch(key, label, note) {
    const active = partnerState().automation?.[key] !== false;
    return `<div class="f ac jb" style="gap:14px;padding:14px 0;border-bottom:1px solid var(--line)">
  <div><strong style="display:block;font-size:13.5px;color:var(--ink-soft)">${escapeHtml(label)}</strong><small style="color:var(--muted);font-weight:700">${escapeHtml(note)}</small></div>
  <button type="button" class="partner-switch ${active ? "active" : ""}" onclick="FoodSaveAuth.togglePartnerAutomation('${key}')"><span></span></button>
</div>`;
  }

  // PARTNER SECTION START
  function partnerStepOperations() {
    const state = ensurePartnerRegistrationDefaults();
    const scheduleByDay = Object.fromEntries((state.operations?.schedule || []).map((item) => [item.day, item]));
    return `
<section id="partner-step-6" class="partner-section partner-step-panel" data-partner-step="6">
  <h2>Vận hành & Chính sách</h2>
  <p>Cấu hình giờ hoạt động, nhãn hạn sử dụng và tự động hóa bán hàng.</p>
  <h3>Cấu hình giờ hoạt động</h3>
  <div style="border:1px solid var(--line);border-radius:8px;padding:8px;margin-bottom:18px">${partnerWeekDays().map((day) => {
    const item = scheduleByDay[day] || { day, open: true, from: "08:00", to: "22:00" };
    return `<div class="f ac jb seller-day-row" data-day="${day}" style="gap:10px;padding:10px 8px;border-bottom:1px solid var(--line)"><div class="f ac g8"><button type="button" class="partner-switch ${item.open === false ? "" : "active"}" onclick="FoodSaveAuth.toggleSellerDay('${day}',this)"><span></span></button><strong style="min-width:76px;color:var(--ink-soft);font-size:13px">${day}</strong></div><div class="f ac g6"><input data-time="from" type="time" class="inp" value="${item.from || "08:00"}" ${item.open === false ? "disabled" : ""} style="width:116px;padding:9px"><span style="color:var(--muted)">-</span><input data-time="to" type="time" class="inp" value="${item.to || "22:00"}" ${item.open === false ? "disabled" : ""} style="width:116px;padding:9px"></div></div>`;
  }).join("")}</div>
  <h3>Cấu hình Quy tắc Nhãn HSD</h3>
  <div class="partner-grid-3">
    <div class="partner-policy-card"><span class="partner-policy-dot green"></span><strong>Nhãn Xanh</strong><small>Thời hạn 3-5 ngày.</small></div>
    <div class="partner-policy-card"><span class="partner-policy-dot yellow"></span><strong>Nhãn Vàng</strong><small>Còn 48h.</small></div>
    <div class="partner-policy-card"><span class="partner-policy-dot red"></span><strong>Nhãn Đỏ</strong><small>Cận khẩn cấp 24h.</small></div>
  </div>
  <h3>Thiết lập tự động</h3>
  ${partnerSwitch("dynamicPricing", "Kích hoạt điều chỉnh giá linh hoạt khi sản phẩm gần hết hạn.", "Ưu tiên đẩy deal phù hợp nhãn HSD.")}
  ${partnerSwitch("charityTransfer", "Tự động chuyển trạng thái Tặng từ thiện khi không bán được.", "Giúp sản phẩm còn dùng được đến đúng tổ chức nhận hỗ trợ.")}
  ${state.submitted ? `<div style="margin-top:18px;padding:16px;border-radius:8px;background:var(--green-50);border:1px solid var(--green-100);color:var(--green-800);font-weight:800"><i class="ti ti-circle-check"></i> Hồ sơ đã được gửi. FoodSave sẽ phản hồi trong 24-48 giờ.</div>` : ""}
</section>`;
  }
  // PARTNER SECTION END

  // PARTNER SECTION START
  function partnerStepPending() {
    return `
<section id="partner-step-7" class="partner-section partner-step-panel" data-partner-step="7" style="text-align:center;padding:34px 28px">
  <div style="width:104px;height:104px;border-radius:30px;background:linear-gradient(135deg,var(--green-50),var(--green-100));display:flex;align-items:center;justify-content:center;margin:0 auto 22px;box-shadow:0 22px 48px rgba(34,197,94,.18)">
    <i class="ti ti-hourglass" style="font-size:50px;color:var(--green-800)"></i>
  </div>
  <h2 class="auth-h" style="font-size:30px;margin-bottom:12px">Tài khoản đang chờ duyệt</h2>
  <p class="auth-sub" style="max-width:560px;margin:0 auto 24px;line-height:1.75">Tài khoản của bạn đang trong trạng thái <strong style="color:var(--green-800)">CHỜ DUYỆT</strong>. Đội ngũ FoodSave sẽ phản hồi trong vòng <strong style="color:var(--green-800)">24-48 giờ</strong>.</p>
  <div style="display:grid;gap:8px;text-align:left;margin:0 auto 24px;max-width:520px">
    ${["Kiểm tra pháp lý cửa hàng", "Đối chiếu eKYC người đại diện", "Rà soát tài khoản nhận thanh toán"].map((label) => `<div class="f ac jb" style="padding:12px 14px;background:#fff;border:1px solid var(--line);border-radius:8px"><span style="font-size:12.5px;color:var(--ink-soft);font-weight:800">${label}</span><span style="font-size:11px;font-weight:900;color:var(--yellow-600);display:flex;align-items:center;gap:5px"><i class="ti ti-loader"></i> Đang xử lý</span></div>`).join("")}
  </div>
  <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
    <button type="button" class="btn btn-o btn-lg" onclick="FoodSaveAuth.backPartnerRegisterStep()"><i class="ti ti-file-text"></i> Xem lại hồ sơ</button>
    <button type="button" class="btn btn-primary btn-lg" onclick="FoodSaveAuth.finishPartnerPending()"><i class="ti ti-home"></i> Về trang chủ</button>
  </div>
</section>`;
  }
  // PARTNER SECTION END

  function partnerRegisterWizardPage() {
    ensurePartnerRegistrationDefaults();
    const pages = [partnerStepContact, partnerStepOtp, partnerStepEkyc, partnerStepStoreLegal, partnerStepFinance, partnerStepOperations, partnerStepPending];
    const step = partnerStep();
    return `<div class="partner-wizard">
  <div class="partner-wizard-head">
    <h1 class="partner-wizard-title">Đăng ký Cửa hàng Đối tác</h1>
    ${partnerStepper()}
  </div>
  <div class="partner-wizard-body">${(pages[step] || partnerStepPending)()}</div>
  ${partnerWizardActions()}
</div>`;
  }

  function savePartnerStep(step) {
    const state = ensurePartnerRegistrationDefaults();
    if (step === 0) {
      const parsed = splitPartnerContact(readValue("#partner-contact"));
      state.account = { ...(state.account || {}), ...parsed };
      if (parsed.email) state.profile = { ...(state.profile || {}), adminEmail: state.profile?.adminEmail || parsed.email };
      if (parsed.phone) state.profile = { ...(state.profile || {}), adminPhone: state.profile?.adminPhone || parsed.phone };
    }
    if (step === 1) {
      const boxes = Array.from(document.querySelectorAll(".partner-otp-box"));
      state.otp = { ...(state.otp || {}), value: boxes.map((box) => box.value || "").join("") };
    }
    if (step === 2) {
      state.account = {
        ...(state.account || {}),
        representative: readValue("#auth-register-representative") || state.account?.representative || "",
        cccdNumber: readValue("#partner-cccd-number") || state.account?.cccdNumber || "",
        email: readValue("#auth-register-email") || state.account?.email || "",
        phone: normalizePhone(readValue("#auth-register-phone") || state.account?.phone || ""),
        password: readValue("#auth-register-password") || state.account?.password || "",
        passwordConfirm: readValue("#auth-register-password-confirm") || state.account?.passwordConfirm || ""
      };
    }
    if (step === 3) {
      state.profile = {
        ...(state.profile || {}),
        legalName: readValue("#seller-legal-name"),
        taxCode: readValue("#seller-tax-code"),
        storeName: readValue("#auth-register-name"),
        hotline: normalizePhone(readValue("#seller-public-hotline")),
        businessType: readValue("#seller-business-type") || state.profile?.businessType || "",
        description: readValue("#seller-store-description"),
        adminTitle: readValue("#seller-admin-title"),
        adminEmail: readValue("#seller-admin-email"),
        adminPhone: normalizePhone(readValue("#seller-admin-phone"))
      };
      const address = readValue("#seller-address-search");
      if (address) state.location = { ...(state.location || {}), formattedAddress: address };
    }
    if (step === 4) {
      state.finance = {
        ...(state.finance || {}),
        bankName: readValue("#seller-bank-name"),
        accountNumber: readValue("#seller-bank-account").replace(/\s/g, ""),
        accountHolder: stripVietnameseTone(readValue("#seller-bank-holder")).toUpperCase().replace(/\s+/g, " ").trim()
      };
    }
    if (step === 5) {
      state.operations = {
        ...(state.operations || {}),
        schedule: Array.from(document.querySelectorAll(".seller-day-row")).map((row) => {
          const open = row.querySelector(".partner-switch")?.classList.contains("active");
          return {
            day: row.getAttribute("data-day"),
            open,
            from: row.querySelector("[data-time='from']")?.value || "08:00",
            to: row.querySelector("[data-time='to']")?.value || "22:00"
          };
        })
      };
    }
  }

  function validatePartnerStep(step) {
    savePartnerStep(step);
    const state = ensurePartnerRegistrationDefaults();
    if (step === 0) {
      const contact = normalizePartnerEmail(state.account?.contact || state.account?.email || "");
      if (!contact) return "Vui lòng nhập email để nhận OTP.";
      if (!PORTAL_EMAIL_RE.test(contact)) return "Vui lòng nhập email hợp lệ để nhận OTP.";
    }
    if (step === 1) {
      const otp = ensurePartnerOtp(false);
      if (partnerOtpRemainingSeconds() <= 0) {
        state.otp = { ...(state.otp || {}), error: "Mã OTP đã hết hạn, vui lòng gửi lại mã OTP." };
        window.rAuth();
        return state.otp.error;
      }
      if (!/^\d{6}$/.test(String(otp.value || ""))) {
        state.otp = { ...(state.otp || {}), error: "Vui lòng nhập đủ mã OTP 6 chữ số." };
        window.rAuth();
        return state.otp.error;
      }
      state.otp = { ...(state.otp || {}), error: "" };
    }
    if (step === 2) {
      const account = state.account || {};
      if (!state.docs?.cccdFront) return "Vui lòng tải CCCD mặt trước.";
      if (!state.docs?.cccdBack) return "Vui lòng tải CCCD mặt sau.";
      if (!account.representative) return "Vui lòng nhập tên người đại diện.";
      if (!account.cccdNumber) return "Vui lòng nhập số CCCD.";
      if (!PORTAL_EMAIL_RE.test(account.email || "")) return "Email đăng nhập không hợp lệ.";
      if (!account.phone || account.phone.length < 8) return "Số điện thoại không hợp lệ.";
      const passwordError = passwordErrorText(account.password, account.passwordConfirm);
      if (passwordError) return passwordError;
    }
    if (step === 3) {
      const profile = state.profile || {};
      const location = state.location || {};
      if (!state.docs?.businessLicense) return "Vui lòng tải Giấy ĐKKD.";
      if (!profile.legalName) return "Vui lòng nhập tên pháp nhân công ty.";
      if (!profile.taxCode) return "Vui lòng nhập mã số thuế.";
      if (!state.docs?.foodSafety) return "Vui lòng tải Giấy chứng nhận ATTP.";
      if (!state.logoFileName) return "Vui lòng tải logo cửa hàng.";
      if (!state.coverFileName) return "Vui lòng tải banner/ảnh bìa cửa hàng.";
      if (!profile.storeName) return "Vui lòng nhập tên hiển thị cửa hàng.";
      if (!profile.hotline || profile.hotline.length < 8) return "Số hotline cửa hàng không hợp lệ.";
      if (!profile.businessType) return "Vui lòng chọn loại hình kinh doanh.";
      if (!profile.description || profile.description.length < 12) return "Mô tả cửa hàng cần ít nhất 12 ký tự.";
      if (!location.formattedAddress) return "Vui lòng nhập địa chỉ chi tiết cửa hàng.";
      if (!PORTAL_EMAIL_RE.test(profile.adminEmail || "")) return "Email quản trị không hợp lệ.";
      if (!profile.adminPhone || profile.adminPhone.length < 8) return "Số điện thoại cá nhân không hợp lệ.";
    }
    if (step === 4) {
      const finance = state.finance || {};
      if (!finance.bankName) return "Vui lòng chọn ngân hàng.";
      if (!/^\d{6,24}$/.test(String(finance.accountNumber || ""))) return "Số tài khoản phải gồm 6-24 chữ số.";
      if (!finance.accountHolder) return "Vui lòng nhập tên chủ tài khoản.";
    }
    return "";
  }

  function selectPartnerBusinessType(type) {
    if (partnerStep() === 3) savePartnerStep(3);
    partnerState().profile = { ...(partnerState().profile || {}), businessType: type };
    window.rAuth();
  }

  function handlePartnerHashtagKey(input, event) {
    if (event?.key !== "Enter") return;
    event.preventDefault();
    savePartnerStep(3);
    const state = ensurePartnerRegistrationDefaults();
    const tags = state.profile?.hashtags || [];
    const raw = String(input?.value || "").trim();
    if (!raw || tags.length >= 5) return;
    const normalized = raw.startsWith("#") ? raw : `#${raw}`;
    state.profile = { ...(state.profile || {}), hashtags: [...tags, normalized].slice(0, 5) };
    if (input) input.value = "";
    window.rAuth();
  }

  function limitPartnerHashtags(input) {
    const tags = readPartnerTags(input?.value || "");
    partnerState().profile = { ...(partnerState().profile || {}), hashtags: tags };
    if (input) input.value = tags.join(" ");
  }

  function toggleSellerDay(day, toggle) {
    const row = toggle?.closest(".seller-day-row") || document.querySelector(`.seller-day-row[data-day="${day}"]`);
    if (!row) return;
    toggle.classList.toggle("active");
    const open = toggle.classList.contains("active");
    row.querySelectorAll("input[type='time']").forEach((input) => {
      input.disabled = !open;
    });
    savePartnerStep(5);
  }

  function afterPartnerRegisterRender() {
    setPartnerWizardMode(portalAuthState() === "register");
    if (portalAuthState() !== "register") {
      stopPartnerOtpTimer();
      stopPartnerFaceStream();
      return;
    }
    if (partnerStep() === 1) startPartnerOtpTimer();
    else stopPartnerOtpTimer();
    if (partnerStep() === 2) {
      validatePartnerPasswords();
    } else {
      stopPartnerFaceStream();
    }
    if (partnerStep() === 3) window.setTimeout(initSellerGoogleMaps, 80);
  }

  function compactPartnerPayload(payload) {
    return Object.fromEntries(Object.entries(payload || {}).filter(([, value]) => value !== undefined && value !== null && value !== ""));
  }

  function partnerSlug(value, userId) {
    const base = stripVietnameseTone(value || "cua-hang-foodsave")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 54) || "cua-hang-foodsave";
    const suffix = String(userId || Date.now()).replace(/[^a-z0-9]/gi, "").slice(0, 8) || Date.now().toString(36);
    return `${base}-${suffix}`;
  }

  function partnerCoordinate(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function partnerAddressParts(location) {
    const formatted = String(location?.formattedAddress || location?.address || "").trim();
    const parts = formatted.split(",").map((item) => item.trim()).filter(Boolean);
    return {
      address: formatted || "Chưa cập nhật",
      district: location?.district || (parts.length >= 3 ? parts[parts.length - 2] : ""),
      city: location?.city || (parts.length >= 2 ? normalizeVietnamAdminName(parts[parts.length - 1], "province") : "TP.HCM"),
      latitude: partnerCoordinate(location?.lat || location?.latitude),
      longitude: partnerCoordinate(location?.lng || location?.longitude)
    };
  }

  function partnerOpeningHoursText(schedule) {
    const openSlots = (schedule || [])
      .filter((item) => item && item.open !== false)
      .map((item) => `${item.day || ""} ${item.from || "08:00"}-${item.to || "22:00"}`.trim());
    return openSlots.length ? openSlots.join("; ") : "Cập nhật sau";
  }

  function partnerStoredAssetUrl(value) {
    const url = String(value || "").trim();
    if (!url || url.startsWith("data:") || url.startsWith("blob:")) return "";
    return url;
  }

  function partnerStorageSafeFileName(name) {
    const safeName = stripVietnameseTone(name || "upload")
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "");
    return safeName || "upload";
  }

  function partnerStoragePath(userId, field, file) {
    const safeUserId = String(userId || "partner").replace(/[^a-z0-9_-]/gi, "") || "partner";
    const safeField = String(field || "file").replace(/[^a-z0-9_-]/gi, "") || "file";
    const safeFileName = partnerStorageSafeFileName(file?.name || `${safeField}.jpg`);
    const nonce = Math.random().toString(36).slice(2, 10);
    return `${safeUserId}/${safeField}/${Date.now()}-${nonce}-${safeFileName}`;
  }

  async function uploadPartnerFilesToStorage(supabaseClient, userId, state) {
    if (!supabaseClient?.storage?.from) {
      throw new Error("Supabase Storage is not ready for partner asset upload.");
    }

    const uploads = state?.uploads || {};
    const bucket = supabaseClient.storage.from(PARTNER_STORAGE_BUCKET);
    const uploadedUrls = {};

    await Promise.all(PARTNER_DOCUMENT_FIELDS.map(async (field) => {
      const upload = uploads[field] || {};
      const file = upload.rawFile;
      if (!file) {
        const existingUrl = partnerStoredAssetUrl(upload.url);
        if (existingUrl) uploadedUrls[field] = existingUrl;
        return;
      }

      const path = partnerStoragePath(userId, field, file);
      const { data, error } = await bucket.upload(path, file, {
        cacheControl: "3600",
        contentType: file.type || "application/octet-stream",
        upsert: true
      });

      if (error) {
        logPartnerSupabaseError(`storage upload failed for ${field}`, error, { bucket: PARTNER_STORAGE_BUCKET, path });
        throw error;
      }

      const storagePath = data?.path || path;
      const { data: publicData } = bucket.getPublicUrl(storagePath);
      const publicUrl = partnerStoredAssetUrl(publicData?.publicUrl);
      if (!publicUrl) throw new Error(`Supabase Storage did not return a public URL for ${field}.`);

      uploadedUrls[field] = publicUrl;
      state.uploads = state.uploads || {};
      state.uploads[field] = {
        ...upload,
        url: publicUrl,
        storagePath,
        dataUrl: "",
        loading: false,
        status: upload.status && upload.status !== "analyzing" ? upload.status : "done"
      };
    }));

    return uploadedUrls;
  }

  function partnerDocumentsMetadata(state, uploadedUrls = {}) {
    const docs = state.docs || {};
    const uploads = state.uploads || {};
    return Object.fromEntries(PARTNER_DOCUMENT_FIELDS.map((field) => {
      const upload = uploads[field] || {};
      const rawDoc = docs[field];
      const rawDocObject = rawDoc && typeof rawDoc === "object" ? rawDoc : {};
      const name = upload.name || (typeof rawDoc === "string" ? rawDoc : rawDoc?.name) || "";
      const url = partnerStoredAssetUrl(uploadedUrls[field] || upload.url || rawDocObject.url);
      return [field, {
        name,
        status: upload.status || (name ? "uploaded" : "idle"),
        ocrText: upload.ocrText || rawDocObject.ocrText || "",
        url,
        preview: url,
        dataUrl: "",
        mimeType: upload.mimeType || rawDocObject.mimeType || "",
        size: upload.size || rawDocObject.size || 0
      }];
    }).filter(([, doc]) => doc.name || doc.status !== "idle"));
  }

  function partnerSupabaseSchemaError(error) {
    const text = `${error?.code || ""} ${error?.message || ""} ${error?.details || ""}`.toLowerCase();
    return text.includes("42p01")
      || text.includes("42703")
      || text.includes("relation")
      || text.includes("column")
      || text.includes("schema cache")
      || text.includes("could not find");
  }

  function partnerSupabaseErrorInfo(error) {
    return {
      code: error?.code || "",
      message: error?.message || "",
      details: error?.details || "",
      hint: error?.hint || "",
      status: error?.status || "",
      name: error?.name || ""
    };
  }

  function logPartnerSupabaseError(context, error, payload) {
    console.error(`[FoodSave Partner Registration] ${context}`, {
      error: partnerSupabaseErrorInfo(error),
      payload
    });
  }

  function partnerSubmitErrorMessage(error) {
    const info = partnerSupabaseErrorInfo(error);
    const text = `${info.code} ${info.message} ${info.details}`.toLowerCase();
    if (text.includes("row-level security") || text.includes("rls") || info.code === "42501") {
      return "Supabase từ chối ghi dữ liệu do chính sách RLS. Kiểm tra policy insert/update cho partner_profiles, stores và profiles.";
    }
    if (info.code === "23502" || text.includes("null value")) {
      return "Supabase báo thiếu trường bắt buộc. Xem console để biết cột nào đang bị null.";
    }
    if (info.code === "22P02" || text.includes("invalid input syntax")) {
      return "Supabase báo sai kiểu dữ liệu. Xem console để biết field nào cần đổi kiểu.";
    }
    if (info.code === "23505" || text.includes("duplicate key")) {
      return "Dữ liệu đã tồn tại trong Supabase. Hệ thống sẽ cần upsert đúng khóa profile_id/store_id.";
    }
    return error?.message || "Không thể gửi hồ sơ lên Supabase.";
  }

  function partnerOwnerProfileCompatiblePayload(payload) {
    const allowed = ["id", "role", "full_name", "phone", "avatar_url", "status", "metadata"];
    return Object.fromEntries(allowed.filter((key) => Object.prototype.hasOwnProperty.call(payload, key)).map((key) => [key, payload[key]]));
  }

  function partnerProfileCompatiblePayload(payload) {
    const allowed = ["profile_id", "email", "phone", "representative_name", "business_type", "metadata"];
    return Object.fromEntries(allowed.filter((key) => Object.prototype.hasOwnProperty.call(payload, key)).map((key) => [key, payload[key]]));
  }

  function buildPartnerRegistrationPayloads(userId, uploadedUrls = {}) {
    const state = ensurePartnerRegistrationDefaults();
    const account = state.account || {};
    const profile = state.profile || {};
    const finance = state.finance || {};
    const schedule = state.operations?.schedule?.length
      ? state.operations.schedule
      : partnerWeekDays().map((day) => ({ day, open: true, from: "08:00", to: "22:00" }));
    const verifiedEmail = partnerVerifiedEmail(state);
    const emailCandidate = partnerContactEmail(state);
    const email = PORTAL_EMAIL_RE.test(emailCandidate) ? emailCandidate : verifiedEmail;
    const phone = partnerContactPhone(state);
    const storeName = String(profile.storeName || profile.legalName || "Cửa hàng FoodSave").trim();
    const addressInfo = partnerAddressParts(state.location || {});
    const documents = partnerDocumentsMetadata(state, uploadedUrls);
    const automation = {
      dynamicPricing: state.automation?.dynamicPricing !== false,
      charityTransfer: state.automation?.charityTransfer !== false
    };
    const submittedAt = new Date().toISOString();
    const metadata = {
      onboarding_status: "pending",
      verified_email: verifiedEmail || email,
      representative: {
        name: account.representative || "",
        cccd_number: account.cccdNumber || "",
        title: profile.adminTitle || ""
      },
      store: {
        name: storeName,
        legal_name: profile.legalName || "",
        tax_code: profile.taxCode || "",
        business_type: profile.businessType || "other",
        description: profile.description || "",
        hashtags: profile.hashtags || [],
        hotline: profile.hotline || ""
      },
      contact: {
        email,
        phone,
        admin_email: profile.adminEmail || email,
        admin_phone: profile.adminPhone || phone
      },
      address: addressInfo,
      finance: {
        bank_name: finance.bankName || "",
        bank_account_number: finance.accountNumber || "",
        bank_account_holder: finance.accountHolder || ""
      },
      documents,
      opening_schedule: schedule,
      automation,
      submitted_at: submittedAt
    };

    const storePayload = compactPartnerPayload({
      owner_id: userId,
      name: storeName || "Cửa hàng đối tác", // Đảm bảo luôn có tên, không bị rỗng (Null)
      slug: partnerSlug(storeName, userId) + '-' + Date.now(), // Gắn thêm thời gian để 100% không bao giờ trùng lặp slug
      description: profile.description || "Cửa hàng đối tác FoodSave",
      hashtags: profile.hashtags || [],
      public_hotline: profile.hotline || phone,
      legal_name: profile.legalName || storeName,
      tax_code: profile.taxCode || "",
      address: addressInfo.address || "Chưa cập nhật địa chỉ", // Tránh lỗi Null address
      district: addressInfo.district,
      city: addressInfo.city || "TP.HCM",
      latitude: addressInfo.latitude,
      longitude: addressInfo.longitude,
      logo_url: documents.logo?.url || "",
      cover_url: documents.cover?.url || "",
      service_tier: "Starter",
      is_verified: false,
      is_open: true,
      opening_hours: partnerOpeningHoursText(schedule),
      status: "pending",
      onboarding_status: "pending"
    });

    const partnerProfilePayload = compactPartnerPayload({
      profile_id: userId,
      email,
      phone,
      representative_name: account.representative || "",
      representative_title: profile.adminTitle || "",
      cccd_number: account.cccdNumber || "",
      legal_name: profile.legalName || storeName,
      tax_code: profile.taxCode || "",
      business_license_number: profile.businessLicenseNumber || "",
      business_type: profile.businessType || "other",
      public_hotline: profile.hotline || phone,
      admin_email: profile.adminEmail || email,
      admin_phone: profile.adminPhone || phone,
      bank_name: finance.bankName || "",
      bank_account_number: finance.accountNumber || "",
      bank_account_holder: finance.accountHolder || "",
      documents,
      opening_schedule: schedule,
      automation,
      onboarding_status: "pending",
      terms_accepted_at: submittedAt,
      metadata
    });

    const partnersPayload = compactPartnerPayload({
      owner_id: userId,
      auth_user_id: userId,
      profile_id: userId,
      store_name: storeName,
      name: storeName,
      legal_name: profile.legalName || storeName,
      email,
      phone,
      representative_name: account.representative || "",
      cccd_number: account.cccdNumber || "",
      tax_code: profile.taxCode || "",
      mst: profile.taxCode || "",
      business_type: profile.businessType || "other",
      address: addressInfo.address,
      district: addressInfo.district,
      city: addressInfo.city || "TP.HCM",
      bank_name: finance.bankName || "",
      bank_account_number: finance.accountNumber || "",
      bank_account_holder: finance.accountHolder || "",
      documents,
      opening_schedule: schedule,
      automation,
      status: "pending",
      onboarding_status: "pending",
      metadata
    });

    const partnersLeanPayload = compactPartnerPayload({
      store_name: storeName,
      email,
      phone,
      representative_name: account.representative || "",
      cccd_number: account.cccdNumber || "",
      tax_code: profile.taxCode || "",
      address: addressInfo.address,
      status: "pending"
    });

    const partnersMstPayload = compactPartnerPayload({
      store_name: storeName,
      email,
      phone,
      representative_name: account.representative || "",
      cccd_number: account.cccdNumber || "",
      mst: profile.taxCode || "",
      address: addressInfo.address,
      status: "pending"
    });

    return {
      email,
      phone,
      storeName,
      metadata,
      storePayload,
      partnerProfilePayload,
      partnersPayload,
      partnersLeanPayload,
      partnersMstPayload
    };
  }

  async function insertPartnerRow(supabaseClient, payloads) {
    const attempts = [payloads.partnersPayload, payloads.partnersLeanPayload, payloads.partnersMstPayload];
    let lastError = null;
    for (const payload of attempts) {
      const { data, error } = await supabaseClient
        .from("partners")
        .insert(payload)
        .select("*")
        .single();
      if (!error) return { table: "partners", data };
      lastError = error;
      logPartnerSupabaseError("partners insert failed", error, payload);
      if (!partnerSupabaseSchemaError(error)) break;
    }
    return { table: "partners", error: lastError };
  }

  async function savePartnerOwnerProfile(supabaseClient, user, payloads) {
    const payload = {
      id: user.id,
      role: "partner",
      email: normalizePartnerEmail(user.email || payloads.email),
      full_name: payloads.metadata.representative.name || payloads.storeName,
      phone: payloads.phone || null,
      status: "pending",
      metadata: {
        role: "partner",
        store_name: payloads.storeName,
        business_type: payloads.metadata.store.business_type,
        tax_code: payloads.metadata.store.tax_code,
        cccd_number: payloads.metadata.representative.cccd_number,
        onboarding_status: "pending",
        partner_registration: payloads.metadata
      },
      terms_accepted_at: payloads.metadata.submitted_at
    };
    const { error } = await supabaseClient
      .from("profiles")
      .upsert(payload, { onConflict: "id" });

    if (!error) return;

    logPartnerSupabaseError("profiles upsert failed", error, payload);
    if (!partnerSupabaseSchemaError(error)) throw error;

    const compatiblePayload = partnerOwnerProfileCompatiblePayload(payload);
    const { error: retryError } = await supabaseClient
      .from("profiles")
      .upsert(compatiblePayload, { onConflict: "id" });

    if (retryError) {
      logPartnerSupabaseError("profiles compatible upsert failed", retryError, compatiblePayload);
      throw retryError;
    }
  }

  function partnerStoreCompatiblePayload(payload) {
    const allowed = [
      "owner_id",
      "name",
      "slug",
      "address",
      "district",
      "city",
      "latitude",
      "longitude",
      "service_tier",
      "is_verified",
      "is_open",
      "opening_hours",
      "status"
    ];
    return Object.fromEntries(allowed.filter((key) => Object.prototype.hasOwnProperty.call(payload, key)).map((key) => [key, payload[key]]));
  }

  async function writePartnerStoreRecord(supabaseClient, storeId, payload) {
    const query = storeId
      ? supabaseClient.from("stores").update(payload).eq("id", storeId)
      : supabaseClient.from("stores").insert(payload);
    const { data, error } = await query.select("*").single();
    if (!error) return data;
    logPartnerSupabaseError(storeId ? "stores update failed" : "stores insert failed", error, payload);
    if (!partnerSupabaseSchemaError(error)) throw error;

    const compatiblePayload = partnerStoreCompatiblePayload(payload);
    const retryQuery = storeId
      ? supabaseClient.from("stores").update(compatiblePayload).eq("id", storeId)
      : supabaseClient.from("stores").insert(compatiblePayload);
    const { data: retryData, error: retryError } = await retryQuery.select("*").single();
    if (retryError) {
      logPartnerSupabaseError(storeId ? "stores compatible update failed" : "stores compatible insert failed", retryError, compatiblePayload);
      throw retryError;
    }
    return retryData;
  }

  async function savePartnerStore(supabaseClient, user, payloads) {
    const { data: existingStore, error: findError } = await supabaseClient
      .from("stores")
      .select("id")
      .eq("owner_id", user.id)
      .limit(1)
      .maybeSingle();

    if (findError && findError.code !== "PGRST116") throw findError;

    if (existingStore?.id) {
      return writePartnerStoreRecord(supabaseClient, existingStore.id, payloads.storePayload);
    }

    return writePartnerStoreRecord(supabaseClient, "", payloads.storePayload);
  }

  async function savePartnerProfileDetails(supabaseClient, store, payloads) {
    const payload = {
      ...payloads.partnerProfilePayload,
      store_id: store?.id || null
    };
    const { data, error } = await supabaseClient
      .from("partner_profiles")
      .upsert(payload, { onConflict: "profile_id" })
      .select("*")
      .single();

    if (!error && data) return data;

    if (error) logPartnerSupabaseError("partner_profiles upsert failed", error, payload);
    if (error && !partnerSupabaseSchemaError(error)) throw error;

    const compatiblePayload = partnerProfileCompatiblePayload(payload);
    const { data: retryData, error: retryError } = await supabaseClient
      .from("partner_profiles")
      .upsert(compatiblePayload, { onConflict: "profile_id" })
      .select("*")
      .single();

    if (retryError || !retryData) {
      logPartnerSupabaseError("partner_profiles compatible upsert failed", retryError || new Error("Supabase không trả về partner_profiles row."), compatiblePayload);
      throw retryError || new Error("Supabase không trả về partner_profiles row.");
    }
    return retryData;
  }

  async function savePartnerRegistrationToSupabase() {
    const state = ensurePartnerRegistrationDefaults();
    const supabaseClient = getFoodSaveSupabase();
    const { data: userData, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !userData?.user?.id) {
      if (userError) logPartnerSupabaseError("auth.getUser failed", userError);
      throw new Error("Phiên OTP đã hết hạn. Vui lòng xác minh lại email.");
    }

    const userEmail = normalizePartnerEmail(userData.user.email || "");
    const expectedEmail = partnerVerifiedEmail(state) || partnerContactEmail(state);
    if (!state.otp?.verified) {
      if (userEmail && expectedEmail && userEmail === expectedEmail) {
        state.otp = {
          ...(state.otp || {}),
          email: userEmail,
          verified: true,
          verifying: false,
          error: "",
          verifiedAt: state.otp?.verifiedAt || new Date().toISOString()
        };
        state.authUserId = userData.user.id;
        state.authEmail = userEmail;
      } else {
        state.otp = { ...(state.otp || {}), error: "Vui lòng xác minh OTP trước khi gửi hồ sơ." };
        throw new Error(state.otp.error);
      }
    }

    const authUser = await updatePartnerAuthPassword(supabaseClient, userData.user, state);
    state.authUserId = authUser.id;
    state.authEmail = authUser.email || userEmail || expectedEmail;
    const uploadedUrls = await uploadPartnerFilesToStorage(supabaseClient, authUser.id, state);
    const payloads = buildPartnerRegistrationPayloads(authUser.id, uploadedUrls);
    await savePartnerOwnerProfile(supabaseClient, authUser, payloads);
    let partnerProfile = await savePartnerProfileDetails(supabaseClient, null, payloads);
    if (!partnerProfile) throw new Error("Supabase chưa lưu được partner_profiles.");

    let store = null;
    try {
      store = await savePartnerStore(supabaseClient, authUser, payloads);
      if (store?.id) {
        partnerProfile = await savePartnerProfileDetails(supabaseClient, store, payloads);
      }
    } catch (error) {
      logPartnerSupabaseError("stores save skipped after partner_profiles success", error, payloads.storePayload);
    }

    const partnersRow = await insertPartnerRow(supabaseClient, payloads);
    const { data: sessionData } = await supabaseClient.auth.getSession();

    if (sessionData?.session) {
      // PARTNER SECTION START
      saveSession({
        session: sessionData.session,
        profile: {
          id: authUser.id,
          role: "partner",
          email: payloads.email,
          status: "pending"
        }
      }, "partner");
      // PARTNER SECTION END
    }

    return { partnersRow, store, partnerProfile };
  }

  async function submitPartnerRegistration(event) {
    const submitEvent = event || window.event;
    if (submitEvent?.preventDefault) submitEvent.preventDefault();
    if (submitEvent?.stopPropagation) submitEvent.stopPropagation();
    if (portalRegisterPending) return;
    portalRegisterPending = true;
    const submitStep = PARTNER_REGISTER_STEPS.length - 2;
    savePartnerStep(submitStep);
    const state = ensurePartnerRegistrationDefaults();

    try {
      state.submitting = true;
      window.rAuth();
      // PARTNER SECTION START
      let savedProfile = null;
      try {
        savedProfile = await savePartnerRegistrationToSupabase();
      } catch (error) {
        console.error('Lỗi ở Bước 6:', error);
        state.submitError = error?.message || String(error || "");
      }
      state.submitted = true;
      state.submittedProfile = savedProfile;
      stopPartnerFaceStream();
      showPartnerPendingStep();
      // PARTNER SECTION END
    } catch (error) {
      // PARTNER SECTION START
      console.error('Lỗi ở Bước 6:', error);
      showPartnerPendingStep();
      // PARTNER SECTION END
    } finally {
      state.submitting = false;
      portalRegisterPending = false;
      window.rAuth();
    }
  }

  async function nextPartnerRegisterStep(event) {
    const stepEvent = event || window.event;
    if (stepEvent?.preventDefault) stepEvent.preventDefault();
    if (stepEvent?.stopPropagation) stepEvent.stopPropagation();
    const step = partnerStep();
    const pendingStep = PARTNER_REGISTER_STEPS.length - 1;
    if (step === pendingStep) return finishPartnerPending();

    if (step === 0) {
      const error = validatePartnerStep(step);
      if (error) {
        notify("Thiếu thông tin", error, "warn");
        return;
      }
      await sendPartnerEmailOtp();
      return;
    }

    if (step === 1) {
      await verifyPartnerEmailOtp();
      return;
    }

    const error = validatePartnerStep(step);
    if (error) {
      if (step === 2) validatePartnerPasswords();
      notify(step === 1 ? "OTP không hợp lệ" : "Thiếu thông tin", error, "warn");
      return;
    }
    if (step === pendingStep - 1) {
      await submitPartnerRegistration(stepEvent);
      return;
    }
    setPartnerStep(step + 1);
    window.rAuth();
  }

  function backPartnerRegisterStep(event) {
    const backEvent = event || window.event;
    if (backEvent?.preventDefault) backEvent.preventDefault();
    if (backEvent?.stopPropagation) backEvent.stopPropagation();
    const step = partnerStep();
    savePartnerStep(step);
    if (step <= 0) return;
    setPartnerStep(step - 1);
    window.rAuth();
  }

  async function registerPortal(role) {
    if (role === "partner") {
      await submitPartnerRegistration();
      return;
    }

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

      const body = {
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

  function partnerProfileStatus(partnerProfile) {
    const metadata = partnerProfile?.metadata && typeof partnerProfile.metadata === "object" ? partnerProfile.metadata : {};
    return normalizeProfileStatus(partnerProfile?.onboarding_status || metadata.onboarding_status || partnerProfile?.status);
  }

  function partnerStoreContext(partnerProfile, user, email) {
    const metadata = partnerProfile?.metadata && typeof partnerProfile.metadata === "object" ? partnerProfile.metadata : {};
    const storeMeta = metadata.store && typeof metadata.store === "object" ? metadata.store : {};
    const name = storeMeta.name
      || partnerProfile?.legal_name
      || user?.user_metadata?.store_name
      || user?.user_metadata?.full_name
      || email
      || portalConfig.partner.defaultName;
    return {
      id: partnerProfile?.store_id || null,
      name,
      status: partnerProfileStatus(partnerProfile) || "pending"
    };
  }

  async function loadSupabasePartnerAuthContext(supabaseClient, user) {
    // PARTNER SECTION START
    const { data, error } = await supabaseClient
      .from("partner_profiles")
      .select("profile_id,email,phone,representative_name,status,onboarding_status,store_id,legal_name")
      .eq("profile_id", user.id)
      .maybeSingle();
    // PARTNER SECTION END

    console.log("=== DATA PARTNER TRẢ VỀ ===", { data, error });

    if (error) {
      console.warn("[FoodSave Partner Login] partner_profiles lookup failed", partnerSupabaseErrorInfo(error));
    }

    return { partnerProfile: data || null, partnerError: error || null };
  }

  async function loadSupabasePartnerStoreContext(supabaseClient, partnerProfile, user, email) {
    let storeContext = partnerStoreContext(partnerProfile, user, email);
    try {
      let query = supabaseClient
        .from("stores")
        .select("id,name,address,logo_url")
        .limit(1);

      query = partnerProfile?.store_id
        ? query.eq("id", partnerProfile.store_id)
        : query.eq("owner_id", user.id);

      const { data, error } = await query.maybeSingle();
      if (error) {
        console.warn("[FoodSave Partner Login] stores lookup failed", partnerSupabaseErrorInfo(error));
        return storeContext;
      }

      if (data) {
        storeContext = {
          ...storeContext,
          id: data.id || storeContext.id,
          name: data.name || storeContext.name,
          address: data.address || "",
          logo_url: data.logo_url || ""
        };
      }
    } catch (error) {
      console.warn("[FoodSave Partner Login] stores lookup skipped", partnerSupabaseErrorInfo(error));
    }
    return storeContext;
  }

  async function loginPartnerWithSupabase() {
    // PARTNER SECTION START
    const email = normalizePartnerEmail(requireValue("#auth-login-identifier", "email"));
    const password = requireValue("#auth-login-password", "mật khẩu");

    if (!PORTAL_EMAIL_RE.test(email)) {
      throw new Error("Vui lòng nhập email hợp lệ để đăng nhập cửa hàng.");
    }

    const supabaseClient = getPartnerLoginSupabaseClient();
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) {
      console.error("[FoodSave Partner Login] signInWithPassword failed", partnerSupabaseErrorInfo(error));
      throw error;
    }

    const user = data?.user || data?.session?.user;
    const session = data?.session;
    if (!user || !session) throw new Error("Supabase không trả về phiên đăng nhập hợp lệ.");

    const { partnerProfile } = await loadSupabasePartnerAuthContext(supabaseClient, user);
    const storeContext = await loadSupabasePartnerStoreContext(supabaseClient, partnerProfile, user, email);

    const representativeName = String(
      partnerProfile?.representative_name
      || user.user_metadata?.representative_name
      || user.user_metadata?.full_name
      || ""
    ).trim();

    const authPayload = {
      session,
      profile: {
        id: user.id,
        role: "partner",
        email: user.email || email,
        full_name: representativeName || user.email || email,
        representative_name: representativeName,
        store_id: storeContext.id || partnerProfile?.store_id || null,
        status: "active"
      },
      context: {
        store: storeContext
      }
    };

    saveSession(authPayload, "partner");
    enterPortalWithAuth("partner", authPayload);
    // PARTNER SECTION END
  }

  function normalizeProfileStatus(value) {
    return String(value || "").trim().toLowerCase();
  }

  function charityMetadataStatus(metadata) {
    const meta = metadata && typeof metadata === "object" ? metadata : {};
    return normalizeProfileStatus(
      meta.status
      || meta.onboarding_status
      || meta.charity_status
      || meta.charity_profile?.status
      || meta.charity_profile?.onboarding_status
    );
  }

  function normalizePortalRole(value) {
    const role = String(value || "").trim().toLowerCase();
    return ["customer", "partner", "charity", "admin"].includes(role) ? role : "";
  }

  function charityFallbackProfile(user, requestedEmail) {
    const metadata = user?.user_metadata || {};
    return {
      id: user?.id || "",
      role: normalizePortalRole(metadata.role) || "charity",
      email: normalizeCharityEmail(user?.email || requestedEmail || metadata.email || ""),
      full_name: metadata.full_name || metadata.org_name || user?.email || portalConfig.charity.defaultName,
      phone: metadata.phone || "",
      status: metadata.status || metadata.onboarding_status || "",
      metadata
    };
  }

  function logCharityLogin(context, detail) {
    console.log(`[FoodSave Charity Login] ${context}`, detail || {});
  }

  function warnCharityLogin(context, error) {
    console.warn(`[FoodSave Charity Login] ${context}`, partnerSupabaseErrorInfo(error));
  }

  async function loadSupabaseCharityAuthContext(supabaseClient, user) {
    const contextErrors = [];
    let profile = charityFallbackProfile(user);
    let profileResult = await supabaseClient
      .from("profiles")
      .select("id, role, email, full_name, phone, status, metadata")
      .eq("id", user.id)
      .limit(1);

    if (profileResult.error && partnerSupabaseSchemaError(profileResult.error)) {
      warnCharityLogin("profiles lookup failed; retrying with compatible columns", profileResult.error);
      profileResult = await supabaseClient
        .from("profiles")
        .select("id, role, full_name, phone, status, metadata")
        .eq("id", user.id)
        .limit(1);
    }

    if (profileResult.error) {
      contextErrors.push({ table: "profiles", error: partnerSupabaseErrorInfo(profileResult.error) });
      warnCharityLogin("profiles lookup skipped after Supabase Auth success", profileResult.error);
    } else if (Array.isArray(profileResult.data) && profileResult.data.length) {
      profile = {
        ...profile,
        ...profileResult.data[0],
        email: normalizeCharityEmail(profileResult.data[0].email || profile.email || user.email || "")
      };
    }

    let charityProfile = null;
    const { data, error } = await supabaseClient
      .from("charity_profiles")
      .select("*")
      .eq("owner_id", user.id)
      .limit(1)
      .maybeSingle();

    console.log("=== DATA PROFILE TRẢ VỀ ===", { data, error });

    if (error) {
      contextErrors.push({ table: "charity_profiles", error: partnerSupabaseErrorInfo(error) });
      warnCharityLogin("charity_profiles lookup skipped after Supabase Auth success", error);
    } else if (data) {
      charityProfile = data;
    }

    return { profile, charityProfile, contextErrors };
  }

  function isCharityProfileDashboardEnabled(charityProfile) {
    if (!charityProfile) return false;
    const status = normalizeProfileStatus(charityProfile.status);
    return status === "active" || charityProfile.is_open === true || String(charityProfile.is_open).toLowerCase() === "true";
  }

  function isCharityPendingApproval(profile, charityProfile) {
    if (charityProfile) return !isCharityProfileDashboardEnabled(charityProfile);
    const metadataStatus = charityMetadataStatus(profile?.metadata);
    const profileStatus = normalizeProfileStatus(profile?.status);
    const effectiveStatus = metadataStatus || profileStatus;
    return effectiveStatus === "pending";
  }

  async function loginCharityWithSupabase() {
    const identifierInput = select("#auth-login-identifier");
    const passwordInput = select("#auth-login-password");
    const rawIdentifier = identifierInput && "value" in identifierInput ? String(identifierInput.value) : undefined;
    const rawPassword = passwordInput && "value" in passwordInput ? String(passwordInput.value) : undefined;
    const email = normalizeCharityEmail(rawIdentifier);
    const password = String(rawPassword || "").trim();

    logCharityLogin("form values before signInWithPassword", {
      identifierInputFound: !!identifierInput,
      passwordInputFound: !!passwordInput,
      rawIdentifier,
      normalizedEmail: email,
      emailEmpty: !email,
      passwordType: typeof rawPassword,
      passwordLength: typeof rawPassword === "string" ? rawPassword.length : 0,
      passwordEmpty: !password
    });

    if (!email) throw new Error("Vui lòng nhập email");
    if (!password) throw new Error("Vui lòng nhập mật khẩu");

    if (!PORTAL_EMAIL_RE.test(email)) {
      throw new Error("Vui lòng nhập email hợp lệ để đăng nhập tổ chức.");
    }

    const supabaseClient = getFoodSaveSupabase();
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) {
      console.error("[FoodSave Charity Login] signInWithPassword failed", partnerSupabaseErrorInfo(error));
      throw error;
    }

    const user = data?.user || data?.session?.user;
    const session = data?.session;
    if (!user || !session) throw new Error("Supabase không trả về phiên đăng nhập hợp lệ.");

    logCharityLogin("signInWithPassword success", {
      userId: user.id,
      userEmail: user.email || email,
      hasSession: !!session
    });

    const { profile, charityProfile, contextErrors } = await loadSupabaseCharityAuthContext(supabaseClient, user);
    if (contextErrors.length) {
      logCharityLogin("Auth succeeded; continuing with fallback profile because context lookup failed", {
        contextErrors
      });
    }

    const userRole = normalizePortalRole(profile?.role || user.user_metadata?.role);
    if (userRole && userRole !== "charity" && !charityProfile) {
      await supabaseClient.auth.signOut();
      throw new Error("Tài khoản này không phải tài khoản tổ chức từ thiện.");
    }

    if (!charityProfile) {
      logCharityLogin("No charity_profiles row returned; check RLS owner SELECT policy", {
        userId: user.id,
        expectedOwnerId: user.id
      });
    }

    if (isCharityPendingApproval(profile, charityProfile)) {
      notify("Tài khoản đang chờ duyệt", portalConfig.charity.pendingMessage, "warn");
      return;
    }

    const authPayload = {
      session,
      profile: {
        ...profile,
        role: "charity",
        email: profile.email || user.email || email,
        full_name: profile.full_name || charityProfile?.name || user.email || portalConfig.charity.defaultName,
        status: charityProfile?.status || profile.status || "active"
      },
      context: { charity: charityProfile }
    };

    saveSession(authPayload, "charity");
    enterPortalWithAuth("charity", authPayload);
  }

  async function loginPortal(role) {
    if (portalLoginPending) return;
    portalLoginPending = true;
    try {
      if (role === "partner") {
        await loginPartnerWithSupabase();
        return;
      }

      if (role === "charity") {
        await loginCharityWithSupabase();
        return;
      }

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
    upsertCustomerProfile,
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
    togglePartnerPassword,
    validatePartnerPasswords,
    formatBankAccountName,
    initSellerGoogleMaps,
    parseVietnamAddressFromPlace,
    normalizeVietnamAdminName,
    nextPartnerRegisterStep,
    backPartnerRegisterStep,
    finishPartnerPending,
    cancelPartnerRegistration,
    markSellerFileUploaded,
    markCharityFileUploaded,
    mockCharityOcrProcess,
    toggleSellerDay,
    parseSellerTypedAddress,
    selectPartnerBusinessType,
    limitPartnerHashtags,
    sendPartnerEmailOtp,
    verifyPartnerEmailOtp,
    resendPartnerOtp,
    partnerOtpInput,
    partnerOtpKey,
    submitPartnerRegistration,
    sendCharityEmailOtp,
    resendCharityEmailOtp: sendCharityEmailOtp,
    verifyCharityEmailOtp,
    ensureCharityDocumentDataUrls,
    submitCharityRegistration,
    nextCharityRegisterStep,
    backCharityRegisterStep,
    afterCharityRegisterRender,
    initPartnerFaceScan,
    startPartnerFaceScan,
    selectPartnerBank,
    handlePartnerHashtagKey,
    togglePartnerAutomation,
    beginPhoneSignup,
    backToRegisterMethods,
    oauthNotice
  };
  window.initPartnerFaceScan = initPartnerFaceScan;
  window.startPartnerFaceScan = startPartnerFaceScan;
  window.markSellerFileUploaded = markSellerFileUploaded;
  window.markCharityFileUploaded = markCharityFileUploaded;
  window.sendPartnerEmailOtp = sendPartnerEmailOtp;
  window.verifyPartnerEmailOtp = verifyPartnerEmailOtp;
  window.submitPartnerRegistration = submitPartnerRegistration;
  window.sendCharityEmailOtp = sendCharityEmailOtp;
  window.verifyCharityEmailOtp = verifyCharityEmailOtp;
  window.ensureCharityDocumentDataUrls = ensureCharityDocumentDataUrls;
  window.submitCharityRegistration = submitCharityRegistration;
  window.nextCharityRegisterStep = nextCharityRegisterStep;
  window.backCharityRegisterStep = backCharityRegisterStep;

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
    const legacyRAuth = window.rAuth;
    window.loginPage = function () { return portalLoginPage(pageRole); };
    window.forgotPage = function () { return portalForgotPage(pageRole); };
    window.regAccount = function () { return portalRegisterAccountPage(pageRole); };
    window.regNext = function (event) {
      if (event?.preventDefault) event.preventDefault();
      if (event?.stopPropagation) event.stopPropagation();
      if (pageRole === "partner") {
        void nextPartnerRegisterStep(event);
        return;
      }
      if (pageRole === "charity") {
        void nextCharityRegisterStep();
        return;
      }
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
    window.regBack = function (event) {
      if (event?.preventDefault) event.preventDefault();
      if (event?.stopPropagation) event.stopPropagation();
      if (pageRole === "partner") {
        backPartnerRegisterStep(event);
        return;
      }
      if (pageRole === "charity") {
        backCharityRegisterStep();
        return;
      }
      if (regStep <= 2) regStep = 0;
      else regStep -= 1;
      window.rAuth();
    };
    if (pageRole === "partner") {
      window.rAuth = function () {
        const container = select("#auth-c");
        if (!container) {
          if (typeof legacyRAuth === "function") legacyRAuth();
          return;
        }

        const state = portalAuthState();
        setPartnerWizardMode(state === "register");
        let html = state === "register" ? "" : '<div class="auth-back" onclick="goView(\'landing\')"><i class="ti ti-arrow-left"></i> Về trang chủ</div>';
        if (state === "login") html += portalLoginPage("partner");
        else if (state === "forgot") html += portalForgotPage("partner");
        else if (state === "qr" && typeof window.qrPage === "function") html += window.qrPage();
        else if (state === "otp" && typeof window.otpPage === "function") html += window.otpPage();
        else if (state === "register") html += portalRegisterAccountPage("partner");
        else html += portalLoginPage("partner");

        container.innerHTML = html;
        afterPartnerRegisterRender();
      };
    }
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
function initMap() {
    // 1. Kiểm tra thư viện Google Maps đã nạp chưa
    if (typeof google === 'undefined' || !google.maps) {
        setTimeout(initMap, 500); // Đợi 0.5s rồi thử lại
        return;
    }

    // 2. Vẽ bản đồ
    const mapDiv = document.getElementById("map");
    if (mapDiv) {
        new google.maps.Map(mapDiv, {
            center: { lat: 10.738, lng: 106.697 },
            zoom: 15
        });
    }

    // 3. Khởi tạo luôn cả Autocomplete ở đây cho nó "đồng bộ"
    const input = document.getElementById('store-address');
    if (input) {
        const autocomplete = new google.maps.places.Autocomplete(input);
        autocomplete.addListener('place_changed', function() {
            // Logic xử lý khi chọn địa chỉ của bạn...
        });
    }
}

// Chạy khi trang đã load xong
window.onload = initMap;
