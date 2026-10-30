/**
 * Supabase giả chạy trong bộ nhớ, đủ để chạy code thật của các service đơn hàng trong kiểm thử mô phỏng.
 * KHÔNG kết nối mạng, KHÔNG chạm database thật. Chỉ hỗ trợ đúng các kiểu truy vấn mà code đang dùng.
 */
let seq = 0;
const uuid = () => {
  seq += 1;
  return "00000000-0000-4000-8000-" + String(seq).padStart(12, "0");
};

const SYSTEM_WALLETS = [["w-external", "external"], ["w-escrow", "escrow"], ["w-platform", "platform_revenue"], ["w-charity", "charity_pool"]];

class FakeDb {
  constructor() { this.tables = {}; this._chain = Promise.resolve(); this.unique = { payment_events: ["provider", "provider_txn_id"] }; this.failInsert = {}; }
  /** Mô phỏng khóa hàng của Postgres: mỗi "giao dịch" rpc chạy lần lượt, không xen kẽ */
  lock(fn) { const run = this._chain.then(fn, fn); this._chain = run.catch(() => {}); return run; }
  seedSystemWallets() { this.seed("wallets", SYSTEM_WALLETS.map(([id, owner_type]) => ({ id, owner_type, store_id: null, balance_cents: 0 }))); }
  wallet(id) { return this.table("wallets").find((w) => w.id === id); }
  storeWalletId(storeId) {
    let w = this.table("wallets").find((x) => x.store_id === storeId);
    if (!w) { w = { id: "w-store-" + storeId, owner_type: "store", store_id: storeId, balance_cents: 0 }; this.table("wallets").push(w); }
    return w.id;
  }
  postLedger(a) {
    if (!(a.p_amount > 0)) return { data: null, error: { message: "invalid_amount" } };
    if (a.p_from === a.p_to) return { data: null, error: { message: "same_wallet" } };
    const existing = this.table("ledger_entries").find((e) => e.idempotency_key === a.p_key);
    if (existing) return { data: existing, error: null };
    const entry = { id: uuid(), idempotency_key: a.p_key, order_id: a.p_order, entry_type: a.p_type, from_wallet_id: a.p_from, to_wallet_id: a.p_to, amount_cents: a.p_amount, metadata: a.p_meta || {}, created_at: new Date().toISOString() };
    this.table("ledger_entries").push(entry);
    this.wallet(a.p_from).balance_cents -= a.p_amount;
    this.wallet(a.p_to).balance_cents += a.p_amount;
    return { data: entry, error: null };
  }
  rpc(name, a) {
    return this.lock(async () => {
      await Promise.resolve(); // nhường lượt một nhịp để các yêu cầu đồng thời thực sự xen vào hàng đợi
      if (name === "fs_store_wallet") return { data: this.storeWalletId(a.p_store), error: null };
      if (name === "fs_post_ledger") return this.postLedger(a);
      if (name === "fs_submit_payout_account") {
        const rows = this.table("store_payout_accounts");
        rows.filter((r) => r.store_id === a.p_store && ["pending_verification", "verified"].includes(r.status)).forEach((r) => { r.status = "replaced"; });
        const row = { id: uuid(), store_id: a.p_store, bank_name: a.p_bank, account_holder_name: a.p_holder, account_last4: a.p_last4, account_number_encrypted: a.p_cipher, status: "pending_verification", holder_name_match: null, warning: null, admin_note: null, verified_by: null, verified_at: null, created_at: new Date().toISOString() };
        rows.push(row);
        return { data: row, error: null };
      }
      if (name === "fs_decide_payout_account") {
        const r = this.table("store_payout_accounts").find((x) => x.id === a.p_id);
        if (!r) return { data: null, error: { message: "not_found" } };
        const target = a.p_verify ? "verified" : "rejected";
        if (r.status === target) return { data: r, error: null };
        if (r.status !== "pending_verification") return { data: null, error: { message: "invalid_transition" } };
        Object.assign(r, { status: target, admin_note: a.p_note, holder_name_match: a.p_match, warning: a.p_warning, verified_by: a.p_admin, verified_at: new Date().toISOString() });
        return { data: r, error: null };
      }
      if (name === "fs_request_withdrawal") {
        const acc = this.table("store_payout_accounts").find((x) => x.id === a.p_account && x.store_id === a.p_store);
        if (!acc || acc.status !== "verified") return { data: null, error: { message: "account_not_verified" } };
        const w = this.wallet(this.storeWalletId(a.p_store));
        const pending = this.table("withdrawals").filter((x) => x.store_id === a.p_store && ["requested", "approved", "processing"].includes(x.status)).reduce((t, x) => t + x.amount_cents, 0);
        if (a.p_amount > w.balance_cents - pending) return { data: null, error: { message: "insufficient_balance" } };
        const row = { id: uuid(), store_id: a.p_store, amount_cents: a.p_amount, bank_name: acc.bank_name, account_last4: acc.account_last4, payout_account_id: acc.id, status: "requested", requested_at: new Date().toISOString() };
        this.table("withdrawals").push(row);
        return { data: row, error: null };
      }
      if (name === "fs_withdrawal_transition") {
        const r = this.table("withdrawals").find((x) => x.id === a.p_id);
        if (!r) return { data: null, error: { message: "not_found" } };
        const now = new Date().toISOString();
        const bad = () => ({ data: null, error: { message: "invalid_transition" } });
        if (a.p_action === "approve") {
          if (r.status === "approved") return { data: r, error: null };
          if (r.status !== "requested") return bad();
          const acc = r.payout_account_id ? this.table("store_payout_accounts").find((x) => x.id === r.payout_account_id) : null;
          if (acc && ["rejected", "pending_verification"].includes(acc.status)) return { data: null, error: { message: "account_not_verified" } };
          Object.assign(r, { status: "approved", approved_by: a.p_actor, approved_at: now, decided_by: a.p_actor, decided_at: now, admin_note: a.p_note ?? r.admin_note });
        } else if (a.p_action === "reject") {
          if (r.status === "rejected") return { data: r, error: null };
          if (!["requested", "approved"].includes(r.status)) return bad();
          Object.assign(r, { status: "rejected", decided_by: a.p_actor, decided_at: now, admin_note: a.p_note ?? r.admin_note });
        } else if (a.p_action === "start") {
          if (r.status === "processing") return { data: r, error: null };
          if (r.status !== "approved") return bad();
          Object.assign(r, { status: "processing", processing_by: a.p_actor, processing_at: now, payout_ref: a.p_ref ?? r.payout_ref });
        } else if (a.p_action === "pay") {
          if (r.status === "paid") return { data: r, error: null };
          if (!["approved", "processing"].includes(r.status)) return bad();
          if (!a.p_ref || !String(a.p_ref).trim()) return { data: null, error: { message: "ref_required" } };
          const w = this.wallet(this.storeWalletId(r.store_id));
          if (w.balance_cents < r.amount_cents) return { data: null, error: { message: "insufficient_balance" } };
          this.postLedger({ p_key: "withdrawal:" + r.id, p_order: null, p_type: "withdraw", p_from: w.id, p_to: "w-external", p_amount: r.amount_cents, p_meta: { bank_txn_ref: a.p_ref } });
          Object.assign(r, { status: "paid", paid_by: a.p_actor, paid_at: now, bank_txn_ref: a.p_ref });
        } else if (a.p_action === "fail") {
          if (r.status === "failed") return { data: r, error: null };
          if (!["approved", "processing"].includes(r.status)) return bad();
          Object.assign(r, { status: "failed", failed_by: a.p_actor, failed_at: now, failure_reason: a.p_note });
        } else return { data: null, error: { message: "invalid_action" } };
        return { data: r, error: null };
      }
      if (name === "fs_ledger_check") {
        const wallets = this.table("wallets"), entries = this.table("ledger_entries");
        let mismatched = 0;
        for (const w of wallets) {
          const inn = entries.filter((e) => e.to_wallet_id === w.id).reduce((t, e) => t + e.amount_cents, 0);
          const out = entries.filter((e) => e.from_wallet_id === w.id).reduce((t, e) => t + e.amount_cents, 0);
          if (w.balance_cents !== inn - out) mismatched += 1;
        }
        return { data: [{ total_balance: wallets.reduce((t, w) => t + w.balance_cents, 0), mismatched_wallets: mismatched, entry_count: entries.length }], error: null };
      }
      return { data: null, error: { message: "fake-supabase: chưa hỗ trợ rpc " + name } };
    });
  }
  table(name) { if (!this.tables[name]) this.tables[name] = []; return this.tables[name]; }
  seed(name, rows) { rows.forEach((row) => this.table(name).push({ ...row })); }
  from(name) { return new Query(this, name); }
}

