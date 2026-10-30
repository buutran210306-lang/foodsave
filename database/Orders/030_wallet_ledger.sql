-- 030: Sổ cái tiền MÔ PHỎNG (ví hệ thống, ví cửa hàng, bút toán, lệnh rút tiền).
-- Chạy SAU 029. Chạy lại nhiều lần không lỗi. KHÔNG nối cổng thanh toán thật.
-- Mọi thay đổi tiền đi qua hàm fs_post_ledger (idempotent theo idempotency_key, khóa ví theo thứ tự id).
-- Tiền lưu VND nguyên (hậu tố _cents nhưng KHÔNG nhân 100).

create table if not exists public.wallets (
  id uuid primary key default gen_random_uuid(),
  owner_type text not null check (owner_type in ('external','escrow','platform_revenue','charity_pool','store')),
  store_id uuid references public.stores(id) on delete cascade,
  balance_cents bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wallets_store_required check ((owner_type = 'store') = (store_id is not null))
);
create unique index if not exists wallets_system_unique on public.wallets(owner_type) where store_id is null;
create unique index if not exists wallets_store_unique on public.wallets(store_id) where store_id is not null;

-- 4 ví hệ thống (external là đối ứng nên số dư thường âm; tổng mọi ví luôn bằng 0)
insert into public.wallets(owner_type)
select t from unnest(array['external','escrow','platform_revenue','charity_pool']) t
on conflict do nothing;

create table if not exists public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  order_id uuid references public.orders(id) on delete set null,
  entry_type text not null check (entry_type in ('charge','release','refund','refund_clawback','withdraw','adjustment')),
  from_wallet_id uuid not null references public.wallets(id),
  to_wallet_id uuid not null references public.wallets(id),
  amount_cents bigint not null check (amount_cents > 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint ledger_distinct_wallets check (from_wallet_id <> to_wallet_id)
);
create index if not exists ledger_order_idx on public.ledger_entries(order_id);
create index if not exists ledger_created_idx on public.ledger_entries(created_at desc);
create index if not exists ledger_from_idx on public.ledger_entries(from_wallet_id, created_at desc);
create index if not exists ledger_to_idx on public.ledger_entries(to_wallet_id, created_at desc);

create table if not exists public.withdrawals (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  amount_cents bigint not null check (amount_cents >= 50000),
  bank_name text not null,
  account_last4 text not null check (account_last4 ~ '^[0-9]{4}$'),   -- chỉ lưu 4 số cuối, KHÔNG lưu số tài khoản đầy đủ
  status text not null default 'requested' check (status in ('requested','approved','rejected')),
  admin_note text,
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.profiles(id)
);
create index if not exists withdrawals_store_idx on public.withdrawals(store_id, requested_at desc);
create index if not exists withdrawals_status_idx on public.withdrawals(status, requested_at);

-- Đơn đã được đồng bộ vào sổ cái ở trạng thái settlement nào (để tác vụ định kỳ bù bút toán còn thiếu)
alter table public.orders add column if not exists ledger_synced_status text;

alter table public.wallets enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.withdrawals enable row level security;

-- ─────────────────────────────────────────────────────────────
-- Ghi MỘT bút toán và cập nhật số dư trong CÙNG giao dịch.
--  * Khóa hai ví theo thứ tự id (hai yêu cầu đồng thời không bao giờ chờ nhau vòng tròn).
--  * insert ... on conflict (idempotency_key) do nothing: gọi lại cùng key (kể cả đồng thời) thì trả bút toán cũ, không ghi trùng.
-- ─────────────────────────────────────────────────────────────
create or replace function public.fs_post_ledger(
  p_key text, p_order uuid, p_type text, p_from uuid, p_to uuid, p_amount bigint, p_meta jsonb
) returns public.ledger_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  e public.ledger_entries;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid_amount';
  end if;
  if p_from = p_to then
    raise exception 'same_wallet';
  end if;

  perform 1 from public.wallets where id in (p_from, p_to) order by id for update;

  insert into public.ledger_entries(idempotency_key, order_id, entry_type, from_wallet_id, to_wallet_id, amount_cents, metadata)
  values (p_key, p_order, p_type, p_from, p_to, p_amount, coalesce(p_meta, '{}'::jsonb))
  on conflict (idempotency_key) do nothing
  returning * into e;

  if e.id is null then
    select * into e from public.ledger_entries where idempotency_key = p_key;
    return e;
  end if;

  update public.wallets set balance_cents = balance_cents - p_amount, updated_at = now() where id = p_from;
  update public.wallets set balance_cents = balance_cents + p_amount, updated_at = now() where id = p_to;
  return e;
end $$;

-- Ví cửa hàng tạo lười
create or replace function public.fs_store_wallet(p_store uuid) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare w uuid;
begin
  select id into w from public.wallets where store_id = p_store;
  if w is not null then return w; end if;
  insert into public.wallets(owner_type, store_id) values ('store', p_store) on conflict do nothing;
  select id into w from public.wallets where store_id = p_store;
  return w;
end $$;

-- Tạo lệnh rút: khóa ví cửa hàng rồi kiểm tra số dư khả dụng (số dư - các lệnh đang chờ) trong cùng giao dịch,
-- nên hai lệnh gửi cùng lúc không thể cùng vượt số dư.
create or replace function public.fs_request_withdrawal(p_store uuid, p_amount bigint, p_bank text, p_last4 text)
returns public.withdrawals
language plpgsql
security definer
set search_path = public
as $$
declare
  w uuid;
  bal bigint;
  pending bigint;
  r public.withdrawals;
