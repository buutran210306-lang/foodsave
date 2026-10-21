// FoodSave Map: bản đồ dùng chung cho các trang (đăng ký cửa hàng, đăng ký tổ chức, bản đồ điều phối, khoảng cách).
// Dữ liệu OpenStreetMap, miễn phí, không cần API key:
//  - Ảnh bản đồ: OpenStreetMap France (nhãn tiếng Việt), lỗi liên tục thì tự chuyển sang Esri.
//  - Tra địa chỉ: Photon (photon.komoot.io).
// Không dùng trực tiếp *.openstreetmap.org vì một số nhà mạng Việt Nam không phân giải được tên miền này.
// Cần nạp Leaflet (leaflet.js + leaflet.css) trước file này.
(function () {
  "use strict";

  const PHOTON_BASE = "https://photon.komoot.io";
  // Giới hạn tìm kiếm trong lãnh thổ Việt Nam (minLon,minLat,maxLon,maxLat)
  const VIETNAM_BBOX = "102.1,8.2,109.5,23.4";
  const DEFAULT_CENTER = { lat: 10.7769, lng: 106.7009 };
  const STATUS_COLORS = { muted: "var(--muted,#6b7280)", ok: "var(--green-800,#166534)", warn: "var(--yellow-600,#ca8a04)", error: "var(--red,#dc2626)" };

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  }

  function validCoordinate(lat, lng) {
    const la = Number(lat);
    const ln = Number(lng);
    return Number.isFinite(la) && Number.isFinite(ln) && Math.abs(la) <= 90 && Math.abs(ln) <= 180 && !(la === 0 && ln === 0);
  }

  // Khoảng cách đường chim bay (km)
  function distanceKm(a, b) {
    if (!a || !b || !validCoordinate(a.lat, a.lng) || !validCoordinate(b.lat, b.lng)) return null;
    const toRad = (deg) => (Number(deg) * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  function formatDistance(km) {
    if (km == null || !Number.isFinite(km)) return "";
    return km < 1 ? `${Math.round(km * 1000)}m` : `${km.toFixed(km < 10 ? 1 : 0)}km`;
  }

  // Đổi kết quả Photon (GeoJSON) thành các trường địa chỉ Việt Nam
  function parsePhotonFeature(feature) {
    const a = feature?.properties || {};
    const [lng, lat] = feature?.geometry?.coordinates || [];
    const road = [a.housenumber, a.street].filter(Boolean).join(" ").trim();
    const street = road || a.name || "";
    const ward = a.district || a.locality || "";
    const district = a.county || "";
    const city = a.state || a.city || "";
    // Điểm có tên riêng (chợ, tòa nhà...) thì giữ tên để dễ nhận ra
    const label = a.name && road && a.name !== road ? `${a.name}, ${road}` : street;
    return {
      formattedAddress: [label, ward, district, city].filter(Boolean).join(", "),
      street,
      ward,
      district,
      city,
      lat: Number(lat),
      lng: Number(lng)
    };
  }

  async function photonRequest(path, params) {
    // lang=default: trả tên gốc tiếng Việt thay vì theo ngôn ngữ trình duyệt (vd "Ben Thanh Market")
    const query = new URLSearchParams({ lang: "default", ...params });
    const response = await fetch(`${PHOTON_BASE}${path}?${query.toString()}`, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Máy chủ bản đồ báo lỗi (${response.status}).`);
    const data = await response.json();
    return Array.isArray(data?.features) ? data.features : [];
  }

  async function searchAddress(query, limit = 5) {
    const features = await photonRequest("/api/", { q: query, limit: String(limit), bbox: VIETNAM_BBOX });
    return features
      .filter((feature) => !feature?.properties?.countrycode || feature.properties.countrycode === "VN")
      .map(parsePhotonFeature);
  }

  async function reverseGeocode(lat, lng) {
    const [feature] = await photonRequest("/reverse", { lat: String(lat), lon: String(lng), limit: "1" });
    return feature ? { ...parsePhotonFeature(feature), lat: Number(lat), lng: Number(lng) } : null;
  }

  function addTileLayer(map) {
    const osmAttribution = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
    const primary = window.L.tileLayer("https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png", {
      maxZoom: 19,
      subdomains: "abc",
      attribution: `${osmAttribution} · OSM France`
    });
    let failures = 0;
    primary.on("tileerror", () => {
      failures += 1;
      if (failures !== 3 || !map.hasLayer(primary)) return;
      map.removeLayer(primary);
      window.L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}", {
        maxZoom: 19,
        attribution: "Tiles &copy; Esri"
      }).addTo(map);
    });
    primary.addTo(map);
  }

  // Tạo bản đồ trong một khung; khung được vẽ lại thì bản đồ cũ trên khung đó bị bỏ
  function createMap(el, options = {}) {
    if (!el || !window.L?.map) return null;
    if (el.__foodsaveMap) {
      el.__foodsaveMap.remove();
      el.__foodsaveMap = null;
    }
    el.innerHTML = "";
    const center = validCoordinate(options.center?.lat, options.center?.lng) ? options.center : DEFAULT_CENTER;
    const map = window.L.map(el, { center: [Number(center.lat), Number(center.lng)], zoom: options.zoom || 13, scrollWheelZoom: false });
    addTileLayer(map);
    el.__foodsaveMap = map;
    // Khung vừa được chèn vào trang: tính lại kích thước để không vỡ ô bản đồ
    window.setTimeout(() => map.invalidateSize(), 120);
    return map;
  }

  function currentPosition() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("Trình duyệt không hỗ trợ định vị. Vui lòng nhập địa chỉ hoặc bấm lên bản đồ."));
        return;
      }
      if (!window.isSecureContext) {
        reject(new Error("Định vị chỉ chạy trên trang HTTPS hoặc localhost. Vui lòng nhập địa chỉ hoặc bấm lên bản đồ."));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (position) => resolve(position.coords),
        (error) => {
          const messages = {
            1: "Bạn đã chặn quyền vị trí. Bật lại trong cài đặt trình duyệt (biểu tượng ổ khóa cạnh thanh địa chỉ), hoặc nhập địa chỉ tay.",
            2: "Không xác định được vị trí hiện tại. Vui lòng nhập địa chỉ hoặc bấm lên bản đồ.",
            3: "Lấy vị trí quá lâu. Vui lòng thử lại hoặc nhập địa chỉ tay."
          };
          reject(new Error(messages[error?.code] || messages[2]));
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
      );
    });
  }

  /**
   * Gắn bộ chọn vị trí: bản đồ + ô địa chỉ + nút Tìm / Vị trí hiện tại + ghim kéo được.
   * options: { mapEl, input, results, status, locateButton, initial: {lat,lng}, onChange(place), beforeSearch() }
   * onChange nhận { formattedAddress?, street?, ward?, district?, city?, lat, lng } mỗi khi vị trí thay đổi.
   */
  function attachPicker(options) {
    const { mapEl, input, results, status, locateButton } = options;
    const onChange = typeof options.onChange === "function" ? options.onChange : () => {};
    let marker = null;
    let busy = false;
    let lastResults = [];

    const setStatus = (message, tone = "muted") => {
      if (!status) return;
      status.style.color = STATUS_COLORS[tone] || STATUS_COLORS.muted;
      status.textContent = message || "";
    };

    if (!window.L?.map) {
      if (mapEl) mapEl.innerHTML = '<div style="padding:16px;color:var(--muted);font-size:12px;font-weight:800">Chưa tải được bản đồ. Bạn vẫn có thể nhập địa chỉ tay.</div>';
      return { search() {}, locate() {}, choose() {}, destroy() {} };
    }

    const initial = options.initial || {};
    const hasPin = validCoordinate(initial.lat, initial.lng);
    const map = createMap(mapEl, { center: hasPin ? initial : DEFAULT_CENTER, zoom: hasPin ? 17 : 13 });

    const placePin = (lat, lng, zoom) => {
      if (!validCoordinate(lat, lng)) return;
      const point = [Number(lat), Number(lng)];
      if (marker) marker.setLatLng(point);
      else {
        marker = window.L.marker(point, { draggable: true }).addTo(map);
        marker.on("dragend", () => {
          const pos = marker.getLatLng();
          void setFromPoint(pos.lat, pos.lng);
        });
      }
      map.setView(point, zoom || Math.max(map.getZoom(), 17));
    };

    const applyPlace = (place) => {
      if (input && place.formattedAddress) input.value = place.formattedAddress;
      placePin(place.lat, place.lng);
      if (results) results.innerHTML = "";
      onChange(place);
    };

    // Ghim tại một điểm (bấm bản đồ, kéo ghim, vị trí hiện tại) rồi tra ngược ra địa chỉ
    const setFromPoint = async (lat, lng) => {
      placePin(lat, lng);
      onChange({ lat: Number(lat), lng: Number(lng) });
      if (busy) return;
      busy = true;
      setStatus("Đang tìm địa chỉ tại vị trí đã ghim...");
      try {
        const place = await reverseGeocode(lat, lng);
        if (place) {
          applyPlace(place);
          setStatus("Đã ghim vị trí. Kiểm tra lại địa chỉ, có thể sửa tay hoặc kéo ghim cho chính xác.", "ok");
        } else {
          setStatus("Đã ghim vị trí. Chưa tìm được tên đường tại điểm này, vui lòng nhập địa chỉ tay.", "warn");
        }
      } catch (error) {
        setStatus("Đã ghim vị trí. Không tra được địa chỉ (mất kết nối?), vui lòng nhập địa chỉ tay.", "warn");
      } finally {
        busy = false;
      }
    };

    const choose = (index) => {
      const place = lastResults[index];
      if (!place) return;
      applyPlace(place);
      setStatus("Đã ghim vị trí. Có thể kéo ghim cho chính xác.", "ok");
    };

    const search = async () => {
      const query = String(input?.value || "").trim();
      if (query.length < 4) {
        setStatus("Nhập địa chỉ cụ thể hơn (số nhà, đường, phường, tỉnh/thành) rồi bấm Tìm.", "warn");
        return;
      }
      if (busy) return;
      busy = true;
      if (typeof options.beforeSearch === "function") options.beforeSearch();
      setStatus("Đang tìm địa chỉ trên bản đồ...");
      try {
        lastResults = await searchAddress(query, 5);
        if (lastResults.length === 0) {
          if (results) results.innerHTML = "";
          setStatus("Không tìm thấy địa chỉ này. Thử ghi rõ hơn, hoặc bấm trực tiếp lên bản đồ để ghim vị trí.", "warn");
          return;
        }
        if (lastResults.length === 1) {
          choose(0);
          return;
        }
        if (results) {
          results.innerHTML = lastResults.map((place, index) => `<button type="button" class="seller-address-option" data-index="${index}"><i class="ti ti-map-pin"></i> ${escapeHtml(place.formattedAddress)}</button>`).join("");
          results.querySelectorAll("[data-index]").forEach((button) => {
            button.addEventListener("click", () => choose(Number(button.getAttribute("data-index"))));
          });
        }
        placePin(lastResults[0].lat, lastResults[0].lng, 16);
        setStatus(`Tìm thấy ${lastResults.length} kết quả, chọn đúng địa chỉ bên dưới.`, "ok");
      } catch (error) {
        setStatus("Không kết nối được máy chủ bản đồ. Bạn vẫn có thể bấm lên bản đồ để ghim vị trí.", "error");
      } finally {
        busy = false;
      }
    };

    const locate = async () => {
      if (locateButton) locateButton.disabled = true;
      setStatus("Đang lấy vị trí hiện tại... Hãy bấm Cho phép nếu trình duyệt hỏi quyền vị trí.");
      try {
        const coords = await currentPosition();
        await setFromPoint(coords.latitude, coords.longitude);
        if (coords.accuracy > 200) setStatus(`Vị trí chỉ chính xác khoảng ${Math.round(coords.accuracy)}m. Hãy kéo ghim tới đúng địa điểm.`, "warn");
      } catch (error) {
        setStatus(error.message, "error");
      } finally {
        if (locateButton) locateButton.disabled = false;
      }
    };

    if (hasPin) placePin(initial.lat, initial.lng, 17);
    map.on("click", (event) => { void setFromPoint(event.latlng.lat, event.latlng.lng); });
    setStatus(hasPin
      ? "Vị trí đã được ghim. Kéo ghim nếu cần chỉnh."
      : "Bấm \"Vị trí hiện tại\", gõ địa chỉ rồi bấm Tìm, hoặc bấm trực tiếp lên bản đồ để ghim vị trí.");

    return {
      map,
      search,
      locate,
      choose,
      destroy() {
        if (mapEl?.__foodsaveMap === map) {
          map.remove();
          mapEl.__foodsaveMap = null;
        }
      }
    };
  }

  window.FoodSaveMap = {
    DEFAULT_CENTER,
    validCoordinate,
    distanceKm,
    formatDistance,
    searchAddress,
    reverseGeocode,
    createMap,
    addTileLayer,
    currentPosition,
    attachPicker
  };
})();
