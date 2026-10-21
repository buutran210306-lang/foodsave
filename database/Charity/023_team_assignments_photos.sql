-- 023: Đội tình nguyện viên nhiều người cho mỗi lô + ảnh minh chứng do TNV chụp (có duyệt)
-- Chạy SAU file 022.
--
-- donation_assignments: "ai làm gì trong lô này". Mỗi dòng = 1 TNV ở 1 giai đoạn (lấy hàng / phát hàng) + phần việc.
--   stage = 'pickup'     -> share = số sản phẩm người này chịu trách nhiệm lấy
--   stage = 'distribute' -> share = số suất người này chịu trách nhiệm phát
-- donation_photos: ảnh TNV chụp trong app. Tổ chức duyệt rồi mới gửi sang cửa hàng (quá hạn thì tự gửi).

create table if not exists public.donation_assignments (
  id uuid primary key default gen_random_uuid(),
  donation_id uuid not null references public.donations(id) on delete cascade,
  volunteer_id uuid not null references public.volunteers(id) on delete cascade,
  stage text not null check (stage in ('pickup', 'distribute')),
  share integer not null check (share > 0),
  assigned_at timestamptz not null default now(),
  done_at timestamptz,
  unique (donation_id, volunteer_id, stage)
);

create index if not exists donation_assignments_donation_idx on public.donation_assignments(donation_id);
create index if not exists donation_assignments_volunteer_idx on public.donation_assignments(volunteer_id);

alter table public.donations
  -- Giờ giai đoạn phát hoàn tất (tất cả người phát đã gửi đủ ảnh phần của mình)
  add column if not exists distribution_done_at timestamptz;

-- Chuyển các lô đã giao theo cách cũ (1 người lấy, 1 người phát) sang bảng mới
insert into public.donation_assignments (donation_id, volunteer_id, stage, share, assigned_at)
select d.id, d.assigned_volunteer_id, 'pickup', greatest(coalesce(d.quantity, 1), 1), coalesce(d.volunteer_assigned_at, now())
from public.donations d
where d.assigned_volunteer_id is not null
on conflict (donation_id, volunteer_id, stage) do nothing;

insert into public.donation_assignments (donation_id, volunteer_id, stage, share, assigned_at)
select d.id, d.distribute_volunteer_id, 'distribute', greatest(coalesce(d.portions, 1), 1), coalesce(d.distribute_assigned_at, now())
from public.donations d
where d.distribute_volunteer_id is not null
on conflict (donation_id, volunteer_id, stage) do nothing;

create table if not exists public.donation_photos (
  id uuid primary key default gen_random_uuid(),
  donation_id uuid not null references public.donations(id) on delete cascade,
  volunteer_id uuid not null references public.volunteers(id) on delete cascade,
  stage text not null check (stage in ('pickup', 'distribute')),
  photo_url text not null,
  taken_at timestamptz not null default now(),
  gps_lat double precision,
  gps_lng double precision,
  -- Khoảng cách (mét) từ chỗ chụp tới cửa hàng (lấy hàng) hoặc tổ chức (phát hàng). Quá xa thì gps_flag = true
  gps_distance_m integer,
  gps_flag boolean not null default false,
  is_demo boolean not null default false,
  blur_score numeric(10,2),
  brightness numeric(6,2),
  -- pending: chờ tổ chức xem · approved: tổ chức đã duyệt · auto_approved: quá hạn tự gửi · retake: yêu cầu chụp lại
  status text not null default 'pending' check (status in ('pending', 'approved', 'auto_approved', 'retake')),
  review_note text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_deadline_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists donation_photos_donation_idx on public.donation_photos(donation_id);
create index if not exists donation_photos_volunteer_idx on public.donation_photos(volunteer_id);

-- Quyền đọc trực tiếp (backend dùng service role nên không bị ảnh hưởng): chỉ admin
alter table public.donation_assignments enable row level security;
alter table public.donation_photos enable row level security;

drop policy if exists donation_assignments_admin_select on public.donation_assignments;
create policy donation_assignments_admin_select on public.donation_assignments for select using (public.is_admin());

drop policy if exists donation_photos_admin_select on public.donation_photos;
create policy donation_photos_admin_select on public.donation_photos for select using (public.is_admin());
