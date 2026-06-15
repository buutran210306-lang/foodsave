-- Cập nhật hàm handle_new_user để tự động phân loại thêm nhóm Charity (Tổ chức từ thiện)
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
    when new.raw_user_meta_data ->> 'role' in ('customer', 'partner', 'charity', 'admin')
      then (new.raw_user_meta_data ->> 'role')::public.user_role
    else 'customer'::public.user_role
  end;

  -- 1. Lưu thông tin vào bảng profiles chung (Tổ chức từ thiện sẽ nhận trạng thái pending chờ duyệt)
  insert into public.profiles (id, role, email, full_name, phone, status, metadata)
  values (
    new.id, requested_role, lower(nullif(new.email, '')),
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'phone', ''),
    case when requested_role in ('partner', 'charity') then 'pending'::public.profile_status else 'active'::public.profile_status end,
    coalesce(new.raw_user_meta_data, '{}'::jsonb)
  ) on conflict (id) do update set role = excluded.role;

  -- 2. Tự động kiểm tra và đẩy vào các bảng hồ sơ chi tiết tương ứng
  if requested_role = 'customer' then
    insert into public.customer_profiles (profile_id, email, phone, display_name)
    values (new.id, lower(nullif(new.email, '')), nullif(new.raw_user_meta_data ->> 'phone', ''), nullif(new.raw_user_meta_data ->> 'full_name', ''))
    on conflict do nothing;
    
  elsif requested_role = 'partner' then
    insert into public.partner_profiles (profile_id, email, phone, representative_name)
    values (new.id, lower(nullif(new.email, '')), nullif(new.raw_user_meta_data ->> 'phone', ''), nullif(new.raw_user_meta_data ->> 'full_name', ''))
    on conflict do nothing;
    
  elsif requested_role = 'charity' then
    -- TỰ ĐỘNG ĐẨY THÔNG TIN VÀO BẢNG TỪ THIỆN CHỜ DUYỆT
    insert into public.charity_profiles (owner_id, email, phone, name, slug, address, status)
    values (
      new.id, 
      lower(nullif(new.email, '')), 
      coalesce(nullif(new.raw_user_meta_data ->> 'phone', ''), ''),
      coalesce(nullif(new.raw_user_meta_data ->> 'org_name', ''), 'Chưa cập nhật'),
      'charity-' || substr(md5(random()::text), 1, 8), -- Tạo chuỗi định danh tự động
      'Chưa cập nhật',
      'pending'
    ) on conflict do nothing;
  end if;

  return new;
end;
$$;