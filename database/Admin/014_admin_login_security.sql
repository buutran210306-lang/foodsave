-- 014: Bảo vệ quyền Admin cho màn hình đăng nhập Admin
-- Chạy SAU các file 001 -> 013.
-- File này KHÔNG tạo tài khoản admin. Tạo tài khoản theo hướng dẫn trong 015_create_admin_account.sql.

-- 1. Không cho người đăng ký tự chọn vai trò admin qua metadata.
--    Giữ nguyên luồng của file 010, chỉ bỏ 'admin' khỏi danh sách vai trò được chấp nhận.
--    Tài khoản admin chỉ được cấp bằng SQL (file 015) hoặc bởi một admin khác.
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
    when new.raw_user_meta_data ->> 'role' in ('customer', 'partner', 'charity')
      then (new.raw_user_meta_data ->> 'role')::public.user_role
    else 'customer'::public.user_role
  end;

  insert into public.profiles (id, role, email, full_name, phone, status, metadata)
  values (
    new.id, requested_role, lower(nullif(new.email, '')),
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'phone', ''),
    case when requested_role in ('partner', 'charity') then 'pending'::public.profile_status else 'active'::public.profile_status end,
    coalesce(new.raw_user_meta_data, '{}'::jsonb)
  ) on conflict (id) do update set role = excluded.role;

  if requested_role = 'customer' then
    insert into public.customer_profiles (profile_id, email, phone, display_name)
    values (new.id, lower(nullif(new.email, '')), nullif(new.raw_user_meta_data ->> 'phone', ''), nullif(new.raw_user_meta_data ->> 'full_name', ''))
    on conflict do nothing;

  elsif requested_role = 'partner' then
    insert into public.partner_profiles (profile_id, email, phone, representative_name)
    values (new.id, lower(nullif(new.email, '')), nullif(new.raw_user_meta_data ->> 'phone', ''), nullif(new.raw_user_meta_data ->> 'full_name', ''))
    on conflict do nothing;

  elsif requested_role = 'charity' then
    insert into public.charity_profiles (owner_id, email, phone, name, slug, address, status)
    values (
      new.id,
      -- charity_profiles.email là NOT NULL: đăng ký bằng số điện thoại (không có email) không được làm hỏng bước tạo tài khoản
      coalesce(lower(nullif(new.email, '')), ''),
      coalesce(nullif(new.raw_user_meta_data ->> 'phone', ''), ''),
      coalesce(nullif(new.raw_user_meta_data ->> 'org_name', ''), 'Chưa cập nhật'),
      'charity-' || substr(md5(random()::text), 1, 8),
      'Chưa cập nhật',
      'pending'
    ) on conflict do nothing;
  end if;

  return new;
end;
$$;

-- 2. Người dùng thường không được tự đổi role / status của chính mình.
--    Backend dùng service_role (auth.uid() = null) và Admin (is_admin()) vẫn đổi được.
create or replace function public.protect_profile_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if new.role is distinct from old.role then
      raise exception 'Không được tự thay đổi vai trò tài khoản' using errcode = '42501';
    end if;
    if new.status is distinct from old.status then
      raise exception 'Không được tự thay đổi trạng thái tài khoản' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_profile_privileged_columns on public.profiles;
create trigger protect_profile_privileged_columns
before update on public.profiles
for each row execute function public.protect_profile_privileged_columns();

-- 3. Gỡ các policy mở quá rộng. Admin đã có quyền qua is_admin() trong các policy *_owner_*.
--    partner_profiles: mọi người đăng nhập đang xem được CCCD, mã số thuế, tài khoản ngân hàng của cửa hàng.
drop policy if exists admin_view_partner_profiles on public.partner_profiles;
--    Điều kiện auth.jwt()->>'role' = 'admin' không bao giờ đúng; partner_profiles_owner_select đã cho admin xem.
drop policy if exists admin_view_partners on public.partner_profiles;
--    charity_profiles: ai cũng sửa được (kể cả tự duyệt). Chủ hồ sơ và admin vẫn sửa được qua charity_profiles_owner_update.
drop policy if exists "Allow public update for testing" on public.charity_profiles;
