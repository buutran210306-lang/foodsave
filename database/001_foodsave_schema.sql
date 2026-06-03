create extension if not exists pgcrypto;

do $$
begin
  create type public.user_role as enum ('customer', 'partner', 'charity', 'admin');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.profile_status as enum ('active', 'pending', 'suspended');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.product_label as enum ('green', 'yellow', 'red');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.order_status as enum ('pending', 'confirmed', 'ready', 'completed', 'cancelled');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.payment_method as enum ('momo', 'zalopay', 'vnpay', 'card', 'cash');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.payment_status as enum ('pending', 'paid', 'refunded', 'failed');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.complaint_priority as enum ('low', 'medium', 'high');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.complaint_status as enum ('open', 'in_review', 'resolved', 'rejected');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.donation_urgency as enum ('green', 'yellow', 'red');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.donation_status as enum ('open', 'accepted', 'in_route', 'completed', 'rejected', 'cancelled');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.volunteer_status as enum ('new', 'active', 'inactive');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.report_status as enum ('draft', 'in_progress', 'published');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.application_type as enum ('partner', 'charity');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.application_status as enum ('pending', 'in_review', 'approved', 'rejected');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.contact_status as enum ('open', 'in_review', 'closed');
exception when duplicate_object then null;
end $$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.user_role not null default 'customer',
  full_name text,
  phone text,
  avatar_url text,
  points integer not null default 0 check (points >= 0),
  rank text not null default 'Đồng',
  status public.profile_status not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.stores (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  slug text not null unique,
  logo_url text,
  emoji text,
  address text not null,
  district text,
  city text not null default 'TP.HCM',
  latitude double precision,
  longitude double precision,
  rating numeric(3,2) not null default 5.00 check (rating >= 0 and rating <= 5),
  commission_rate numeric(5,2) not null default 15.00 check (commission_rate >= 0 and commission_rate <= 100),
  service_tier text not null default 'Starter',
  is_verified boolean not null default false,
  is_open boolean not null default true,
  opening_hours text,
  status public.profile_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null,
  description text not null,
  image_url text,
  emoji text,
  category text not null,
  price_cents integer not null check (price_cents >= 0),
  original_price_cents integer not null check (original_price_cents >= price_cents),
  label public.product_label not null,
  expires_at timestamptz not null,
  stock_quantity integer not null default 0 check (stock_quantity >= 0),
  rating numeric(3,2) not null default 5.00 check (rating >= 0 and rating <= 5),
  sold_count integer not null default 0 check (sold_count >= 0),
  is_donation boolean not null default false,
  is_active boolean not null default true,
  blocked_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vouchers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid references public.stores(id) on delete cascade,
  code text not null unique,
  name text not null,
  description text not null,
  percent_off integer check (percent_off between 1 and 100),
  fixed_discount_cents integer check (fixed_discount_cents > 0),
  min_order_cents integer not null default 0 check (min_order_cents >= 0),
  starts_at timestamptz not null,
  expires_at timestamptz not null,
  max_redemptions integer check (max_redemptions > 0),
  redemption_count integer not null default 0 check (redemption_count >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vouchers_discount_exactly_one check (
    (percent_off is not null and fixed_discount_cents is null)
    or (percent_off is null and fixed_discount_cents is not null)
  ),
  constraint vouchers_valid_time_window check (expires_at > starts_at)
);

create table if not exists public.cart_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  quantity integer not null check (quantity > 0 and quantity <= 99),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, product_id)
);

create table if not exists public.favorite_products (
  user_id uuid not null references public.profiles(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, product_id)
);

create table if not exists public.favorite_stores (
  user_id uuid not null references public.profiles(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, store_id)
);

