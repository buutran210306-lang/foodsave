(function () {
  "use strict";

  const LOCAL_API_BASE_URL = "http://localhost:8080/api/v1";
  const API_PATH = "/api/v1";
  const AUTH_STORAGE_KEY = "foodsave.auth.session";
  const NEARBY_LOCATION_STORAGE_KEY = "foodsave.nearby.location";
  const NEARBY_NOTIFICATION_STORAGE_KEY = "foodsave.nearby.notified";
  const DEFAULT_NEARBY_RADIUS_KM = 5;

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

  function normalizeDistanceKm(value) {
    const distance = Number(value);
    if (!Number.isFinite(distance) || distance < 0) return 0;
    return Math.round(distance * 100) / 100;
  }

  function distanceLabel(value) {
    const distance = normalizeDistanceKm(value);
    if (!distance) return "";
    if (distance < 1) return `${Math.round(distance * 1000)}m`;
    return `${distance}km`;
  }

  function normalizeRadiusKm(value) {
    const radius = Number(value);
    if (!Number.isFinite(radius) || radius <= 0) return DEFAULT_NEARBY_RADIUS_KM;
    return Math.min(radius, 50);
  }

  function readNearbyLocation() {
    try {
      const raw = localStorage.getItem(NEARBY_LOCATION_STORAGE_KEY);
      const value = raw ? JSON.parse(raw) : null;
      const latitude = Number(value && value.latitude);
      const longitude = Number(value && value.longitude);
      const radiusKm = normalizeRadiusKm(value && value.radiusKm);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
      return { latitude, longitude, radiusKm };
    } catch (error) {
      return null;
    }
  }

  function saveNearbyLocation(location) {
    localStorage.setItem(NEARBY_LOCATION_STORAGE_KEY, JSON.stringify(location));
    window.FOODSAVE_NEARBY_LOCATION = location;
  }

  function clearStoredNearbyLocation() {
    localStorage.removeItem(NEARBY_LOCATION_STORAGE_KEY);
    window.FOODSAVE_NEARBY_LOCATION = null;
  }

  function catalogPath(basePath, location, options) {
    if (!location) return `${basePath}?limit=100`;
    const params = new URLSearchParams({
      limit: "100",
      lat: String(location.latitude),
      lng: String(location.longitude),
      radius_km: String(location.radiusKm || DEFAULT_NEARBY_RADIUS_KM)
    });
    if (options && options.sortNearest) params.set("sort", "nearest");
    return `${basePath}?${params.toString()}`;
  }

  function browserLocation() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("Trình duyệt chưa hỗ trợ GPS."));
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          radiusKm: normalizeRadiusKm(DEFAULT_NEARBY_RADIUS_KM)
        }),
        () => reject(new Error("Không lấy được vị trí. Hãy cho phép FoodSave truy cập GPS.")),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 }
      );
    });
  }

  function readAuthSession() {
    try {
      const raw = localStorage.getItem(AUTH_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  function authToken() {
    const session = readAuthSession();
    return session && typeof session.accessToken === "string" ? session.accessToken : "";
  }

  function directSupabaseClient() {
    if (window.foodsaveSupabase) return window.foodsaveSupabase;
    if (window.FoodSaveAuth && typeof window.FoodSaveAuth.getSupabaseClient === "function") {
      return window.FoodSaveAuth.getSupabaseClient();
    }
    if (typeof window.getFoodSaveSupabaseClient === "function") {
      return window.getFoodSaveSupabaseClient();
    }
    return null;
  }

  function normalizeOrderLookup(orderId) {
    const raw = String(orderId || "").trim().replace(/^#/, "");
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return {
      column: uuidPattern.test(raw) ? "id" : "order_number",
      value: raw
    };
  }

  async function request(path, options) {
    const token = authToken();
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: options && options.method ? options.method : "GET",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: options && options.body ? JSON.stringify(options.body) : undefined
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload || payload.success !== true) {
      const message = payload && payload.error && payload.error.message ? payload.error.message : "FoodSave API không phản hồi hợp lệ";
      throw new Error(message);
    }

    return payload.data;
  }

  async function updateOrderPaymentDirect(orderId, patch) {
    const client = directSupabaseClient();
    if (!client) throw new Error("Supabase client is not ready for direct orders update.");

    const lookup = normalizeOrderLookup(orderId);
    const payload = {};
    if (patch.payment_method) payload.payment_method = patch.payment_method;
    if (patch.payment_status) payload.payment_status = patch.payment_status;
    if (patch.status) payload.status = patch.status;

    const { data, error } = await client
      .from("orders")
      .update(payload)
      .eq(lookup.column, lookup.value)
      .select("*")
      .single();

    if (error) throw error;
    return data;
  }

  async function updateOrderPayment(orderId, patch) {
    try {
      return await updateOrderPaymentDirect(orderId, patch);
    } catch (directError) {
      if (!patch.status && patch.payment_method) {
        throw directError;
      }
      const data = await request(`/orders/${encodeURIComponent(orderId)}/status`, {
        method: "PATCH",
        body: {
          status: patch.status || "confirmed",
          ...(patch.payment_status ? { payment_status: patch.payment_status } : {})
        }
      });
      if (patch.payment_method) data.payment_method = patch.payment_method;
      return data;
    }
  }

  function getGlobalArray(name) {
    try {
      const value = Function(`return typeof ${name} !== "undefined" ? ${name} : null`)();
      return Array.isArray(value) ? value : null;
    } catch (error) {
      return null;
    }
  }

  function replaceArray(name, items) {
    const target = getGlobalArray(name);
    if (!target) return;
    target.splice(0, target.length, ...items);
  }

  function centsToVnd(value) {
    return Math.round((Number(value) || 0) / 100);
  }

  function hoursUntil(value) {
    if (!value) return 0;
    const expiryTime = new Date(value).getTime();
    if (!Number.isFinite(expiryTime)) return 0;
    return Math.max(0, Math.round((expiryTime - Date.now()) / 3600000));
  }

  function productLabelFromExpiry(expiresAt, fallback) {
    if (!expiresAt) return fallback || "green";
    const hours = hoursUntil(expiresAt);
    if (hours <= 12) return "red";
    if (hours <= 24) return "yellow";
    return "green";
  }

  function mapProduct(product) {
    const store = product.stores || product.store || {};
    return {
      id: product.id,
      emoji: product.emoji || store.emoji || "🍽️",
      name: product.name,
      store: store.name || "",
      storeId: product.store_id,
      distance: normalizeDistanceKm(product.distance_km ?? product.distance),
      distanceText: product.distance_text || distanceLabel(product.distance_km ?? product.distance),
      price: centsToVnd(product.price_cents),
      original: centsToVnd(product.original_price_cents),
      label: productLabelFromExpiry(product.expires_at, product.label),
      expiresHrs: hoursUntil(product.expires_at),
      stock: Number(product.stock_quantity) || 0,
      cat: product.category || "other",
      rating: Number(product.rating) || 0,
      sold: Number(product.sold_count) || 0,
      desc: product.description || "",
      estimatedWeightKg: Number(product.estimated_weight_kg) || null,
      servingsCount: Number(product.servings_count) || null,
      donation: Boolean(product.is_donation)
    };
  }

  function mapStore(store) {
    return {
      id: store.id,
      name: store.name,
      logo: store.emoji || "🏪",
      addr: store.address || "",
      distance: normalizeDistanceKm(store.distance_km ?? store.distance),
      distanceText: store.distance_text || distanceLabel(store.distance_km ?? store.distance),
      latitude: Number.isFinite(Number(store.latitude)) ? Number(store.latitude) : null,
      longitude: Number.isFinite(Number(store.longitude)) ? Number(store.longitude) : null,
      rating: Number(store.rating) || 0,
      products: 0,
      hours: store.opening_hours || "",
      verified: Boolean(store.is_verified),
      opening: Boolean(store.is_open)
    };
  }

  function mapVoucher(voucher) {
    return {
      code: voucher.code,
      name: voucher.name,
      desc: voucher.description || "",
      expiry: voucher.expires_at ? new Date(voucher.expires_at).toLocaleDateString("vi-VN") : "",
      tag: "green",
      percent: voucher.percent_off,
      fixed: centsToVnd(voucher.fixed_discount_cents),
      min: centsToVnd(voucher.min_order_cents)
    };
  }

  function mapNotification(notification) {
    return {
      id: notification.id,
      type: notification.type || "system",
      icon: "ti-bell",
      title: notification.title,
      desc: notification.body,
      time: notification.created_at ? new Date(notification.created_at).toLocaleString("vi-VN") : "",
      unread: !notification.read_at
    };
  }

  function paymentMethodLabel(method) {
    return {
      momo: "MoMo",
      zalopay: "ZaloPay",
      vnpay: "VNPay",
      card: "Visa/Mastercard",
      vietqr: "VietQR",
      cash: "COD"
    }[method] || method || "";
  }

  function mapUserOrder(order) {
    const items = Array.isArray(order.order_items) ? order.order_items : [];
    return {
      id: order.id,
      code: order.order_number,
      status: order.status,
      store: order.stores && order.stores.name ? order.stores.name : "",
      total: centsToVnd(order.total_cents),
      subtotal: centsToVnd(order.subtotal_cents),
      discount: centsToVnd(order.discount_cents),
      pickup: order.pickup_window,
      payment: paymentMethodLabel(order.payment_method),
      paymentMethod: order.payment_method,
      paymentStatus: order.payment_status,
      created: order.created_at,
      qr: order.qr_code,
      items: items.map((item) => ({
        id: item.product_id,
        name: item.product_name,
        qty: item.quantity,
        price: centsToVnd(item.unit_price_cents)
      }))
    };
  }

  function mapDonation(donation) {
    const store = donation.stores || {};
    const volunteer = donation.volunteers || {};
    return {
      id: donation.id,
      code: donation.donation_code,
      store: store.name || "",
      storeAv: store.name ? store.name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase() : "FS",
      d: "",
      img: store.emoji || "🍱",
      items: donation.items,
      amount: donation.amount_text,
      weight: `${Number(donation.weight_kg) || 0}kg`,
      exp: donation.expires_at ? new Date(donation.expires_at).toLocaleString("vi-VN") : "",
      left: 0,
      urgency: donation.urgency || "green",
      pickupStart: donation.pickup_start ? new Date(donation.pickup_start).toLocaleString("vi-VN") : "",
      pickupEnd: donation.pickup_end ? new Date(donation.pickup_end).toLocaleString("vi-VN") : "",
      time: donation.created_at ? new Date(donation.created_at).toLocaleString("vi-VN") : "",
      status: donation.status === "open" ? "new" : donation.status,
      note: donation.note || "",
      vol: volunteer.full_name || null,
      distance: ""
    };
  }

  function pushNearbyDealNotification(products, location) {
    const deals = (products || [])
      .filter((product) => Number.isFinite(Number(product.distance)) && product.distance <= (location.radiusKm || DEFAULT_NEARBY_RADIUS_KM))
      .filter((product) => product.label === "red" || product.label === "yellow" || (product.original && (1 - product.price / product.original) >= 0.3))
      .slice(0, 3);

    if (!deals.length) return;

    const signature = `${new Date().toISOString().slice(0, 10)}:${deals.map((deal) => deal.id).join(",")}`;
    if (localStorage.getItem(NEARBY_NOTIFICATION_STORAGE_KEY) === signature) return;
    localStorage.setItem(NEARBY_NOTIFICATION_STORAGE_KEY, signature);

    const firstDeal = deals[0];
    const title = `${deals.length} deal FoodSave gần bạn`;
    const body = `${firstDeal.name} tại ${firstDeal.store} · ${firstDeal.distanceText || distanceLabel(firstDeal.distance)} · còn ${firstDeal.expiresHrs} giờ`;

    if (Array.isArray(window.USER_NOTIFS)) {
      window.USER_NOTIFS.unshift({
        id: Date.now(),
        type: "promo",
        icon: "ti-map-pin",
        iconBg: "#dcfce7",
        iconColor: "#16a34a",
        title,
        desc: body,
        time: "Vừa xong",
        unread: true
      });
      if (typeof window.updateNotifBadge === "function") window.updateNotifBadge();
      if (typeof window.renderNotifs === "function") window.renderNotifs("all");
    }

    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(title, {
        body,
        tag: "foodsave-nearby-deal",
        icon: "/favicon.ico"
      });
    }
  }

  async function loadCatalogData(options) {
    const hasLocationOption = options && Object.prototype.hasOwnProperty.call(options, "location");
    const location = hasLocationOption ? options.location : readNearbyLocation();
    const [products, stores, vouchers] = await Promise.all([
      request(catalogPath("/catalog/products", location, { sortNearest: true })).catch(() => ({ items: [] })),
      request(catalogPath("/catalog/stores", location)).catch(() => ({ items: [] })),
      request("/catalog/vouchers").catch(() => [])
    ]);

    const mappedProducts = (products.items || []).map(mapProduct);
    const mappedStores = (stores.items || []).map(mapStore);
    replaceArray("PRODUCTS", mappedProducts);
    replaceArray("STORES", mappedStores);
    replaceArray("VOUCHERS", (Array.isArray(vouchers) ? vouchers : []).map(mapVoucher));
    window.FOODSAVE_NEARBY_LOCATION = location || null;
    window.dispatchEvent(new CustomEvent("foodsave:nearby-location", {
      detail: { location, products: mappedProducts, stores: mappedStores }
    }));
    if (location) pushNearbyDealNotification(mappedProducts, location);

    return {
      products: mappedProducts,
      stores: mappedStores,
      vouchers: Array.isArray(vouchers) ? vouchers : []
    };
  }

  async function loadAuthenticatedData() {
    if (!authToken()) return;

    const [orders, donations, notifications, complaints, impactMe, impactPartner, impactCharity, impactPlatform, leaderboard] = await Promise.all([
      request("/orders?limit=100").catch(() => ({ items: [] })),
      request("/donations?limit=100").catch(() => ({ items: [] })),
      request("/notifications?limit=100").catch(() => ({ items: [] })),
      request("/orders/complaints/list").catch(() => []),
      request("/eco-impact/me?period=all&months=6").catch(() => null),
      request("/eco-impact/partner?period=all&months=6").catch(() => null),
      request("/eco-impact/charity?period=all&months=6").catch(() => null),
      request("/eco-impact/platform?period=all&months=6").catch(() => null),
      request("/eco-impact/leaderboard?period=month&limit=10").catch(() => [])
    ]);

    replaceArray("orders", (orders.items || []).map(mapUserOrder));
    replaceArray("ORD", (orders.items || []));
    replaceArray("DONATIONS", (donations.items || []).map(mapDonation));
    replaceArray("NOTIFS", (notifications.items || []).map(mapNotification));
    replaceArray("COMPLAINTS", Array.isArray(complaints) ? complaints : []);
    window.ECO_IMPACT = {
      me: impactMe,
      partner: impactPartner,
      charity: impactCharity,
      platform: impactPlatform,
      leaderboard: Array.isArray(leaderboard) ? leaderboard : []
    };
  }

  async function hydratePage() {
    await loadCatalogData();
    await loadAuthenticatedData();

    if (typeof window.renderHome === "function" && document.querySelector("#page-home.active")) window.renderHome();
    if (typeof window.renderMarket === "function" && document.querySelector("#page-market.active")) window.renderMarket();
    if (typeof window.renderOrders === "function" && document.querySelector("#page-orders.active")) window.renderOrders("all");
    if (typeof window.R === "function") window.R();
  }

  window.FS = window.FS || {};
  window.FS.sync = {
    source: "backend",
    request,
    hydratePage,
    getNearbyLocation() {
      return readNearbyLocation();
    },
    clearNearbyLocation() {
      clearStoredNearbyLocation();
      return loadCatalogData({ location: null }).then((data) => {
        if (typeof window.renderHome === "function" && document.querySelector("#page-home.active")) window.renderHome();
        if (typeof window.renderMarket === "function" && document.querySelector("#page-market.active")) window.renderMarket();
        if (typeof window.renderMap === "function" && document.querySelector("#page-map.active")) window.renderMap();
        return data;
      });
    },
    async enableNearbyDeals() {
      const location = await browserLocation();
      saveNearbyLocation(location);

      if ("Notification" in window && Notification.permission === "default") {
        await Notification.requestPermission().catch(() => "denied");
      }

      const data = await loadCatalogData({ location });
      if (typeof window.renderHome === "function" && document.querySelector("#page-home.active")) window.renderHome();
      if (typeof window.renderMarket === "function" && document.querySelector("#page-market.active")) window.renderMarket();
      if (typeof window.renderMap === "function" && document.querySelector("#page-map.active")) window.renderMap();
      return data;
    },
    pushOrder(orderPayload) {
      return request("/orders", { method: "POST", body: orderPayload });
    },
    createMomoPayment(orderPayload) {
      return request("/orders/payments/momo", { method: "POST", body: orderPayload });
    },
    refreshMomoPayment(orderId) {
      return request(`/orders/${encodeURIComponent(orderId)}/payments/momo/refresh`, { method: "POST" });
    },
    pollMomoPayment(orderId) {
      return request(`/orders/${encodeURIComponent(orderId)}/payments/momo/status`, { method: "GET" });
    },
    updateOrderPayment(orderId, patch) {
      return updateOrderPayment(orderId, patch);
    },
    markOrderPaymentPending(orderId, paymentMethod) {
      return updateOrderPayment(orderId, {
        payment_method: paymentMethod,
        payment_status: "pending"
      });
    },
    markOrderPaymentPaid(orderId, paymentMethod) {
      return updateOrderPayment(orderId, {
        payment_method: paymentMethod,
        payment_status: "paid",
        status: "confirmed"
      });
    },
    getOrders() {
      return request("/orders?limit=100");
    },
    updateOrderStatus(orderId, status) {
      return request(`/orders/${encodeURIComponent(orderId)}/status`, { method: "PATCH", body: { status } });
    },
    pushDonation(donationPayload) {
      return request("/donations", { method: "POST", body: donationPayload });
    },
    getDonations() {
      return request("/donations?limit=100");
    },
    acceptDonation(donationId, charityId, assignedVolunteerId) {
      return request(`/donations/${encodeURIComponent(donationId)}/accept`, {
        method: "PATCH",
        body: {
          charity_id: charityId,
          ...(assignedVolunteerId ? { assigned_volunteer_id: assignedVolunteerId } : {})
        }
      });
    },
    pushComplaint(complaintPayload) {
      return request("/orders/complaints", { method: "POST", body: complaintPayload });
    },
    getComplaints() {
      return request("/orders/complaints/list");
    },
    getNotifications() {
      return request("/notifications?limit=100");
    },
    getEcoImpactMe(params) {
      return request(`/eco-impact/me${params ? `?${params}` : ""}`);
    },
    getEcoImpactPartner(params) {
      return request(`/eco-impact/partner${params ? `?${params}` : ""}`);
    },
    getEcoImpactCharity(params) {
      return request(`/eco-impact/charity${params ? `?${params}` : ""}`);
    },
    getEcoImpactPlatform(params) {
      return request(`/eco-impact/platform${params ? `?${params}` : ""}`);
    },
    getEcoImpactLeaderboard(params) {
      return request(`/eco-impact/leaderboard${params ? `?${params}` : ""}`);
    },
    markNotifRead(notificationId) {
      return request(`/notifications/${encodeURIComponent(notificationId)}/read`, { method: "PATCH" });
    },
    clearAll() {
      return Promise.resolve(true);
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      void hydratePage();
    });
  } else {
    void hydratePage();
  }
})();
