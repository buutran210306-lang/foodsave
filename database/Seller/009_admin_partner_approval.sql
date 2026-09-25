alter type public.profile_status add value if not exists 'rejected';

alter table public.stores
  add column if not exists rejection_reason text;

alter table public.stores
  add column if not exists reviewed_at timestamptz;

create index if not exists stores_status_review_idx on public.stores(status, reviewed_at);
