-- 021: Vai trò tình nguyện viên (lấy hàng / phát hàng), bật-tắt hoạt động theo ngày, giai đoạn phát hàng
-- Chạy SAU file 020.

alter table public.volunteers
  -- 'pickup' = chỉ lấy hàng, 'distribute' = chỉ phát hàng, 'both' = cả hai
  add column if not exists duty_role text not null default 'both',
  -- Ngày (giờ Việt Nam) TNV bấm "Đang hoạt động". Chỉ tính là đang hoạt động khi bằng hôm nay.
  add column if not exists active_on date;

alter table public.volunteers
  drop constraint if exists volunteers_duty_role_check;
alter table public.volunteers
  add constraint volunteers_duty_role_check check (duty_role in ('pickup', 'distribute', 'both'));

-- Giai đoạn 2 (phát hàng) của mỗi lô tặng: người phát và số suất do tổ chức nhập
alter table public.donations
  add column if not exists distribute_volunteer_id uuid references public.volunteers(id) on delete set null,
  add column if not exists distribute_assigned_at timestamptz,
  add column if not exists portions integer check (portions is null or portions > 0);

create index if not exists donations_distribute_volunteer_idx on public.donations(distribute_volunteer_id)
where distribute_volunteer_id is not null;

-- Chuẩn hóa tên khu vực cũ ("Q.1", "q1", "Quận 1") thành "Quận 1" để so khớp chính xác
update public.volunteers v
set zones = coalesce((
  select array_agg(distinct
    case
      when z ~* '^(q\.?|quận|quan)\s*[0-9]+$' then 'Quận ' || regexp_replace(z, '[^0-9]', '', 'g')
      else z
    end)
  from unnest(v.zones) as z
), '{}');
