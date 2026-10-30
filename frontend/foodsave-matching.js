/**
 * Ghép đơn cho trang tổ chức từ thiện (FOODSAVE_CHARITY.html).
 * Mục menu "Ghép đơn": đăng nhu cầu (ví dụ 50 phần bánh), xem tối đa 3 phương án ghép từ nhiều cửa hàng,
 * chọn một phương án để giữ hàng. Chỉ gọi Backend API (/matching/*), không ghi thẳng database.
 * Trang tự làm mới 15 giây một lần và vẽ lại toàn bộ, nên mọi dữ liệu nhập được giữ trong biến MATCH.
 */
(function () {
  "use strict";

  const CATEGORIES = [
    { code: "bakery", label: "Bánh ngọt / bánh tươi" },
    { code: "meal", label: "Bữa ăn / cơm hộp" }
  ];
  const DROP_REASONS = {
    out_of_radius: "Ngoài bán kính phục vụ",
    category_mismatch: "Khác loại hàng",
    expired: "Đã hết hạn",
    infeasible_timing: "Tới lấy không kịp hạn",
    unit_mismatch: "Khác đơn vị",
    no_quantity: "Hết hàng",
    invalid: "Dữ liệu lô không hợp lệ",
    duplicate: "Trùng lô",
    excluded_site: "Cửa hàng bị loại"
  };

  const MATCH = {
    needs: [],
    loaded: false,
    loading: false,
    error: "",
    selectedId: null,
    plans: null, // { needId, plans, dropped, loading, error }
    busy: false,
    form: { title: "", categories: ["bakery"], quantity: "", neededBy: "", note: "" }
  };

  const esc = (value) =>
    typeof window.esc === "function"
      ? window.esc(value)
      : String(value == null ? "" : value).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));

  const api = (path, options) => {
    if (!window.FS || !window.FS.sync || typeof window.FS.sync.request !== "function") {
      return Promise.reject(new Error("Chưa kết nối được máy chủ FoodSave"));
    }
    return window.FS.sync.request(path, options);
  };
  const rerender = () => { if (typeof window.R === "function") window.R(); };
  const toast = (title, text, type) => { if (typeof window.tst === "function") window.tst(esc(title), esc(text), type || "info"); };
  const fmtTime = (iso) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", timeZone: "Asia/Ho_Chi_Minh" });
  };
  const categoryLabel = (code) => (CATEGORIES.find((c) => c.code === code) || { label: code }).label;

  async function loadNeeds() {
    if (MATCH.loading) return;
    MATCH.loading = true;
    try {
      MATCH.needs = await api("/matching/needs");
      MATCH.error = "";
    } catch (error) {
      MATCH.error = (error && error.message) || "Không tải được danh sách nhu cầu";
    }
    MATCH.loading = false;
    MATCH.loaded = true;
    rerender();
  }

  async function loadPlans(needId) {
    MATCH.selectedId = needId;
    MATCH.plans = { needId, plans: [], dropped: [], loading: true, error: "" };
    rerender();
    try {
      const data = await api(`/matching/needs/${encodeURIComponent(needId)}/plans`);
      MATCH.plans = { needId, plans: data.plans || [], dropped: data.dropped || [], loading: false, error: "" };
    } catch (error) {
      MATCH.plans = { needId, plans: [], dropped: [], loading: false, error: (error && error.message) || "Không tính được phương án" };
    }
    rerender();
  }

  const FSMatch = {
    refresh() { MATCH.loaded = false; loadNeeds(); },
    setField(name, value) { MATCH.form[name] = value; },
    toggleCategory(code, checked) {
      const set = new Set(MATCH.form.categories);
      if (checked) set.add(code); else set.delete(code);
      MATCH.form.categories = CATEGORIES.map((c) => c.code).filter((c) => set.has(c));
    },
    async submitNeed() {
      const f = MATCH.form;
      const quantity = Number(f.quantity);
      if (!Number.isInteger(quantity) || quantity < 1) return toast("Thiếu thông tin", "Số phần phải là số nguyên từ 1 trở lên", "urgent");
      if (f.categories.length === 0) return toast("Thiếu thông tin", "Hãy chọn ít nhất một loại hàng", "urgent");
      const neededDate = new Date(f.neededBy);
      if (!f.neededBy || Number.isNaN(neededDate.getTime())) return toast("Thiếu thông tin", "Hãy chọn thời hạn cần hàng", "urgent");
      if (neededDate.getTime() <= Date.now()) return toast("Thời hạn chưa đúng", "Thời hạn cần hàng phải ở tương lai", "urgent");
      const title = f.title.trim() || `Cần ${quantity} phần ${f.categories.map((c) => categoryLabel(c).toLowerCase()).join(" / ")}`;
      MATCH.busy = true; rerender();
      try {
        const body = { title, category_codes: f.categories, quantity, needed_by: neededDate.toISOString() };
        if (f.note.trim()) body.note = f.note.trim();
        const need = await api("/matching/needs", { method: "POST", body });
        MATCH.form = { title: "", categories: f.categories, quantity: "", neededBy: "", note: "" };
        toast("Đã đăng nhu cầu", `${need.quantity} phần, hệ thống đang tìm cửa hàng phù hợp`, "accept");
        MATCH.busy = false;
        MATCH.loaded = false;
        await loadNeeds();
        await loadPlans(need.id);
        return;
      } catch (error) {
        toast("Chưa đăng được nhu cầu", (error && error.message) || "Có lỗi xảy ra", "urgent");
      }
      MATCH.busy = false; rerender();
    },
    viewPlans(needId) { loadPlans(needId); },
    closePlans() { MATCH.selectedId = null; MATCH.plans = null; rerender(); },
    async cancelNeed(needId) {
      if (!window.confirm("Hủy nhu cầu này?")) return;
      try {
        await api(`/matching/needs/${encodeURIComponent(needId)}/cancel`, { method: "POST" });
        if (MATCH.selectedId === needId) { MATCH.selectedId = null; MATCH.plans = null; }
        toast("Đã hủy nhu cầu", "", "info");
        MATCH.loaded = false; await loadNeeds();
      } catch (error) {
        toast("Chưa hủy được", (error && error.message) || "Có lỗi xảy ra", "urgent");
      }
    },
    async reserve(planIndex) {
      if (!MATCH.plans || MATCH.busy) return;
      const plan = MATCH.plans.plans[planIndex];
      if (!plan) return;
      const needId = MATCH.plans.needId;
      MATCH.busy = true; rerender();
      try {
        const result = await api(`/matching/needs/${encodeURIComponent(needId)}/reserve`, { method: "POST", body: { donationIds: plan.donationIds } });
        toast("Đã giữ hàng", `${result.portions} phần ở ${result.reserved} cửa hàng. Chờ cửa hàng xác nhận ở Donation Inbox.`, "accept");
        MATCH.busy = false;
        MATCH.selectedId = null; MATCH.plans = null; MATCH.loaded = false;
        if (window.FS && window.FS.sync && typeof window.FS.sync.hydratePage === "function") window.FS.sync.hydratePage().catch(() => {});
        await loadNeeds();
        return;
      } catch (error) {
        const message = (error && error.message) || "Có lỗi xảy ra";
        MATCH.busy = false;
        if (/tính lại/i.test(message)) {
          toast("Phương án vừa thay đổi", "Một lô vừa được nơi khác nhận, đang tính lại", "info");
          await loadPlans(needId);
          return;
        }
        toast("Chưa giữ được hàng", message, "urgent");
      }
      rerender();
    }
  };

  function needStatusTag(status) {
    if (status === "open") return '<span class="tg tg-y">Đang mở</span>';
    if (status === "matched") return '<span class="tg tg-g">Đã giữ hàng</span>';
    return '<span class="tg" style="background:var(--line-2);color:var(--muted)">Đã hủy</span>';
  }

  function renderForm() {
    const f = MATCH.form;
    return `<div class="card">
      <div class="st"><i class="ti ti-plus"></i> Đăng nhu cầu mới</div>
      <div style="font-size:12.5px;color:var(--muted);font-weight:600;margin-bottom:12px">Ví dụ: cần 50 phần bánh trước 18:00. Không cửa hàng nào đủ một mình, hệ thống sẽ ghép nhiều cửa hàng gần bạn.</div>
      <div class="m12"><label style="font-size:12px;font-weight:800">Loại hàng</label>
        <div class="f g12" style="flex-wrap:wrap;margin-top:6px">${CATEGORIES.map((c) => `<label style="display:flex;align-items:center;gap:6px;font-size:13px;font-weight:700"><input type="checkbox" ${f.categories.includes(c.code) ? "checked" : ""} onchange="FSMatch.toggleCategory('${c.code}',this.checked)"> ${esc(c.label)}</label>`).join("")}</div></div>
      <div class="grid-2 m12">
        <div><label style="font-size:12px;font-weight:800">Số phần cần</label><input class="inp" type="number" min="1" step="1" inputmode="numeric" placeholder="50" value="${esc(f.quantity)}" oninput="FSMatch.setField('quantity',this.value)"></div>
        <div><label style="font-size:12px;font-weight:800">Cần nhận trước</label><input class="inp" type="datetime-local" value="${esc(f.neededBy)}" oninput="FSMatch.setField('neededBy',this.value)"></div>
      </div>
      <div class="m12"><label style="font-size:12px;font-weight:800">Tiêu đề (không bắt buộc)</label><input class="inp" maxlength="120" placeholder="Bữa sáng cho các cụ" value="${esc(f.title)}" oninput="FSMatch.setField('title',this.value)"></div>
      <div class="m12"><label style="font-size:12px;font-weight:800">Ghi chú (không bắt buộc)</label><input class="inp" maxlength="500" value="${esc(f.note)}" oninput="FSMatch.setField('note',this.value)"></div>
      <button class="btn btn-primary" ${MATCH.busy ? "disabled" : ""} onclick="FSMatch.submitNeed()"><i class="ti ti-search"></i> Đăng nhu cầu và tìm phương án ghép</button>
    </div>`;
  }

  function renderNeeds() {
    let body;
    if (!MATCH.loaded) body = '<div style="color:var(--muted);font-weight:700;padding:10px 0">Đang tải...</div>';
    else if (MATCH.error) body = `<div style="color:var(--red);font-weight:700;padding:10px 0">${esc(MATCH.error)}</div>`;
    else if (MATCH.needs.length === 0) body = '<div style="color:var(--muted);font-weight:700;padding:10px 0">Chưa có nhu cầu nào.</div>';
    else {
      body = MATCH.needs.map((n) => `<div class="oc" style="cursor:default;flex-wrap:wrap">
        <div class="f1" style="min-width:200px">
          <div class="f ac g6 m6"><span style="font-size:13.5px;font-weight:900;font-family:'Plus Jakarta Sans'">${esc(n.title)}</span>${needStatusTag(n.status)}</div>
          <div style="font-size:12px;color:var(--ink-soft);font-weight:600">${esc(n.quantity)} phần · ${esc((n.category_codes || []).map(categoryLabel).join(", "))} · cần trước ${esc(fmtTime(n.needed_by))}</div>
        </div>
        ${n.status === "open" ? `<div class="f g8"><button class="btn btn-primary" onclick="FSMatch.viewPlans('${esc(n.id)}')">Xem phương án ghép</button><button class="btn btn-o" onclick="FSMatch.cancelNeed('${esc(n.id)}')">Hủy</button></div>` : ""}
      </div>`).join("");
    }
    return `<div class="card"><div class="f ac jb m12"><div class="st" style="margin:0"><i class="ti ti-list-details"></i> Nhu cầu của tôi</div><button class="btn btn-o" onclick="FSMatch.refresh()"><i class="ti ti-refresh"></i> Làm mới</button></div>${body}</div>`;
  }

  function renderPlan(plan, index) {
    const full = plan.shortfallQty <= 0;
    const stops = (plan.stops || []).map((s) => `<div class="f ac g10" style="padding:8px 0;border-top:1px solid var(--line-2)">
        <div style="width:26px;height:26px;border-radius:50%;background:var(--rose);color:#fff;font-weight:900;font-size:12px;display:flex;align-items:center;justify-content:center;flex-shrink:0">${esc(s.seq)}</div>
        <div class="f1" style="min-width:0"><div style="font-size:13px;font-weight:800">${esc(s.storeName)}</div><div style="font-size:11.5px;color:var(--muted);font-weight:600">${esc(s.address)}</div></div>
        <div style="text-align:right;font-size:12px;font-weight:800;white-space:nowrap">${esc(s.qty)} phần<div style="font-weight:600;color:var(--muted)">tới ~${esc(fmtTime(s.arriveAt))}</div></div>
      </div>`).join("");
    return `<div class="card" style="${index === 0 ? "border:2px solid var(--green-700)" : ""}">
      <div class="f ac jb m10" style="flex-wrap:wrap;gap:8px">
        <div class="f ac g8"><span style="font-family:'Plus Jakarta Sans';font-size:15px;font-weight:900">Phương án ${esc(plan.rank)}</span>${index === 0 ? '<span class="tg tg-g">Đề xuất</span>' : ""}${plan.redLots > 0 ? `<span class="tg tg-r">${esc(plan.redLots)} lô nhãn đỏ</span>` : ""}</div>
        <span class="tg ${full ? "tg-g" : "tg-y"}">${full ? "Đủ" : "Thiếu " + esc(plan.shortfallQty)} · ${esc(plan.coveredQty)}/${esc(plan.requestedQty)} phần</span>
      </div>
      <div style="font-size:12.5px;color:var(--ink-soft);font-weight:700;margin-bottom:6px">${esc(plan.stopCount)} điểm dừng · ~${esc(plan.estDistanceKm)} km · ~${esc(plan.estMinutes)} phút</div>
      ${stops}
      <button class="btn btn-primary" style="margin-top:12px" ${MATCH.busy ? "disabled" : ""} onclick="FSMatch.reserve(${index})"><i class="ti ti-check"></i> Chọn phương án này</button>
    </div>`;
  }

  function renderPlans() {
    const p = MATCH.plans;
    if (!p) return "";
    const need = MATCH.needs.find((n) => n.id === p.needId);
    let body;
    if (p.loading) body = '<div style="color:var(--muted);font-weight:700;padding:10px 0"><i class="ti ti-loader-2"></i> Đang tính phương án...</div>';
    else if (p.error) body = `<div style="color:var(--red);font-weight:700;padding:10px 0">${esc(p.error)}</div>`;
    else if (p.plans.length === 0) body = '<div style="color:var(--muted);font-weight:700;padding:10px 0">Chưa có cửa hàng nào phù hợp lúc này. Hãy thử lại sau hoặc đổi thời hạn / loại hàng.</div>';
    else body = p.plans.map(renderPlan).join("");
    const dropped = (p.dropped || []).length
      ? `<div class="card"><div class="st"><i class="ti ti-filter-off"></i> Lô không được chọn và lý do</div>${p.dropped.map((d) => `<div style="font-size:12.5px;font-weight:600;padding:4px 0;border-top:1px solid var(--line-2)">Lô ${esc(String(d.offerId).slice(0, 8))}: ${esc(DROP_REASONS[d.reason] || d.reason)}</div>`).join("")}</div>`
      : "";
    return `<div class="f ac jb m12"><div class="st" style="margin:0"><i class="ti ti-arrows-join"></i> Phương án ghép${need ? " cho: " + esc(need.title) : ""}</div><button class="btn btn-o" onclick="FSMatch.closePlans()">Đóng</button></div>${body}${dropped}`;
  }

  window.FSMatch = FSMatch;
  window.pMatch = function pMatch() {
    if (!MATCH.loaded && !MATCH.loading) setTimeout(loadNeeds, 0);
    return `<div style="max-width:860px">${renderPlans()}${renderForm()}${renderNeeds()}</div>`;
  };
})();
