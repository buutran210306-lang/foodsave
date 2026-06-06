(function () {
  "use strict";

  const LOCAL_API_BASE_URL = "http://localhost:8080/api/v1";
  const API_PATH = "/api/v1";
  const AUTH_STORAGE_KEY = "foodsave.auth.session";

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
    return Math.max(0, Math.round((new Date(value).getTime() - Date.now()) / 3600000));
  }

  function mapProduct(product) {
    const store = product.stores || product.store || {};
    return {
      id: product.id,
      emoji: product.emoji || store.emoji || "🍽️",
      name: product.name,
      store: store.name || "",
      storeId: product.store_id,
      distance: 0,
      price: centsToVnd(product.price_cents),
      original: centsToVnd(product.original_price_cents),
      label: product.label || "green",
      expiresHrs: hoursUntil(product.expires_at),
      stock: Number(product.stock_quantity) || 0,
      cat: product.category || "other",
      rating: Number(product.rating) || 0,
      sold: Number(product.sold_count) || 0,
      desc: product.description || "",
      donation: Boolean(product.is_donation)
    };
  }

  function mapStore(store) {
    return {
      id: store.id,
      name: store.name,
      logo: store.emoji || "🏪",
      addr: store.address || "",
      distance: 0,
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

  async function loadCatalogData() {
    const [products, stores, vouchers] = await Promise.all([
      request("/catalog/products?limit=100").catch(() => ({ items: [] })),
      request("/catalog/stores?limit=100").catch(() => ({ items: [] })),
      request("/catalog/vouchers").catch(() => [])
    ]);

    replaceArray("PRODUCTS", (products.items || []).map(mapProduct));
    replaceArray("STORES", (stores.items || []).map(mapStore));
    replaceArray("VOUCHERS", (Array.isArray(vouchers) ? vouchers : []).map(mapVoucher));
  }

  async function loadAuthenticatedData() {
    if (!authToken()) return;

    const [orders, donations, notifications, complaints] = await Promise.all([
      request("/orders?limit=100").catch(() => ({ items: [] })),
      request("/donations?limit=100").catch(() => ({ items: [] })),
      request("/notifications?limit=100").catch(() => ({ items: [] })),
      request("/orders/complaints/list").catch(() => [])
    ]);

    replaceArray("orders", (orders.items || []).map(mapUserOrder));
    replaceArray("ORD", (orders.items || []));
    replaceArray("DONATIONS", (donations.items || []).map(mapDonation));
    replaceArray("NOTIFS", (notifications.items || []).map(mapNotification));
    replaceArray("COMPLAINTS", Array.isArray(complaints) ? complaints : []);
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
