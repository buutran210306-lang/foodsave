-- 015: Cấp quyền admin cho một tài khoản
-- Chạy SAU file 014.
--
-- BƯỚC 1 (trên giao diện Supabase, không dùng SQL):
--   Authentication -> Users -> Add user -> Create new user
--   Nhập email + mật khẩu, TICK "Auto Confirm User", bấm Create user.
--   Trigger sẽ tự tạo một dòng trong profiles với vai trò 'customer'.
--
-- BƯỚC 2: thay email bên dưới bằng email vừa tạo, rồi bấm Run.

do $$
declare
  admin_email text := 'admin@foodsave.vn';   -- <== ĐỔI EMAIL Ở ĐÂY
  admin_name  text := 'Quản trị viên';       -- <== tên hiển thị trên trang Admin
  admin_id    uuid;
begin
  select id into admin_id from auth.users where lower(email) = lower(admin_email);
  if admin_id is null then
    raise exception 'Không tìm thấy tài khoản % trong Authentication -> Users. Hãy làm BƯỚC 1 trước.', admin_email;
  end if;

  update public.profiles
  set role = 'admin', status = 'active', full_name = coalesce(full_name, admin_name), email = lower(admin_email)
  where id = admin_id;

  if not found then
    insert into public.profiles (id, role, status, email, full_name)
    values (admin_id, 'admin', 'active', lower(admin_email), admin_name);
  end if;

  -- Tài khoản admin không phải khách hàng: xóa hồ sơ khách hàng do trigger tự tạo.
  delete from public.customer_profiles where profile_id = admin_id;
end $$;

-- Kiểm tra: phải thấy đúng 1 dòng với role = admin
select id, email, role, status, full_name from public.profiles where role = 'admin';