const parseOr = (expr) => expr.split(",").map((part) => {
  const [col, op, ...rest] = part.split(".");
  return { col, op, val: rest.join(".") };
});

const matchOne = (row, { col, op, val }) => {
  const v = row[col];
  if (op === "is") return val === "null" ? v === null || v === undefined : String(v) === val;
  if (op === "eq") return String(v) === val;
  if (op === "neq") return String(v) !== val;
  throw new Error("fake-supabase: chưa hỗ trợ or(" + op + ")");
};

class Query {
  constructor(db, name) {
    this.db = db; this.name = name; this.op = "select"; this.filters = []; this.payload = null;
    this.selectCols = "*"; this.countMode = null; this.head = false; this.limitN = null; this.orderBy = null; this.returning = false; this.mode = "many";
  }
  select(cols, opts) {
    if (this.op === "select") this.selectCols = cols || "*";
    else this.returning = true;
    if (opts && opts.count) { this.countMode = opts.count; this.head = !!opts.head; }
    return this;
  }
  insert(rows) { this.op = "insert"; this.payload = Array.isArray(rows) ? rows : [rows]; return this; }
  update(patch) { this.op = "update"; this.payload = patch; return this; }
  delete() { this.op = "delete"; return this; }
  upsert(rows, opts) { this.op = "insert"; this.upsertOn = opts && opts.onConflict; this.payload = Array.isArray(rows) ? rows : [rows]; return this; }
  get(r, col) {
    if (!col.includes(".")) return r[col];
    const [a, b] = col.split(".");
    const embedded = this.withEmbeds(r)[a];
    return embedded ? embedded[b] : undefined;
  }
  eq(col, val) { this.filters.push((r) => String(this.get(r, col)) === String(val)); return this; }
  neq(col, val) { this.filters.push((r) => String(r[col]) !== String(val)); return this; }
  in(col, vals) { this.filters.push((r) => vals.map(String).includes(String(r[col]))); return this; }
  is(col, val) { this.filters.push((r) => (val === null ? r[col] === null || r[col] === undefined : r[col] === val)); return this; }
  not(col, op, val) {
    if (op === "is") this.filters.push((r) => !(val === null ? r[col] === null || r[col] === undefined : r[col] === val));
    else throw new Error("fake-supabase: chưa hỗ trợ not(" + op + ")");
    return this;
  }
  lt(col, val) { this.filters.push((r) => r[col] !== null && r[col] !== undefined && new Date(r[col]).getTime() < new Date(val).getTime()); return this; }
  lte(col, val) { this.filters.push((r) => r[col] !== null && r[col] !== undefined && new Date(r[col]).getTime() <= new Date(val).getTime()); return this; }
  gt(col, val) { this.filters.push((r) => r[col] !== null && r[col] !== undefined && new Date(r[col]).getTime() > new Date(val).getTime()); return this; }
  gte(col, val) { this.filters.push((r) => r[col] !== null && r[col] !== undefined && new Date(r[col]).getTime() >= new Date(val).getTime()); return this; }
  or(expr) { const conds = parseOr(expr); this.filters.push((r) => conds.some((c) => matchOne(r, c))); return this; }
  order(col, opts) { this.orderBy = { col, asc: !opts || opts.ascending !== false }; return this; }
  limit(n) { this.limitN = n; return this; }
  range(from, to) { this.limitN = to - from + 1; return this; }
  single() { this.mode = "single"; return this; }
  maybeSingle() { this.mode = "maybe"; return this; }
  then(resolve, reject) { return Promise.resolve(this.run()).then(resolve, reject); }

