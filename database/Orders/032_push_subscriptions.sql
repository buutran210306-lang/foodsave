-- 032: Thông báo đẩy (Web Push) cho người mua và tình nguyện viên. Chạy SAU 029. Chạy lại nhiều lần không lỗi.
--
-- Làm gì:
--  1. Bảng push_subscriptions: mỗi thiết bị đã bật thông báo một dòng (endpoint duy nhất). Thuộc về MỘT người mua (user_id)
--     hoặc MỘT tình nguyện viên (volunteer_id). Bật RLS, KHÔNG tạo policy: trình duyệt không đọc được, chỉ Backend (service role).
--  2. Cột donation_assignments.reminder_sent_at: đánh dấu đã nhắc nhiệm vụ cho tình nguyện viên (chống nhắc trùng).
--     Chỉ thêm nếu bảng donation_assignments đã tồn tại (SQL 023); chưa có thì bỏ qua, không lỗi.
-- Quay lại (nếu cần): `drop table if exists public.push_subscriptions;`
--   `alter table public.donation_assignments drop column if exists reminder_sent_at;`
-- Không đổi dữ liệu hiện có.

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_id uuid references public.profiles(id) on delete cascade,
  volunteer_id uuid references public.volunteers(id) on delete cascade,
  role text not null check (role in ('customer', 'volunteer', 'partner', 'admin', 'charity')),
  user_agent text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  constraint push_owner_one check ((user_id is not null) <> (volunteer_id is not null))
);
create index if not exists push_user_idx on public.push_subscriptions(user_id);
create index if not exists push_volunteer_idx on public.push_subscriptions(volunteer_id);

alter table public.push_subscriptions enable row level security;

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'donation_assignments') then
    alter table public.donation_assignments add column if not exists reminder_sent_at timestamptz;
  else
    raise notice 'Chưa có bảng donation_assignments (SQL 023): bỏ qua cột reminder_sent_at. Chạy lại tệp này sau khi chạy 023.';
  end if;
end $$;