begin
  w := public.fs_store_wallet(p_store);
  select balance_cents into bal from public.wallets where id = w for update;
  select coalesce(sum(amount_cents), 0) into pending from public.withdrawals where store_id = p_store and status = 'requested';
  if p_amount > bal - pending then
    raise exception 'insufficient_balance';
  end if;
  insert into public.withdrawals(store_id, amount_cents, bank_name, account_last4)
  values (p_store, p_amount, p_bank, p_last4) returning * into r;
  return r;
end $$;

-- Admin duyệt / từ chối: khóa lệnh rút, chỉ xử lý khi còn 'requested'; duyệt thì trừ tiền ví cửa hàng đúng một lần.
create or replace function public.fs_decide_withdrawal(p_id uuid, p_approve boolean, p_admin uuid, p_note text)
returns public.withdrawals
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.withdrawals;
  w uuid;
  ext uuid;
  bal bigint;
begin
  select * into r from public.withdrawals where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  if r.status <> 'requested' then raise exception 'already_decided'; end if;

  if p_approve then
    w := public.fs_store_wallet(r.store_id);
    select id into ext from public.wallets where owner_type = 'external' and store_id is null;
    -- Khóa cả hai ví theo thứ tự id (cùng quy tắc với fs_post_ledger) để không bao giờ khóa chéo
    perform 1 from public.wallets where id in (w, ext) order by id for update;
    select balance_cents into bal from public.wallets where id = w;
    if bal < r.amount_cents then raise exception 'insufficient_balance'; end if;
    perform public.fs_post_ledger('withdrawal:' || r.id::text, null, 'withdraw', w, ext, r.amount_cents,
      jsonb_build_object('withdrawal_id', r.id, 'bank', r.bank_name, 'last4', r.account_last4));
  end if;

  update public.withdrawals
  set status = case when p_approve then 'approved' else 'rejected' end,
      admin_note = p_note, decided_at = now(), decided_by = p_admin
  where id = p_id returning * into r;
  return r;
end $$;

-- Đối soát: tổng số dư mọi ví phải bằng 0, và số dư từng ví phải bằng (tổng vào - tổng ra) theo bút toán
create or replace function public.fs_ledger_check()
returns table(total_balance bigint, mismatched_wallets int, entry_count bigint)
language sql
security definer
set search_path = public
as $$
  with flows as (
    select w.id, w.balance_cents,
      coalesce((select sum(amount_cents) from public.ledger_entries where to_wallet_id = w.id), 0)
      - coalesce((select sum(amount_cents) from public.ledger_entries where from_wallet_id = w.id), 0) as computed
    from public.wallets w
  )
  select coalesce(sum(balance_cents), 0)::bigint,
         count(*) filter (where balance_cents <> computed)::int,
         (select count(*) from public.ledger_entries)
  from flows;
$$;

-- Số liệu tổng quan cho trang Admin (tính ngay trong database, không phải kéo hết bút toán về)
create or replace function public.fs_finance_summary()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'wallets', (select coalesce(jsonb_object_agg(owner_type, balance_cents), '{}'::jsonb) from public.wallets where store_id is null),
    'store_wallets_total', (select coalesce(sum(balance_cents), 0) from public.wallets where store_id is not null),
    'refunded_total', (select coalesce(sum(amount_cents), 0) from public.ledger_entries where entry_type in ('refund', 'refund_clawback')),
    'forfeited_total', (select coalesce(sum(amount_cents), 0) from public.ledger_entries
                           where entry_type = 'release' and metadata ->> 'part' = 'store' and metadata ->> 'reason' in ('late_cancel', 'no_show')),
    'released_total', (select coalesce(sum(amount_cents), 0) from public.ledger_entries where entry_type = 'release' and metadata ->> 'part' = 'store'),
    'pending_withdrawals_count', (select count(*) from public.withdrawals where status = 'requested'),
    'pending_withdrawals_total', (select coalesce(sum(amount_cents), 0) from public.withdrawals where status = 'requested'),
    'withdrawn_total', (select coalesce(sum(amount_cents), 0) from public.withdrawals where status = 'approved')
  );
$$;

-- Chỉ Backend (service role) gọi được các hàm này
revoke all on function public.fs_post_ledger(text, uuid, text, uuid, uuid, bigint, jsonb) from public, anon, authenticated;
revoke all on function public.fs_store_wallet(uuid) from public, anon, authenticated;
revoke all on function public.fs_request_withdrawal(uuid, bigint, text, text) from public, anon, authenticated;
revoke all on function public.fs_decide_withdrawal(uuid, boolean, uuid, text) from public, anon, authenticated;
revoke all on function public.fs_ledger_check() from public, anon, authenticated;
revoke all on function public.fs_finance_summary() from public, anon, authenticated;
grant execute on function public.fs_post_ledger(text, uuid, text, uuid, uuid, bigint, jsonb) to service_role;
grant execute on function public.fs_store_wallet(uuid) to service_role;
grant execute on function public.fs_request_withdrawal(uuid, bigint, text, text) to service_role;
grant execute on function public.fs_decide_withdrawal(uuid, boolean, uuid, text) to service_role;
grant execute on function public.fs_ledger_check() to service_role;
grant execute on function public.fs_finance_summary() to service_role;
