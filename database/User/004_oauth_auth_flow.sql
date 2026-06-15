alter type public.auth_audit_event add value if not exists 'GOOGLE_OAUTH_STARTED';
alter type public.auth_audit_event add value if not exists 'GOOGLE_OTP_SENT';
alter type public.auth_audit_event add value if not exists 'GOOGLE_OTP_VERIFIED';
alter type public.auth_audit_event add value if not exists 'GOOGLE_OTP_FAILED';
alter type public.auth_audit_event add value if not exists 'FACEBOOK_OAUTH_STARTED';
alter type public.auth_audit_event add value if not exists 'FACEBOOK_OAUTH_COMPLETED';
alter type public.auth_audit_event add value if not exists 'FACEBOOK_OAUTH_FAILED';

create table if not exists public.auth_google_otp_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  email text not null,
  expected_role public.user_role,
  expires_at timestamptz not null,
  verified_at timestamptz,
  consumed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists auth_google_otp_challenges_user_created_idx
on public.auth_google_otp_challenges(user_id, created_at desc);

create index if not exists auth_google_otp_challenges_expires_idx
on public.auth_google_otp_challenges(expires_at);

create index if not exists auth_google_otp_challenges_pending_idx
on public.auth_google_otp_challenges(user_id, expires_at desc)
where verified_at is null;

alter table public.auth_google_otp_challenges enable row level security;

drop policy if exists auth_google_otp_challenges_admin_select on public.auth_google_otp_challenges;
create policy auth_google_otp_challenges_admin_select
on public.auth_google_otp_challenges
for select
using (public.is_admin());

drop policy if exists auth_google_otp_challenges_admin_insert on public.auth_google_otp_challenges;
create policy auth_google_otp_challenges_admin_insert
on public.auth_google_otp_challenges
for insert
with check (public.is_admin());

drop policy if exists auth_google_otp_challenges_admin_update on public.auth_google_otp_challenges;
create policy auth_google_otp_challenges_admin_update
on public.auth_google_otp_challenges
for update
using (public.is_admin())
with check (public.is_admin());

grant select, insert, update on public.auth_google_otp_challenges to authenticated;
