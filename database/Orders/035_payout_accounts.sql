-- 035: Tài khoản nhận tiền của cửa hàng (số đầy đủ MÃ HÓA ở phía ứng dụng) + vòng đời lệnh rút nhiều bước.
-- Chạy SAU 030 và 034. Chạy lại nhiều lần không lỗi.
--
-- CẦN SAO LƯU TRƯỚC (bảng public.withdrawals bị đổi): vào Supabase → Database → Backups, hoặc chạy trước:
--   create table if not exists public.withdrawals_backup_035 as table public.withdrawals;
--
-- Làm gì:
--  1. Bảng store_payout_accounts (số tài khoản đầy đủ chỉ nằm ở cột account_number_encrypted, đã mã hóa AES-256-GCM bởi backend).
--  2. Bảng payout_access_log: mỗi lần admin xem số đầy đủ để chi trả ghi một dòng (ai, khi nào, lệnh rút nào).
--  3. withdrawals: thêm trạng thái processing / paid / failed và cột người thực hiện + thời gian từng bước.
--     requested → approved → processing → paid   (hoặc rejected / failed). CHỈ khi paid mới trừ ví (bút toán rút); failed thì không mất gì.
--  4. Các lệnh rút cũ đang ở trạng thái 'approved' (đã có bút toán rút trong sổ cái theo cách cũ) được chuyển thành 'paid'.
--  5. Hàm mới: fs_submit_payout_account, fs_decide_payout_account, fs_request_withdrawal (đổi tham số), fs_withdrawal_transition;
--     cập nhật fs_finance_summary. Các hàm cũ fs_decide_withdrawal và fs_request_withdrawal (4 tham số) bị gỡ.
--
-- Quay lại (nếu cần): khôi phục từ withdrawals_backup_035 hoặc từ bản sao lưu, rồi chạy lại phần hàm của 030.

-- ───────── 1. Tài khoản nhận tiền ─────────
create table if not exists public.store_payout_accounts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  bank_name text not null,
  account_holder_name text not null,
  account_last4 text not null check (account_last4 ~ '^[0-9]{4}$'),
  account_number_encrypted text not null,   -- định dạng v1:<iv>:<tag>:<ciphertext>, KHÔNG BAO GIỜ trả ra qua API
  status text not null default 'pending_verification' check (status in ('pending_verification', 'verified', 'rejected', 'replaced')),
  holder_name_match boolean,                -- tên chủ tài khoản có khớp tên đăng ký kinh doanh không (admin duyệt mới có)
  warning text,
  admin_note text,
  verified_by uuid references public.profiles(id),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists payout_accounts_store_idx on public.store_payout_accounts(store_id, created_at desc);
create index if not exists payout_accounts_status_idx on public.store_payout_accounts(status, created_at);
-- Mỗi cửa hàng chỉ có tối đa MỘT tài khoản "hiện hành" (đang chờ duyệt hoặc đã xác minh)
create unique index if not exists payout_accounts_one_current on public.store_payout_accounts(store_id)
  where status in ('pending_verification', 'verified');

