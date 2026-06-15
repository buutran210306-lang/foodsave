-- Allow a logged-in charity account to read its own charity_profiles row.
-- This fixes login flows where Auth succeeds but the frontend receives null/empty
-- charity profile data because SELECT is blocked by Row Level Security.

alter table public.charity_profiles enable row level security;

drop policy if exists charity_profiles_owner_select on public.charity_profiles;
create policy charity_profiles_owner_select
on public.charity_profiles
for select
to authenticated
using (owner_id = auth.uid());

grant select on public.charity_profiles to authenticated;

ALTER TABLE public.charity_profiles ADD COLUMN IF NOT EXISTS metadata JSONB;
ALTER TABLE public.charity_profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;
