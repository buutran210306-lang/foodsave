create extension if not exists pgcrypto;

alter table public.stores
add column if not exists description text,
add column if not exists hashtags text[] not null default '{}',
add column if not exists public_hotline text,
add column if not exists legal_name text,
add column if not exists tax_code text,
add column if not exists onboarding_status public.profile_status not null default 'pending';

create table if not exists public.customer_profiles (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  email text,
  phone text,
  display_name text,
  date_of_birth text,
  gender text,
  referral_code text,
  marketing_opt_in boolean not null default false,
  last_login_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.partner_profiles (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  store_id uuid unique references public.stores(id) on delete set null,
  email text,
  phone text,
  representative_name text,
  representative_title text,
  cccd_number text,
  legal_name text,
  tax_code text,
  business_license_number text,
  business_type text not null default 'other',
  public_hotline text,
  admin_email text,
  admin_phone text,
  bank_name text,
  bank_account_number text,
  bank_account_holder text,
  documents jsonb not null default '{}'::jsonb,
  opening_schedule jsonb not null default '[]'::jsonb,
  automation jsonb not null default '{"dynamicPricing": true, "charityTransfer": true}'::jsonb,
  onboarding_status public.profile_status not null default 'pending',
  terms_accepted_at timestamptz,
  last_login_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists customer_profiles_email_lower_unique_idx
on public.customer_profiles (lower(email))
where email is not null;

create unique index if not exists customer_profiles_phone_unique_idx
on public.customer_profiles (phone)
where phone is not null;

create unique index if not exists partner_profiles_email_lower_unique_idx
on public.partner_profiles (lower(email))
where email is not null;

create index if not exists partner_profiles_phone_idx
on public.partner_profiles (phone)
where phone is not null;

create index if not exists partner_profiles_admin_phone_idx
on public.partner_profiles (admin_phone)
where admin_phone is not null;

create index if not exists partner_profiles_store_idx
on public.partner_profiles (store_id)
where store_id is not null;

drop trigger if exists set_customer_profiles_updated_at on public.customer_profiles;
create trigger set_customer_profiles_updated_at
before update on public.customer_profiles
for each row execute function public.set_updated_at();

drop trigger if exists set_partner_profiles_updated_at on public.partner_profiles;
create trigger set_partner_profiles_updated_at
before update on public.partner_profiles
for each row execute function public.set_updated_at();

insert into public.customer_profiles (
  profile_id,
  email,
  phone,
  display_name,
  date_of_birth,
  gender,
  referral_code,
  marketing_opt_in,
  last_login_at,
  metadata,
  created_at,
  updated_at
)
select
  id,
  email,
  phone,
  full_name,
  metadata ->> 'date_of_birth',
  metadata ->> 'gender',
  metadata ->> 'referral_code',
  marketing_opt_in,
  last_login_at,
  metadata,
  created_at,
  updated_at
from public.profiles
where role = 'customer'
on conflict (profile_id) do update
set email = excluded.email,
    phone = excluded.phone,
    display_name = coalesce(public.customer_profiles.display_name, excluded.display_name),
    marketing_opt_in = excluded.marketing_opt_in,
    last_login_at = excluded.last_login_at,
    metadata = public.customer_profiles.metadata || excluded.metadata,
    updated_at = now();

with first_stores as (
  select distinct on (owner_id) *
  from public.stores
  order by owner_id, created_at asc
)
insert into public.partner_profiles (
  profile_id,
  store_id,
  email,
  phone,
  representative_name,
  legal_name,
  tax_code,
  business_license_number,
  business_type,
  public_hotline,
  admin_email,
  admin_phone,
  bank_name,
  bank_account_number,
  bank_account_holder,
  onboarding_status,
  terms_accepted_at,
  last_login_at,
  metadata,
  created_at,
  updated_at
)
select
  p.id,
  s.id,
  p.email,
  p.phone,
  p.full_name,
  coalesce(s.legal_name, p.metadata ->> 'legal_name'),
  coalesce(s.tax_code, p.metadata ->> 'tax_code'),
  p.metadata ->> 'business_license_number',
  coalesce(p.metadata ->> 'business_type', 'other'),
  coalesce(s.public_hotline, p.phone),
  p.email,
  p.phone,
  p.metadata ->> 'bank_name',
  p.metadata ->> 'bank_account_number',
  p.metadata ->> 'bank_account_holder',
  p.status,
  p.terms_accepted_at,
  p.last_login_at,
  p.metadata,
  p.created_at,
  p.updated_at
from public.profiles p
left join first_stores s on s.owner_id = p.id
where p.role = 'partner'
on conflict (profile_id) do update
set store_id = coalesce(public.partner_profiles.store_id, excluded.store_id),
    email = excluded.email,
    phone = excluded.phone,
    representative_name = coalesce(public.partner_profiles.representative_name, excluded.representative_name),
    legal_name = coalesce(public.partner_profiles.legal_name, excluded.legal_name),
    tax_code = coalesce(public.partner_profiles.tax_code, excluded.tax_code),
    business_license_number = coalesce(public.partner_profiles.business_license_number, excluded.business_license_number),
    business_type = excluded.business_type,
    public_hotline = coalesce(public.partner_profiles.public_hotline, excluded.public_hotline),
    admin_email = coalesce(public.partner_profiles.admin_email, excluded.admin_email),
    admin_phone = coalesce(public.partner_profiles.admin_phone, excluded.admin_phone),
    bank_name = coalesce(public.partner_profiles.bank_name, excluded.bank_name),
    bank_account_number = coalesce(public.partner_profiles.bank_account_number, excluded.bank_account_number),
    bank_account_holder = coalesce(public.partner_profiles.bank_account_holder, excluded.bank_account_holder),
    onboarding_status = excluded.onboarding_status,
    terms_accepted_at = coalesce(public.partner_profiles.terms_accepted_at, excluded.terms_accepted_at),
    last_login_at = excluded.last_login_at,
    metadata = public.partner_profiles.metadata || excluded.metadata,
    updated_at = now();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_role public.user_role;
  accepted_at timestamptz;
begin
  requested_role := case
    when new.raw_user_meta_data ->> 'role' in ('customer', 'partner', 'charity', 'admin')
      then (new.raw_user_meta_data ->> 'role')::public.user_role
    else 'customer'::public.user_role
  end;

  accepted_at := case
    when coalesce((new.raw_user_meta_data ->> 'terms_accepted')::boolean, false) then now()
    else null
  end;

  insert into public.profiles (
    id,
    role,
    email,
    full_name,
    phone,
    avatar_url,
    status,
    metadata,
    terms_accepted_at
  )
  values (
    new.id,
    requested_role,
    lower(nullif(new.email, '')),
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'phone', ''),
    nullif(new.raw_user_meta_data ->> 'avatar_url', ''),
    case when requested_role in ('partner', 'charity') then 'pending'::public.profile_status else 'active'::public.profile_status end,
    coalesce(new.raw_user_meta_data, '{}'::jsonb),
    accepted_at
  )
  on conflict (id) do update
  set role = excluded.role,
      email = excluded.email,
      full_name = coalesce(public.profiles.full_name, excluded.full_name),
      phone = coalesce(public.profiles.phone, excluded.phone),
      avatar_url = coalesce(public.profiles.avatar_url, excluded.avatar_url),
      metadata = public.profiles.metadata || excluded.metadata,
      updated_at = now();

  if requested_role = 'customer' then
    insert into public.customer_profiles (
      profile_id,
      email,
      phone,
      display_name,
      marketing_opt_in,
      metadata
    )
    values (
      new.id,
      lower(nullif(new.email, '')),
      nullif(new.raw_user_meta_data ->> 'phone', ''),
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      coalesce((new.raw_user_meta_data ->> 'marketing_opt_in')::boolean, false),
      coalesce(new.raw_user_meta_data, '{}'::jsonb)
    )
    on conflict (profile_id) do update
    set email = excluded.email,
        phone = coalesce(public.customer_profiles.phone, excluded.phone),
        display_name = coalesce(public.customer_profiles.display_name, excluded.display_name),
        metadata = public.customer_profiles.metadata || excluded.metadata,
        updated_at = now();
  elsif requested_role = 'partner' then
    insert into public.partner_profiles (
      profile_id,
      email,
      phone,
      representative_name,
      business_type,
      admin_email,
      admin_phone,
      terms_accepted_at,
      metadata
    )
    values (
      new.id,
      lower(nullif(new.email, '')),
      nullif(new.raw_user_meta_data ->> 'phone', ''),
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      coalesce(nullif(new.raw_user_meta_data ->> 'business_type', ''), 'other'),
      lower(nullif(new.email, '')),
      nullif(new.raw_user_meta_data ->> 'phone', ''),
      accepted_at,
      coalesce(new.raw_user_meta_data, '{}'::jsonb)
    )
    on conflict (profile_id) do update
    set email = excluded.email,
        phone = coalesce(public.partner_profiles.phone, excluded.phone),
        representative_name = coalesce(public.partner_profiles.representative_name, excluded.representative_name),
        business_type = excluded.business_type,
        admin_email = coalesce(public.partner_profiles.admin_email, excluded.admin_email),
        admin_phone = coalesce(public.partner_profiles.admin_phone, excluded.admin_phone),
        metadata = public.partner_profiles.metadata || excluded.metadata,
        updated_at = now();
  end if;

  return new;
end;
$$;

alter table public.customer_profiles enable row level security;
alter table public.partner_profiles enable row level security;

drop policy if exists customer_profiles_self_select on public.customer_profiles;
create policy customer_profiles_self_select
on public.customer_profiles
for select
using (profile_id = auth.uid() or public.is_admin());

drop policy if exists customer_profiles_self_insert on public.customer_profiles;
create policy customer_profiles_self_insert
on public.customer_profiles
for insert
with check (profile_id = auth.uid() or public.is_admin());

drop policy if exists customer_profiles_self_update on public.customer_profiles;
create policy customer_profiles_self_update
on public.customer_profiles
for update
using (profile_id = auth.uid() or public.is_admin())
with check (profile_id = auth.uid() or public.is_admin());

drop policy if exists partner_profiles_owner_select on public.partner_profiles;
create policy partner_profiles_owner_select
on public.partner_profiles
for select
using (profile_id = auth.uid() or public.is_admin());

drop policy if exists partner_profiles_owner_insert on public.partner_profiles;
create policy partner_profiles_owner_insert
on public.partner_profiles
for insert
with check (profile_id = auth.uid() or public.is_admin());

drop policy if exists partner_profiles_owner_update on public.partner_profiles;
create policy partner_profiles_owner_update
on public.partner_profiles
for update
using (profile_id = auth.uid() or public.is_admin())
with check (profile_id = auth.uid() or public.is_admin());

grant select, insert, update on public.customer_profiles to authenticated;
grant select, insert, update on public.partner_profiles to authenticated;