create table if not exists public.payout_access_log (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.store_payout_accounts(id) on delete cascade,
  withdrawal_id uuid references public.withdrawals(id) on delete set null,
  admin_id uuid references public.profiles(id),
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists payout_access_log_account_idx on public.payout_access_log(account_id, created_at desc);

-- Không ai đọc trực tiếp từ trình duyệt: bật RLS và KHÔNG tạo policy nào (chỉ service role của Backend truy cập)
alter table public.store_payout_accounts enable row level security;
alter table public.payout_access_log enable row level security;

-- ───────── 2. Vòng đời lệnh rút ─────────
alter table public.withdrawals
  add column if not exists payout_account_id uuid references public.store_payout_accounts(id),
  add column if not exists approved_by uuid references public.profiles(id),
  add column if not exists approved_at timestamptz,
  add column if not exists processing_by uuid references public.profiles(id),
  add column if not exists processing_at timestamptz,
  add column if not exists paid_by uuid references public.profiles(id),
  add column if not exists paid_at timestamptz,
  add column if not exists failed_by uuid references public.profiles(id),
  add column if not exists failed_at timestamptz,
  add column if not exists failure_reason text,
  add column if not exists bank_txn_ref text,
  add column if not exists payout_provider text,
  add column if not exists payout_ref text;

-- Mở rộng ràng buộc trạng thái (xóa ràng buộc cũ theo tên tự đặt rồi tạo lại)
do $$
begin
  alter table public.withdrawals drop constraint if exists withdrawals_status_check;
  alter table public.withdrawals add constraint withdrawals_status_check
    check (status in ('requested', 'approved', 'processing', 'paid', 'rejected', 'failed'));
exception when others then
  raise notice 'Không đổi được ràng buộc trạng thái withdrawals: %', sqlerrm;
  raise;
end $$;

-- Lệnh rút cũ đã "approved" thì tiền ĐÃ bị trừ trong sổ cái → coi như đã chi (paid)
update public.withdrawals w
set status = 'paid',
    paid_at = coalesce(w.decided_at, w.requested_at),
    paid_by = w.decided_by,
    approved_at = coalesce(w.approved_at, w.decided_at),
    approved_by = coalesce(w.approved_by, w.decided_by),
    bank_txn_ref = coalesce(w.bank_txn_ref, 'migrated-from-035')
where w.status = 'approved'
  and exists (select 1 from public.ledger_entries e where e.idempotency_key = 'withdrawal:' || w.id::text);

-- ───────── 3. Hàm ─────────
drop function if exists public.fs_decide_withdrawal(uuid, boolean, uuid, text);
drop function if exists public.fs_request_withdrawal(uuid, bigint, text, text);

-- Cửa hàng gửi tài khoản mới: tài khoản hiện hành cũ chuyển thành 'replaced', tài khoản mới chờ admin xác minh
create or replace function public.fs_submit_payout_account(p_store uuid, p_bank text, p_holder text, p_last4 text, p_cipher text)
returns public.store_payout_accounts
language plpgsql
security definer
set search_path = public
as $$
declare r public.store_payout_accounts;
begin
  perform 1 from public.stores where id = p_store for update;   -- tuần tự hóa các lần gửi của cùng một cửa hàng
  update public.store_payout_accounts set status = 'replaced', updated_at = now()
  where store_id = p_store and status in ('pending_verification', 'verified');
  insert into public.store_payout_accounts(store_id, bank_name, account_holder_name, account_last4, account_number_encrypted)
  values (p_store, p_bank, p_holder, p_last4, p_cipher) returning * into r;
  return r;
end $$;

-- Admin xác minh / từ chối tài khoản (chỉ khi đang chờ duyệt; gọi lại cùng kết quả thì không lỗi)
create or replace function public.fs_decide_payout_account(p_id uuid, p_verify boolean, p_admin uuid, p_note text, p_match boolean, p_warning text)
returns public.store_payout_accounts
language plpgsql
security definer
set search_path = public
as $$
declare r public.store_payout_accounts;
begin
  select * into r from public.store_payout_accounts where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  if r.status = (case when p_verify then 'verified' else 'rejected' end) then return r; end if;
  if r.status <> 'pending_verification' then raise exception 'invalid_transition'; end if;
  update public.store_payout_accounts
  set status = case when p_verify then 'verified' else 'rejected' end,
      admin_note = p_note, holder_name_match = p_match, warning = p_warning,
      verified_by = p_admin, verified_at = now(), updated_at = now()
  where id = p_id returning * into r;
  return r;
end $$;

-- Gửi lệnh rút: khóa ví cửa hàng; tài khoản phải là tài khoản hiện hành và đã 'verified'; số khả dụng = số dư - các lệnh đang giữ chỗ
-- (requested, approved, processing). Hai lệnh gửi cùng lúc không thể cùng vượt số dư.
create or replace function public.fs_request_withdrawal(p_store uuid, p_amount bigint, p_account uuid)
returns public.withdrawals
language plpgsql
security definer
set search_path = public
as $$
declare
  w uuid;
  bal bigint;
  pending bigint;
  acc public.store_payout_accounts;
  r public.withdrawals;
begin
  select * into acc from public.store_payout_accounts where id = p_account and store_id = p_store;
  if not found or acc.status <> 'verified' then raise exception 'account_not_verified'; end if;
  w := public.fs_store_wallet(p_store);
  select balance_cents into bal from public.wallets where id = w for update;
  select coalesce(sum(amount_cents), 0) into pending from public.withdrawals
  where store_id = p_store and status in ('requested', 'approved', 'processing');
  if p_amount > bal - pending then raise exception 'insufficient_balance'; end if;
  insert into public.withdrawals(store_id, amount_cents, bank_name, account_last4, payout_account_id)
  values (p_store, p_amount, acc.bank_name, acc.account_last4, acc.id) returning * into r;
  return r;
end $$;

-- Chuyển trạng thái lệnh rút. p_action: approve | reject | start | pay | fail. Mỗi bước ghi người thực hiện + thời gian.
-- Idempotent: gọi lại bước đã xong trả nguyên lệnh (không trừ tiền lần hai); bước sai thứ tự báo invalid_transition.
-- Chỉ 'pay' mới ghi bút toán rút (ví cửa hàng → external) và cần mã giao dịch ngân hàng (p_ref).
create or replace function public.fs_withdrawal_transition(p_id uuid, p_action text, p_actor uuid, p_note text, p_ref text)
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
  acc_status text;
begin
  select * into r from public.withdrawals where id = p_id for update;
  if not found then raise exception 'not_found'; end if;

  if p_action = 'approve' then
    if r.status = 'approved' then return r; end if;
    if r.status <> 'requested' then raise exception 'invalid_transition'; end if;
    -- Lệnh gửi trước khi có tài khoản mã hóa (payout_account_id null) vẫn duyệt được; lệnh mới thì tài khoản không được bị từ chối / chưa xác minh
    if r.payout_account_id is not null then
      select status into acc_status from public.store_payout_accounts where id = r.payout_account_id;
      if acc_status in ('rejected', 'pending_verification') then raise exception 'account_not_verified'; end if;
    end if;
    update public.withdrawals set status = 'approved', approved_by = p_actor, approved_at = now(),
      decided_by = p_actor, decided_at = now(), admin_note = coalesce(p_note, admin_note)
    where id = p_id returning * into r;

  elsif p_action = 'reject' then
    if r.status = 'rejected' then return r; end if;
    if r.status not in ('requested', 'approved') then raise exception 'invalid_transition'; end if;
    update public.withdrawals set status = 'rejected', decided_by = p_actor, decided_at = now(), admin_note = coalesce(p_note, admin_note)
    where id = p_id returning * into r;

  elsif p_action = 'start' then
    if r.status = 'processing' then return r; end if;
    if r.status <> 'approved' then raise exception 'invalid_transition'; end if;
    update public.withdrawals set status = 'processing', processing_by = p_actor, processing_at = now(),
      payout_ref = coalesce(p_ref, payout_ref), admin_note = coalesce(p_note, admin_note)
    where id = p_id returning * into r;

  elsif p_action = 'pay' then
    if r.status = 'paid' then return r; end if;
    if r.status not in ('approved', 'processing') then raise exception 'invalid_transition'; end if;
    if p_ref is null or btrim(p_ref) = '' then raise exception 'ref_required'; end if;
    w := public.fs_store_wallet(r.store_id);
    select id into ext from public.wallets where owner_type = 'external' and store_id is null;
    perform 1 from public.wallets where id in (w, ext) order by id for update;   -- cùng thứ tự khóa với fs_post_ledger
    select balance_cents into bal from public.wallets where id = w;
    if bal < r.amount_cents then raise exception 'insufficient_balance'; end if;
    perform public.fs_post_ledger('withdrawal:' || r.id::text, null, 'withdraw', w, ext, r.amount_cents,
      jsonb_build_object('withdrawal_id', r.id, 'bank', r.bank_name, 'last4', r.account_last4, 'bank_txn_ref', p_ref));
    update public.withdrawals set status = 'paid', paid_by = p_actor, paid_at = now(), bank_txn_ref = p_ref,
      admin_note = coalesce(p_note, admin_note)
    where id = p_id returning * into r;

  elsif p_action = 'fail' then
    if r.status = 'failed' then return r; end if;
    if r.status not in ('approved', 'processing') then raise exception 'invalid_transition'; end if;
    update public.withdrawals set status = 'failed', failed_by = p_actor, failed_at = now(), failure_reason = p_note
    where id = p_id returning * into r;   -- chưa trừ ví nên số dư khả dụng tự được giải phóng

  else
    raise exception 'invalid_action';
  end if;
  return r;
end $$;

-- Số liệu tổng quan Admin (cập nhật: lệnh đang giữ chỗ = requested/approved/processing; đã rút = paid)
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
    'pending_withdrawals_count', (select count(*) from public.withdrawals where status in ('requested', 'approved', 'processing')),
    'pending_withdrawals_total', (select coalesce(sum(amount_cents), 0) from public.withdrawals where status in ('requested', 'approved', 'processing')),
    'withdrawn_total', (select coalesce(sum(amount_cents), 0) from public.withdrawals where status = 'paid'),
    'accounts_pending', (select count(*) from public.store_payout_accounts where status = 'pending_verification')
  );
$$;

revoke all on function public.fs_submit_payout_account(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.fs_decide_payout_account(uuid, boolean, uuid, text, boolean, text) from public, anon, authenticated;
revoke all on function public.fs_request_withdrawal(uuid, bigint, uuid) from public, anon, authenticated;
revoke all on function public.fs_withdrawal_transition(uuid, text, uuid, text, text) from public, anon, authenticated;
revoke all on function public.fs_finance_summary() from public, anon, authenticated;
grant execute on function public.fs_submit_payout_account(uuid, text, text, text, text) to service_role;
grant execute on function public.fs_decide_payout_account(uuid, boolean, uuid, text, boolean, text) to service_role;
grant execute on function public.fs_request_withdrawal(uuid, bigint, uuid) to service_role;
grant execute on function public.fs_withdrawal_transition(uuid, text, uuid, text, text) to service_role;
grant execute on function public.fs_finance_summary() to service_role;
