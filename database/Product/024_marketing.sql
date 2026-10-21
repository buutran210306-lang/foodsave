-- 024: Marketing Studio (auto-bot đăng bài) cho cửa hàng
-- Chạy SAU file 023.
--   stores.marketing_auto      : cửa hàng bật "Auto-bot": hàng chuyển nhãn vàng/đỏ thì tự gửi lệnh đăng bài
--   stores.facebook_page_id    : mã Fanpage của cửa hàng (n8n dùng để biết đăng lên trang nào)
--   marketing_posts            : nhật ký mỗi lần đẩy khuyến mãi / đăng bài (cũng dùng để không đăng trùng)

alter table public.stores
  add column if not exists marketing_auto boolean not null default false,
  add column if not exists facebook_page_id text,
  add column if not exists facebook_page_name text;

create table if not exists public.marketing_posts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid references public.stores(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  -- buyers = thông báo cho người mua trên FoodSave · facebook/instagram/tiktok = bài đăng mạng xã hội
  channel text not null check (channel in ('buyers', 'facebook', 'instagram', 'tiktok')),
  -- manual = cửa hàng bấm · auto = auto-bot của cửa hàng · central = kênh chung của FoodSave (n8n)
  kind text not null default 'manual' check (kind in ('manual', 'auto', 'central')),
  content text,
  image_url text,
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'posted')),
  external_id text,
  external_url text,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists marketing_posts_store_idx on public.marketing_posts(store_id, created_at desc);
create index if not exists marketing_posts_product_channel_idx on public.marketing_posts(product_id, channel, created_at desc);

alter table public.marketing_posts enable row level security;
drop policy if exists marketing_posts_admin_select on public.marketing_posts;
create policy marketing_posts_admin_select on public.marketing_posts for select using (public.is_admin());
