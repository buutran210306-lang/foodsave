create extension if not exists pgcrypto;

do $$
begin
  create type public.auth_audit_event as enum (
    'REGISTER_SUCCESS',
    'LOGIN_SUCCESS',
    'LOGIN_FAILED',
    'LOGOUT',
    'TOKEN_REFRESH',
    'PASSWORD_RESET_REQUESTED'
  );
exception when duplicate_object then null;
end $$;

alter table public.profiles
add column if not exists email text,
add column if not exists auth_provider text not null default 'password',
add column if not exists last_login_at timestamptz,
add column if not exists terms_accepted_at timestamptz,
add column if not exists marketing_opt_in boolean not null default false;

update public.profiles
set email = auth.users.email
from auth.users
where profiles.id = auth.users.id
  and profiles.email is null
  and auth.users.email is not null;

create unique index if not exists profiles_email_lower_unique_idx
on public.profiles (lower(email))
where email is not null;

drop index if exists public.profiles_phone_lookup_idx;

create unique index if not exists profiles_phone_unique_idx
on public.profiles (phone)
where phone is not null;

create index if not exists profiles_last_login_idx
on public.profiles (last_login_at desc)
where last_login_at is not null;

create table if not exists public.auth_audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  role public.user_role,
  event_type public.auth_audit_event not null,
  ip_address text,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists auth_audit_logs_user_created_idx
on public.auth_audit_logs(user_id, created_at desc);

create index if not exists auth_audit_logs_event_created_idx
on public.auth_audit_logs(event_type, created_at desc);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_role public.user_role;
begin
  requested_role := case
    when new.raw_user_meta_data ->> 'role' in ('customer', 'partner', 'charity', 'admin')
      then (new.raw_user_meta_data ->> 'role')::public.user_role
    else 'customer'::public.user_role
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
    case when coalesce((new.raw_user_meta_data ->> 'terms_accepted')::boolean, false) then now() else null end
  )
  on conflict (id) do update
  set role = excluded.role,
      email = excluded.email,
      full_name = coalesce(public.profiles.full_name, excluded.full_name),
      phone = coalesce(public.profiles.phone, excluded.phone),
      avatar_url = coalesce(public.profiles.avatar_url, excluded.avatar_url),
      metadata = public.profiles.metadata || excluded.metadata,
      updated_at = now();

  return new;
end;
$$;

alter table public.auth_audit_logs enable row level security;

drop policy if exists auth_audit_logs_admin_select on public.auth_audit_logs;
create policy auth_audit_logs_admin_select
on public.auth_audit_logs
for select
using (public.is_admin());

drop policy if exists auth_audit_logs_admin_insert on public.auth_audit_logs;
create policy auth_audit_logs_admin_insert
on public.auth_audit_logs
for insert
with check (public.is_admin());

grant select, insert on public.auth_audit_logs to authenticated;