create table if not exists public.recent_product_views (
  user_id uuid not null references public.profiles(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (user_id, product_id)
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  customer_id uuid not null references public.profiles(id) on delete restrict,
  store_id uuid not null references public.stores(id) on delete restrict,
  status public.order_status not null default 'pending',
  pickup_slot_key text not null,
  pickup_window text not null,
  payment_method public.payment_method not null,
  payment_status public.payment_status not null default 'pending',
  subtotal_cents integer not null check (subtotal_cents >= 0),
  discount_cents integer not null default 0 check (discount_cents >= 0),
  platform_fee_cents integer not null default 0 check (platform_fee_cents >= 0),
  donation_cents integer not null default 0 check (donation_cents >= 0),
  total_cents integer not null check (total_cents >= 0),
  voucher_code text,
  qr_code text not null unique,
  customer_note text,
  cancelled_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  product_name text not null,
  unit_price_cents integer not null check (unit_price_cents >= 0),
  original_unit_price_cents integer not null check (original_unit_price_cents >= unit_price_cents),
  quantity integer not null check (quantity > 0),
  product_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  customer_id uuid not null references public.profiles(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  rating integer not null check (rating between 1 and 5),
  comment text,
  photo_urls text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.complaints (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  customer_id uuid not null references public.profiles(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  product_names text[] not null,
  issue text not null,
  priority public.complaint_priority not null default 'medium',
  status public.complaint_status not null default 'open',
  resolution text,
  image_urls text[] not null default '{}',
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.charity_profiles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  slug text not null unique,
  phone text not null,
  email text not null,
  address text not null,
  district text,
  city text not null default 'TP.HCM',
  beneficiaries_count integer not null default 0 check (beneficiaries_count >= 0),
  rating numeric(3,2) not null default 5.00 check (rating >= 0 and rating <= 5),
  is_open boolean not null default true,
  status public.profile_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.volunteers (
  id uuid primary key default gen_random_uuid(),
  charity_id uuid not null references public.charity_profiles(id) on delete cascade,
  full_name text not null,
  phone text not null,
  email text not null,
  role text not null default 'Tình nguyện viên',
  vehicle text not null,
  zones text[] not null default '{}',
  schedule text not null,
  runs integer not null default 0 check (runs >= 0),
  kg_collected numeric(12,2) not null default 0 check (kg_collected >= 0),
  rating numeric(3,2) not null default 5.00 check (rating >= 0 and rating <= 5),
  status public.volunteer_status not null default 'new',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.donations (
  id uuid primary key default gen_random_uuid(),
  donation_code text not null unique,
  store_id uuid not null references public.stores(id) on delete cascade,
  charity_id uuid references public.charity_profiles(id) on delete set null,
  assigned_volunteer_id uuid references public.volunteers(id) on delete set null,
  items text not null,
  amount_text text not null,
  weight_kg numeric(12,2) not null check (weight_kg > 0),
  expires_at timestamptz not null,
  pickup_start text not null,
  pickup_end text not null,
  urgency public.donation_urgency not null,
  status public.donation_status not null default 'open',
  note text,
  distance_text text,
  accepted_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.beneficiary_groups (
  id uuid primary key default gen_random_uuid(),
  charity_id uuid not null references public.charity_profiles(id) on delete cascade,
  group_name text not null,
  people_count integer not null check (people_count >= 0),
  meals text not null,
  dietary text not null,
  last_fed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.impact_reports (
  id uuid primary key default gen_random_uuid(),
  charity_id uuid not null references public.charity_profiles(id) on delete cascade,
  month_start date not null,
  meals integer not null default 0 check (meals >= 0),
  kg_saved numeric(12,2) not null default 0 check (kg_saved >= 0),
  co2_kg numeric(12,2) not null default 0 check (co2_kg >= 0),
  partners_count integer not null default 0 check (partners_count >= 0),
  donors_count integer not null default 0 check (donors_count >= 0),
  beneficiaries_count integer not null default 0 check (beneficiaries_count >= 0),
  status public.report_status not null default 'draft',
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (charity_id, month_start)
);

create table if not exists public.gallery_items (
  id uuid primary key default gen_random_uuid(),
  charity_id uuid not null references public.charity_profiles(id) on delete cascade,
  donation_id uuid references public.donations(id) on delete set null,
  title text not null,
  image_url text,
  emoji text,
  occurred_on timestamptz not null,
  org_name text not null,
  is_public boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid references public.profiles(id) on delete cascade,
  role_target public.user_role,
  type text not null,
  title text not null,
  body text not null,
  related_type text,
  related_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint notifications_recipient_or_role check (recipient_id is not null or role_target is not null)
);

create table if not exists public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  full_name text not null,
  email text not null,
  phone text,
  subject text not null,
  message text not null,
  status public.contact_status not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  type public.application_type not null,
  org_name text not null,
  contact_name text not null,
  email text not null,
  phone text not null,
  status public.application_status not null default 'pending',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_role_idx on public.profiles(role);
create index if not exists stores_owner_idx on public.stores(owner_id);
create index if not exists stores_status_open_idx on public.stores(status, is_open);
create index if not exists stores_search_idx on public.stores using gin (to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(address, '')));
create index if not exists products_store_idx on public.products(store_id);
create index if not exists products_category_label_idx on public.products(category, label);
create index if not exists products_active_expiry_idx on public.products(is_active, expires_at);
create index if not exists products_search_idx on public.products using gin (to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(description, '')));
create index if not exists vouchers_code_idx on public.vouchers(code);
create index if not exists cart_items_user_idx on public.cart_items(user_id);
create index if not exists recent_product_views_user_viewed_idx on public.recent_product_views(user_id, viewed_at desc);
create index if not exists orders_customer_idx on public.orders(customer_id, created_at desc);
create index if not exists orders_store_status_idx on public.orders(store_id, status, created_at desc);
create index if not exists order_items_order_idx on public.order_items(order_id);
create unique index if not exists reviews_unique_order_store_review_idx on public.reviews(order_id) where product_id is null;
create unique index if not exists reviews_unique_order_product_review_idx on public.reviews(order_id, product_id) where product_id is not null;
create index if not exists complaints_customer_idx on public.complaints(customer_id, created_at desc);
create index if not exists complaints_store_status_idx on public.complaints(store_id, status, created_at desc);
create index if not exists charity_profiles_owner_idx on public.charity_profiles(owner_id);
create index if not exists volunteers_charity_status_idx on public.volunteers(charity_id, status);
create index if not exists donations_store_idx on public.donations(store_id, created_at desc);
create index if not exists donations_charity_status_idx on public.donations(charity_id, status, created_at desc);
create index if not exists donations_open_urgency_idx on public.donations(status, urgency, expires_at);
create index if not exists beneficiary_groups_charity_idx on public.beneficiary_groups(charity_id);
create index if not exists impact_reports_charity_month_idx on public.impact_reports(charity_id, month_start desc);
create index if not exists gallery_items_public_idx on public.gallery_items(is_public, occurred_on desc);
create index if not exists notifications_recipient_unread_idx on public.notifications(recipient_id, read_at, created_at desc);
create index if not exists notifications_role_unread_idx on public.notifications(role_target, read_at, created_at desc);
create index if not exists contact_messages_status_idx on public.contact_messages(status, created_at desc);
create index if not exists applications_type_status_idx on public.applications(type, status, created_at desc);

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();
drop trigger if exists set_stores_updated_at on public.stores;
create trigger set_stores_updated_at before update on public.stores for each row execute function public.set_updated_at();
drop trigger if exists set_products_updated_at on public.products;
create trigger set_products_updated_at before update on public.products for each row execute function public.set_updated_at();
drop trigger if exists set_vouchers_updated_at on public.vouchers;
create trigger set_vouchers_updated_at before update on public.vouchers for each row execute function public.set_updated_at();
drop trigger if exists set_cart_items_updated_at on public.cart_items;
create trigger set_cart_items_updated_at before update on public.cart_items for each row execute function public.set_updated_at();
drop trigger if exists set_orders_updated_at on public.orders;
create trigger set_orders_updated_at before update on public.orders for each row execute function public.set_updated_at();
drop trigger if exists set_reviews_updated_at on public.reviews;
create trigger set_reviews_updated_at before update on public.reviews for each row execute function public.set_updated_at();
drop trigger if exists set_complaints_updated_at on public.complaints;
create trigger set_complaints_updated_at before update on public.complaints for each row execute function public.set_updated_at();
drop trigger if exists set_charity_profiles_updated_at on public.charity_profiles;
create trigger set_charity_profiles_updated_at before update on public.charity_profiles for each row execute function public.set_updated_at();
drop trigger if exists set_volunteers_updated_at on public.volunteers;
create trigger set_volunteers_updated_at before update on public.volunteers for each row execute function public.set_updated_at();
drop trigger if exists set_donations_updated_at on public.donations;
create trigger set_donations_updated_at before update on public.donations for each row execute function public.set_updated_at();
drop trigger if exists set_beneficiary_groups_updated_at on public.beneficiary_groups;
create trigger set_beneficiary_groups_updated_at before update on public.beneficiary_groups for each row execute function public.set_updated_at();
drop trigger if exists set_impact_reports_updated_at on public.impact_reports;
create trigger set_impact_reports_updated_at before update on public.impact_reports for each row execute function public.set_updated_at();
drop trigger if exists set_gallery_items_updated_at on public.gallery_items;
create trigger set_gallery_items_updated_at before update on public.gallery_items for each row execute function public.set_updated_at();
drop trigger if exists set_contact_messages_updated_at on public.contact_messages;
create trigger set_contact_messages_updated_at before update on public.contact_messages for each row execute function public.set_updated_at();
drop trigger if exists set_applications_updated_at on public.applications;
create trigger set_applications_updated_at before update on public.applications for each row execute function public.set_updated_at();

create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_user_role() = 'admin', false)
$$;

create or replace function public.owns_store(store_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.stores
    where stores.id = store_uuid
      and stores.owner_id = auth.uid()
  )
$$;

create or replace function public.owns_charity(charity_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.charity_profiles
    where charity_profiles.id = charity_uuid
      and charity_profiles.owner_id = auth.uid()
  )
$$;

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
  insert into public.profiles (id, role, full_name, phone, avatar_url)
  values (
    new.id,
    requested_role,
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'phone', ''),
    nullif(new.raw_user_meta_data ->> 'avatar_url', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.stores enable row level security;
alter table public.products enable row level security;
alter table public.vouchers enable row level security;
alter table public.cart_items enable row level security;
alter table public.favorite_products enable row level security;
alter table public.favorite_stores enable row level security;
alter table public.recent_product_views enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.reviews enable row level security;
alter table public.complaints enable row level security;
alter table public.charity_profiles enable row level security;
alter table public.volunteers enable row level security;
alter table public.donations enable row level security;
alter table public.beneficiary_groups enable row level security;
alter table public.impact_reports enable row level security;
alter table public.gallery_items enable row level security;
alter table public.notifications enable row level security;
alter table public.contact_messages enable row level security;
alter table public.applications enable row level security;

drop policy if exists profiles_select_self_or_admin on public.profiles;
create policy profiles_select_self_or_admin on public.profiles for select using (id = auth.uid() or public.is_admin());
drop policy if exists profiles_insert_self_or_admin on public.profiles;
create policy profiles_insert_self_or_admin on public.profiles for insert with check (id = auth.uid() or public.is_admin());
drop policy if exists profiles_update_self_or_admin on public.profiles;
create policy profiles_update_self_or_admin on public.profiles for update using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());

drop policy if exists stores_public_select_active on public.stores;
create policy stores_public_select_active on public.stores for select using (status = 'active');
drop policy if exists stores_owner_insert on public.stores;
create policy stores_owner_insert on public.stores for insert with check (owner_id = auth.uid() or public.is_admin());
drop policy if exists stores_owner_update on public.stores;
create policy stores_owner_update on public.stores for update using (owner_id = auth.uid() or public.is_admin()) with check (owner_id = auth.uid() or public.is_admin());
drop policy if exists stores_owner_delete on public.stores;
create policy stores_owner_delete on public.stores for delete using (owner_id = auth.uid() or public.is_admin());

drop policy if exists products_public_select_active on public.products;
create policy products_public_select_active on public.products for select using (
  is_active = true
  and exists (select 1 from public.stores where stores.id = products.store_id and stores.status = 'active')
);
drop policy if exists products_owner_insert on public.products;
create policy products_owner_insert on public.products for insert with check (public.owns_store(store_id) or public.is_admin());
drop policy if exists products_owner_update on public.products;
create policy products_owner_update on public.products for update using (public.owns_store(store_id) or public.is_admin()) with check (public.owns_store(store_id) or public.is_admin());
drop policy if exists products_owner_delete on public.products;
create policy products_owner_delete on public.products for delete using (public.owns_store(store_id) or public.is_admin());

drop policy if exists vouchers_public_select_active on public.vouchers;
create policy vouchers_public_select_active on public.vouchers for select using (
  is_active = true
  and starts_at <= now()
  and expires_at >= now()
);
drop policy if exists vouchers_owner_all on public.vouchers;
create policy vouchers_owner_all on public.vouchers for all using (
  public.is_admin()
  or (store_id is not null and public.owns_store(store_id))
) with check (
  public.is_admin()
  or (store_id is not null and public.owns_store(store_id))
);

drop policy if exists cart_items_user_all on public.cart_items;
create policy cart_items_user_all on public.cart_items for all using (user_id = auth.uid() or public.is_admin()) with check (user_id = auth.uid() or public.is_admin());
drop policy if exists favorite_products_user_all on public.favorite_products;
create policy favorite_products_user_all on public.favorite_products for all using (user_id = auth.uid() or public.is_admin()) with check (user_id = auth.uid() or public.is_admin());
drop policy if exists favorite_stores_user_all on public.favorite_stores;
create policy favorite_stores_user_all on public.favorite_stores for all using (user_id = auth.uid() or public.is_admin()) with check (user_id = auth.uid() or public.is_admin());
drop policy if exists recent_product_views_user_all on public.recent_product_views;
create policy recent_product_views_user_all on public.recent_product_views for all using (user_id = auth.uid() or public.is_admin()) with check (user_id = auth.uid() or public.is_admin());

drop policy if exists orders_customer_store_owner_select on public.orders;
create policy orders_customer_store_owner_select on public.orders for select using (
  customer_id = auth.uid()
  or public.owns_store(store_id)
  or public.is_admin()
);
drop policy if exists orders_customer_insert on public.orders;
create policy orders_customer_insert on public.orders for insert with check (customer_id = auth.uid() or public.is_admin());
drop policy if exists orders_customer_store_owner_update on public.orders;
create policy orders_customer_store_owner_update on public.orders for update using (
  customer_id = auth.uid()
  or public.owns_store(store_id)
  or public.is_admin()
) with check (
  customer_id = auth.uid()
  or public.owns_store(store_id)
  or public.is_admin()
);

drop policy if exists order_items_order_access_select on public.order_items;
create policy order_items_order_access_select on public.order_items for select using (
  exists (
    select 1 from public.orders
    where orders.id = order_items.order_id
      and (orders.customer_id = auth.uid() or public.owns_store(orders.store_id) or public.is_admin())
  )
);
drop policy if exists order_items_customer_insert on public.order_items;
create policy order_items_customer_insert on public.order_items for insert with check (
  exists (
    select 1 from public.orders
    where orders.id = order_items.order_id
      and (orders.customer_id = auth.uid() or public.is_admin())
  )
);

drop policy if exists reviews_public_select on public.reviews;
create policy reviews_public_select on public.reviews for select using (true);
drop policy if exists reviews_customer_insert on public.reviews;
create policy reviews_customer_insert on public.reviews for insert with check (customer_id = auth.uid() or public.is_admin());
drop policy if exists reviews_customer_update on public.reviews;
create policy reviews_customer_update on public.reviews for update using (customer_id = auth.uid() or public.is_admin()) with check (customer_id = auth.uid() or public.is_admin());

drop policy if exists complaints_access_select on public.complaints;
create policy complaints_access_select on public.complaints for select using (
  customer_id = auth.uid()
  or public.owns_store(store_id)
  or public.is_admin()
);
drop policy if exists complaints_customer_insert on public.complaints;
create policy complaints_customer_insert on public.complaints for insert with check (customer_id = auth.uid() or public.is_admin());
drop policy if exists complaints_store_owner_update on public.complaints;
create policy complaints_store_owner_update on public.complaints for update using (public.owns_store(store_id) or public.is_admin()) with check (public.owns_store(store_id) or public.is_admin());

drop policy if exists charity_profiles_public_select_active on public.charity_profiles;
create policy charity_profiles_public_select_active on public.charity_profiles for select using (status = 'active' or owner_id = auth.uid() or public.is_admin());
drop policy if exists charity_profiles_owner_insert on public.charity_profiles;
create policy charity_profiles_owner_insert on public.charity_profiles for insert with check (owner_id = auth.uid() or public.is_admin());
drop policy if exists charity_profiles_owner_update on public.charity_profiles;
create policy charity_profiles_owner_update on public.charity_profiles for update using (owner_id = auth.uid() or public.is_admin()) with check (owner_id = auth.uid() or public.is_admin());
drop policy if exists charity_profiles_owner_delete on public.charity_profiles;
create policy charity_profiles_owner_delete on public.charity_profiles for delete using (owner_id = auth.uid() or public.is_admin());

drop policy if exists volunteers_charity_owner_all on public.volunteers;
create policy volunteers_charity_owner_all on public.volunteers for all using (public.owns_charity(charity_id) or public.is_admin()) with check (public.owns_charity(charity_id) or public.is_admin());

drop policy if exists donations_access_select on public.donations;
create policy donations_access_select on public.donations for select using (
  status = 'open'
  or public.owns_store(store_id)
  or (charity_id is not null and public.owns_charity(charity_id))
  or public.is_admin()
);
drop policy if exists donations_store_owner_insert on public.donations;
create policy donations_store_owner_insert on public.donations for insert with check (public.owns_store(store_id) or public.is_admin());
drop policy if exists donations_store_or_charity_update on public.donations;
create policy donations_store_or_charity_update on public.donations for update using (
  public.owns_store(store_id)
  or status = 'open'
  or (charity_id is not null and public.owns_charity(charity_id))
  or public.is_admin()
) with check (
  public.owns_store(store_id)
  or (charity_id is not null and public.owns_charity(charity_id))
  or public.is_admin()
);
drop policy if exists donations_store_owner_delete on public.donations;
create policy donations_store_owner_delete on public.donations for delete using (public.owns_store(store_id) or public.is_admin());

drop policy if exists beneficiary_groups_charity_owner_all on public.beneficiary_groups;
create policy beneficiary_groups_charity_owner_all on public.beneficiary_groups for all using (public.owns_charity(charity_id) or public.is_admin()) with check (public.owns_charity(charity_id) or public.is_admin());

drop policy if exists impact_reports_public_or_owner_select on public.impact_reports;
create policy impact_reports_public_or_owner_select on public.impact_reports for select using (status = 'published' or public.owns_charity(charity_id) or public.is_admin());
drop policy if exists impact_reports_charity_owner_modify on public.impact_reports;
create policy impact_reports_charity_owner_modify on public.impact_reports for all using (public.owns_charity(charity_id) or public.is_admin()) with check (public.owns_charity(charity_id) or public.is_admin());

drop policy if exists gallery_items_public_or_owner_select on public.gallery_items;
create policy gallery_items_public_or_owner_select on public.gallery_items for select using (is_public = true or public.owns_charity(charity_id) or public.is_admin());
drop policy if exists gallery_items_charity_owner_modify on public.gallery_items;
create policy gallery_items_charity_owner_modify on public.gallery_items for all using (public.owns_charity(charity_id) or public.is_admin()) with check (public.owns_charity(charity_id) or public.is_admin());

drop policy if exists notifications_recipient_select on public.notifications;
create policy notifications_recipient_select on public.notifications for select using (
  recipient_id = auth.uid()
  or role_target = public.current_user_role()
  or public.is_admin()
);
drop policy if exists notifications_recipient_update on public.notifications;
create policy notifications_recipient_update on public.notifications for update using (
  recipient_id = auth.uid()
  or role_target = public.current_user_role()
  or public.is_admin()
) with check (
  recipient_id = auth.uid()
  or role_target = public.current_user_role()
  or public.is_admin()
);

drop policy if exists contact_messages_public_insert on public.contact_messages;
create policy contact_messages_public_insert on public.contact_messages for insert with check (true);
drop policy if exists contact_messages_user_or_admin_select on public.contact_messages;
create policy contact_messages_user_or_admin_select on public.contact_messages for select using (user_id = auth.uid() or public.is_admin());
drop policy if exists contact_messages_admin_update on public.contact_messages;
create policy contact_messages_admin_update on public.contact_messages for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists applications_public_insert on public.applications;
create policy applications_public_insert on public.applications for insert with check (true);
drop policy if exists applications_user_or_admin_select on public.applications;
create policy applications_user_or_admin_select on public.applications for select using (user_id = auth.uid() or public.is_admin());
drop policy if exists applications_admin_update on public.applications;
create policy applications_admin_update on public.applications for update using (public.is_admin()) with check (public.is_admin());

grant usage on schema public to anon, authenticated;
grant select on public.stores, public.products, public.vouchers, public.reviews, public.charity_profiles, public.impact_reports, public.gallery_items to anon;
grant insert on public.contact_messages, public.applications to anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage on all sequences in schema public to authenticated;