  withEmbeds(row) {
    const out = { ...row };
    const cols = String(this.selectCols);
    if (/stores!inner\(/.test(cols) || /\bstores\(/.test(cols)) {
      const store = this.db.table("stores").find((s) => s.id === row.store_id);
      out.stores = store ? { ...store } : null;
    }
    if (/order_items\(/.test(cols)) out.order_items = this.db.table("order_items").filter((i) => i.order_id === row.id);
    if (/profiles!customer_id|customer:profiles/.test(cols)) out.customer = this.db.table("profiles").find((p) => p.id === row.customer_id) || null;
    return out;
  }

  run() {
    const table = this.db.table(this.name);
    const test = (r) => this.filters.every((f) => f(r));
    if (this.op === "insert") {
      if (this.db.failInsert[this.name]) return { data: null, error: { code: "XX000", message: "simulated insert failure" }, count: null };
      const uniq = this.db.unique[this.name];
      if (uniq && this.payload.some((p) => table.some((r) => uniq.every((c) => r[c] === p[c])))) {
        return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" }, count: null };
      }
      const rows = this.payload.map((p) => {
        if (this.upsertOn) {
          const cols = String(this.upsertOn).split(",").map((c) => c.trim());
          const existing = table.find((r) => cols.every((c) => r[c] !== undefined && String(r[c]) === String(p[c])));
          if (existing) { Object.assign(existing, p); return existing; }
        }
        const row = { id: p.id || uuid(), created_at: new Date().toISOString(), ...p };
        if (this.name === "orders") { row.updated_at = row.updated_at || new Date().toISOString(); row.settlement_status = row.settlement_status || "none"; }
        table.push(row);
        return row;
      });
      return this.shape(this.returning ? rows : null, rows.length);
    }
    if (this.op === "update") {
      const hit = table.filter(test);
      hit.forEach((r) => Object.assign(r, this.payload));
      return this.shape(this.returning ? hit : null, hit.length);
    }
    if (this.op === "delete") {
      const hit = table.filter(test);
      hit.forEach((r) => table.splice(table.indexOf(r), 1));
      return this.shape(this.returning ? hit : null, hit.length);
    }
    let rows = table.filter(test);
    if (this.orderBy) {
      const { col, asc } = this.orderBy;
      rows = rows.slice().sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (asc ? 1 : -1));
    }
    if (this.limitN !== null) rows = rows.slice(0, this.limitN);
    if (this.head) return { data: null, error: null, count: rows.length };
    return this.shape(rows.map((r) => this.withEmbeds(r)), rows.length);
  }

  shape(rows, count) {
    const res = (data, error) => ({ data, error, count: this.countMode ? count : null });
    if (rows === null) return res(null, null);
    if (this.mode === "single") {
      if (rows.length !== 1) return res(null, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" });
      return res(rows[0], null);
    }
    if (this.mode === "maybe") return res(rows[0] || null, null);
    return res(rows, null);
  }
}

module.exports = { FakeDb, uuid };
