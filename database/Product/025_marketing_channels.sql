-- 025: Cài đặt kênh marketing lưu vào hệ thống + bài nhắc + trạng thái "nội dung sẵn sàng"
-- Chạy SAU file 024.
--   stores.marketing_channels : bật/tắt từng kênh và thông tin kết nối (Instagram, TikTok, Zalo, Email...)
--   marketing_posts.variant   : 'main' = bài chính, 'reminder' = bài nhắc 2 giờ cuối
--   marketing_posts.status    : thêm 'ready' = nội dung đã tạo sẵn (kênh chưa tự đăng)

alter table public.stores
  add column if not exists marketing_channels jsonb not null default '{}'::jsonb;

alter table public.marketing_posts
  add column if not exists variant text not null default 'main';

alter table public.marketing_posts drop constraint if exists marketing_posts_variant_check;
alter table public.marketing_posts add constraint marketing_posts_variant_check check (variant in ('main', 'reminder'));

alter table public.marketing_posts drop constraint if exists marketing_posts_channel_check;
alter table public.marketing_posts add constraint marketing_posts_channel_check
  check (channel in ('buyers', 'facebook', 'instagram', 'tiktok', 'zalo', 'email'));

alter table public.marketing_posts drop constraint if exists marketing_posts_status_check;
alter table public.marketing_posts add constraint marketing_posts_status_check
  check (status in ('queued', 'sent', 'failed', 'posted', 'ready'));

create index if not exists marketing_posts_kind_day_idx on public.marketing_posts(kind, channel, created_at desc);
