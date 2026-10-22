-- FoodSave bản cũ: thêm dữ liệu cho tính năng ghép đơn từ tổ chức đến nhiều cửa hàng.
-- Chạy trong Supabase SQL Editor sau 014_foodsave_partner_charity_refactor.sql.

-- 1) Lô tặng cần biết danh mục và nhóm hạn dùng để ghép đúng loại hàng và tính nhãn Xanh/Vàng/Đỏ
alter table public.donations
  add column if not exists category_code text not null default 'other',
  add column if not exists perishability text not null default 'cooked'
    check (perishability in ('cooked', 'fresh', 'packaged'));

create index if not exists donations_open_category_idx
  on public.donations (category_code, expires_at)
  where status = 'open' and charity_id is null;

-- 2) Nhu cầu của tổ chức: "cần bao nhiêu kg loại gì, trước mấy giờ"
create table if not exists public.charity_needs (
  id uuid primary key default gen_random_uuid(),
  charity_id uuid not null references public.charity_profiles(id) on delete cascade,
  title text not null,
  category_codes text[] not null check (cardinality(category_codes) between 1 and 5),
  quantity_kg numeric(10,2) not null check (quantity_kg > 0),
  needed_by timestamptz not null,
  status text not null default 'open' check (status in ('open', 'matched', 'cancelled', 'completed')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists charity_needs_charity_idx on public.charity_needs (charity_id, status);

alter table public.charity_needs enable row level security;

-- Chủ tổ chức xem và tạo nhu cầu của mình; admin xem tất cả (backend dùng service role nên vẫn kiểm quyền ở service)
drop policy if exists charity_needs_owner_select on public.charity_needs;
create policy charity_needs_owner_select on public.charity_needs
  for select using (
    exists (select 1 from public.charity_profiles c where c.id = charity_id and c.owner_id = auth.uid())
  );

drop policy if exists charity_needs_owner_insert on public.charity_needs;
create policy charity_needs_owner_insert on public.charity_needs
  for insert with check (
    exists (select 1 from public.charity_profiles c where c.id = charity_id and c.owner_id = auth.uid())
  );

-- 3) Giữ hàng nguyên tử: khóa các lô theo thứ tự id, chỉ nhận khi TẤT CẢ còn mở; nếu không thì không nhận lô nào
create or replace function public.reserve_donations_for_need(p_need_id uuid, p_donation_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_charity uuid;
  v_locked int;
begin
  select charity_id into v_charity
  from public.charity_needs
  where id = p_need_id and status = 'open'
  for update;
  if v_charity is null then
    raise exception 'need_not_open';
  end if;

  -- Khóa theo thứ tự id để hai yêu cầu cùng lúc không chờ nhau vòng tròn (deadlock)
  perform 1 from public.donations
  where id = any(p_donation_ids)
  order by id
  for update;

  select count(*) into v_locked
  from public.donations
  where id = any(p_donation_ids)
    and status = 'open'
    and charity_id is null
    and expires_at > now();

  if v_locked <> cardinality(p_donation_ids) then
    raise exception 'not_available';
  end if;

  update public.donations
  set charity_id = v_charity, status = 'accepted', accepted_at = now(), updated_at = now()
  where id = any(p_donation_ids);

  update public.charity_needs
  set status = 'matched', updated_at = now()
  where id = p_need_id;
end;
$$;

revoke all on function public.reserve_donations_for_need(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.reserve_donations_for_need(uuid, uuid[]) to service_role;
