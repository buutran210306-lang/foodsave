-- 026: AI Agent đăng bài tổng hợp của FoodSave (Fanpage trung tâm)
-- Chạy SAU file 025. (Bạn tự chạy trong Supabase SQL Editor.)
--   marketing_posts.tier : tầng đã dùng. ai = Gemini viết/tạo ảnh · template = caption mẫu qua n8n · direct = backend đăng trực tiếp
--   marketing_posts.meta : với bài tổng hợp: danh sách món, cửa hàng, nhãn đã đưa vào bài
--   app_settings         : cài đặt chung của hệ thống (ví dụ công tắc bật/tắt AI Agent)

alter table public.marketing_posts
  add column if not exists tier text,
  add column if not exists meta jsonb not null default '{}'::jsonb;

alter table public.marketing_posts drop constraint if exists marketing_posts_tier_check;
alter table public.marketing_posts add constraint marketing_posts_tier_check check (tier is null or tier in ('ai', 'template', 'direct'));

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;
drop policy if exists app_settings_admin_select on public.app_settings;
create policy app_settings_admin_select on public.app_settings for select using (public.is_admin());

insert into public.app_settings (key, value) values ('ai_agent', '{"enabled": true}'::jsonb)
on conflict (key) do nothing;
