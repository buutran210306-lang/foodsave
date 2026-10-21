-- 022: Ghi nhận lần đăng nhập đầu của tình nguyện viên + ảnh đại diện
-- Chạy SAU file 021.
-- "TNV mới" = chưa đăng nhập app lần nào (last_login_at còn trống).

alter table public.volunteers
  add column if not exists last_login_at timestamptz,
  add column if not exists avatar_url text;

-- TNV đã dùng app trước khi có cột này: coi như đã đăng nhập
update public.volunteers v
set last_login_at = coalesce(v.updated_at, now())
where v.last_login_at is null
  and (
    v.active_on is not null
    or v.runs > 0
    or exists (select 1 from public.donations d where d.assigned_volunteer_id = v.id)
  );
