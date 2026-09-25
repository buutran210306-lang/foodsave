create extension if not exists pgcrypto;

do $$
begin
  create type public.seller_reputation_status as enum ('Active', 'Restricted', 'Banned');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.seller_violation_type as enum (
    'SELLER_CANCELLED_ORDER',
    'MANUAL_REPUTATION_ADJUSTMENT',
    'LOW_RATING_RESTRICTION'
  );
exception when duplicate_object then null;
end $$;

create or replace function public.set_seller_reputation_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.seller_reputation (
  seller_id uuid primary key references public.stores(id) on delete cascade,
  trust_score integer not null default 100 check (trust_score >= 0 and trust_score <= 100),
  rating_avg numeric(3,2) not null default 5.00 check (rating_avg >= 0 and rating_avg <= 5),
  status public.seller_reputation_status not null default 'Active',
  restricted_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint seller_reputation_restricted_until_valid check (
    status <> 'Restricted' or restricted_until is not null
  )
);

create table if not exists public.seller_violations (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.seller_reputation(seller_id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  violation_type public.seller_violation_type not null,
  reason text not null,
  point_delta integer not null,
  trust_score_before integer not null check (trust_score_before >= 0 and trust_score_before <= 100),
  trust_score_after integer not null check (trust_score_after >= 0 and trust_score_after <= 100),
  rating_avg_snapshot numeric(3,2) not null check (rating_avg_snapshot >= 0 and rating_avg_snapshot <= 5),
  status_after public.seller_reputation_status not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists seller_reputation_status_idx
on public.seller_reputation(status);

create index if not exists seller_reputation_restricted_until_idx
on public.seller_reputation(restricted_until)
where restricted_until is not null;

create index if not exists seller_violations_seller_created_idx
on public.seller_violations(seller_id, created_at desc);

create index if not exists seller_violations_order_idx
on public.seller_violations(order_id)
where order_id is not null;

create index if not exists seller_violations_type_created_idx
on public.seller_violations(violation_type, created_at desc);

drop trigger if exists set_seller_reputation_updated_at on public.seller_reputation;
create trigger set_seller_reputation_updated_at
before update on public.seller_reputation
for each row execute function public.set_seller_reputation_updated_at();

insert into public.seller_reputation (seller_id, rating_avg)
select stores.id, stores.rating
from public.stores
on conflict (seller_id) do nothing;

alter table public.seller_reputation enable row level security;
alter table public.seller_violations enable row level security;

drop policy if exists seller_reputation_public_active_select on public.seller_reputation;
create policy seller_reputation_public_active_select
on public.seller_reputation
for select
using (
  status = 'Active'
  or public.owns_store(seller_id)
  or public.is_admin()
);

drop policy if exists seller_reputation_admin_insert on public.seller_reputation;
create policy seller_reputation_admin_insert
on public.seller_reputation
for insert
with check (public.is_admin());

drop policy if exists seller_reputation_admin_update on public.seller_reputation;
create policy seller_reputation_admin_update
on public.seller_reputation
for update
using (public.is_admin())
with check (public.is_admin());

drop policy if exists seller_reputation_admin_delete on public.seller_reputation;
create policy seller_reputation_admin_delete
on public.seller_reputation
for delete
using (public.is_admin());

drop policy if exists seller_violations_owner_or_admin_select on public.seller_violations;
create policy seller_violations_owner_or_admin_select
on public.seller_violations
for select
using (
  public.is_admin()
  or exists (
    select 1
    from public.stores
    where stores.id = seller_violations.seller_id
      and stores.owner_id = auth.uid()
  )
);

drop policy if exists seller_violations_admin_insert on public.seller_violations;
create policy seller_violations_admin_insert
on public.seller_violations
for insert
with check (public.is_admin());

drop policy if exists seller_violations_admin_update on public.seller_violations;
create policy seller_violations_admin_update
on public.seller_violations
for update
using (public.is_admin())
with check (public.is_admin());

drop policy if exists seller_violations_admin_delete on public.seller_violations;
create policy seller_violations_admin_delete
on public.seller_violations
for delete
using (public.is_admin());

grant select on public.seller_reputation to anon;
grant select, insert, update, delete on public.seller_reputation to authenticated;
grant select, insert, update, delete on public.seller_violations to authenticated;
