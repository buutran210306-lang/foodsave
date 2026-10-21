-- 016: Nhãn theo 3 nhóm hàng, giá cố định theo nhãn, giờ đóng cửa, hàng đỏ tự chuyển từ thiện, thông báo
-- Chạy SAU file 014, 015.
--
-- Quy ước tiền: các cột *_cents lưu THẲNG số tiền VND (65.000đ lưu là 65000).

-- 1. Nhóm hàng quyết định ngưỡng nhãn
--    cooked   = đồ nấu chín, bánh tươi   (xanh > 12h, vàng 4-12h, đỏ < 4h)
--    fresh    = rau củ, trái cây, thịt cá, sữa tươi (xanh > 72h, vàng 24-72h, đỏ < 24h)
--    packaged = đồ đóng gói               (xanh > 7 ngày, vàng 3-7 ngày, đỏ < 3 ngày)
do $$
begin
  create type public.food_group as enum ('cooked', 'fresh', 'packaged');
exception when duplicate_object then null;
end $$;

alter table public.products
  add column if not exists food_group public.food_group not null default 'fresh',
  add column if not exists image_urls text[] not null default '{}',
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  -- Mốc đến trước giữa giờ hết hạn và giờ cửa hàng đóng cửa (do backend tính)
  add column if not exists effective_deadline_at timestamptz,
  add column if not exists label_changed_at timestamptz,
  -- Chống gửi trùng thông báo: vàng 1 lần; đỏ 1 lần + nhắc tối đa 3 lần, mỗi 30 phút
  add column if not exists yellow_notified_at timestamptz,
  add column if not exists red_notified_at timestamptz,
  add column if not exists red_last_notified_at timestamptz,
  add column if not exists red_reminder_count integer not null default 0 check (red_reminder_count >= 0);

create index if not exists products_label_automation_idx
on public.products(is_active, label, effective_deadline_at)
where is_active = true;

-- 2. Giờ mở cửa dạng máy đọc được + tùy chọn chuyển hàng đỏ cho từ thiện
--    opening_schedule: [{"day":"Thứ 2","open":true,"from":"08:00","to":"22:00"}, ...]
alter table public.stores
  add column if not exists opening_schedule jsonb not null default '[]'::jsonb,
  add column if not exists charity_transfer_enabled boolean not null default true,
  add column if not exists cover_url text;   -- frontend đăng ký đã gửi cột này, trước đây bị lỗi vì thiếu cột

-- Chép giờ mở cửa và tùy chọn từ thiện đã khai lúc đăng ký (partner_profiles) sang stores
update public.stores s
set opening_schedule = p.opening_schedule
from public.partner_profiles p
where (p.store_id = s.id or p.profile_id = s.owner_id)
  and jsonb_typeof(p.opening_schedule) = 'array'
  and jsonb_array_length(p.opening_schedule) > 0
  and s.opening_schedule = '[]'::jsonb;

update public.stores s
set charity_transfer_enabled = coalesce((p.automation ->> 'charityTransfer')::boolean, true)
from public.partner_profiles p
where p.store_id = s.id or p.profile_id = s.owner_id;

-- Phí nền tảng 15%
alter table public.stores alter column commission_rate set default 15.00;

-- 3. Hàng đỏ tự chuyển một phần cho tổ chức từ thiện
alter table public.donations
  add column if not exists product_id uuid references public.products(id) on delete set null,
  add column if not exists quantity integer check (quantity is null or quantity > 0),
  add column if not exists is_auto boolean not null default false,
  -- Hết hạn nhận lời (45 phút): phần chưa ai nhận trả lại cho người mua
  add column if not exists offer_expires_at timestamptz;

create unique index if not exists donations_one_auto_per_product_idx
on public.donations(product_id)
where is_auto = true and product_id is not null;

create index if not exists donations_auto_offer_idx
on public.donations(status, offer_expires_at)
where is_auto = true;

-- 4. Trạng thái "đã đọc" riêng từng người cho thông báo gửi theo vai trò
--    (trước đây một người đọc là cả nhóm cùng vai trò bị đánh dấu đã đọc)
create table if not exists public.notification_reads (
  notification_id uuid not null references public.notifications(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (notification_id, user_id)
);

create index if not exists notification_reads_user_idx on public.notification_reads(user_id, read_at desc);

alter table public.notification_reads enable row level security;

drop policy if exists notification_reads_self_select on public.notification_reads;
create policy notification_reads_self_select
on public.notification_reads
for select
using (user_id = auth.uid() or public.is_admin());

grant select on public.notification_reads to authenticated;
