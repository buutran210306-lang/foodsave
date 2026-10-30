-- CHỈ ĐỌC (select): đếm xem số tài khoản ngân hàng ĐẦY ĐỦ đang nằm ở đâu. Không sửa, không xóa gì, không in số thật.
-- MỘT câu lệnh duy nhất: chạy một lần là hiện đủ mọi vị trí, mỗi vị trí một dòng.
-- "đầy đủ" = chỉ gồm chữ số/dấu cách, dài từ 6 ký tự (dạng đã che như •••••6789 không tính).
-- Bảng hoặc cột không tồn tại thì dòng đó hiện NULL và ghi chú "KHÔNG TỒN TẠI" (câu lệnh không bị lỗi):
-- mỗi câu đếm chỉ được chạy KHI cột có thật (kiểm tra bằng information_schema).

with checks(vi_tri, tbl_schema, tbl, col, count_sql) as (values
  ('partner_profiles.bank_account_number', 'public', 'partner_profiles', 'bank_account_number',
   $q$select count(*) as n from public.partner_profiles where bank_account_number ~ '^[0-9 ]{6,}$'$q$),

  ('partner_profiles.bank_account_number (đã có số đầy đủ nhưng CHƯA có cửa hàng)', 'public', 'partner_profiles', 'store_id',
   $q$select count(*) as n from public.partner_profiles where bank_account_number ~ '^[0-9 ]{6,}$' and store_id is null$q$),

  ('applications.payload', 'public', 'applications', 'payload',
   $q$select count(*) as n from public.applications
      where payload ->> 'bank_account_number' ~ '^[0-9 ]{6,}$'
         or payload -> 'finance' ->> 'bank_account_number' ~ '^[0-9 ]{6,}$'$q$),

  ('profiles.metadata', 'public', 'profiles', 'metadata',
   $q$select count(*) as n from public.profiles
      where metadata -> 'partner_registration' -> 'finance' ->> 'bank_account_number' ~ '^[0-9 ]{6,}$'
         or metadata -> 'finance' ->> 'bank_account_number' ~ '^[0-9 ]{6,}$'
         or metadata ->> 'bank_account_number' ~ '^[0-9 ]{6,}$'$q$),

  ('partner_profiles.metadata', 'public', 'partner_profiles', 'metadata',
   $q$select count(*) as n from public.partner_profiles
      where metadata -> 'partner_registration' -> 'finance' ->> 'bank_account_number' ~ '^[0-9 ]{6,}$'
         or metadata -> 'finance' ->> 'bank_account_number' ~ '^[0-9 ]{6,}$'
         or metadata ->> 'bank_account_number' ~ '^[0-9 ]{6,}$'$q$),

  ('auth.users.raw_user_meta_data', 'auth', 'users', 'raw_user_meta_data',
   $q$select count(*) as n from auth.users
      where raw_user_meta_data -> 'partner_registration' -> 'finance' ->> 'bank_account_number' ~ '^[0-9 ]{6,}$'
         or raw_user_meta_data -> 'finance' ->> 'bank_account_number' ~ '^[0-9 ]{6,}$'
         or raw_user_meta_data ->> 'bank_account_number' ~ '^[0-9 ]{6,}$'$q$),

  -- Chỉ để tham khảo sau khi chạy SQL 035: số tài khoản đã mã hóa trong bảng mới (không phải số đầy đủ)
  ('store_payout_accounts (đã mã hóa, tham khảo)', 'public', 'store_payout_accounts', 'account_number_encrypted',
   $q$select count(*) as n from public.store_payout_accounts$q$)
)
select
  c.vi_tri,
  case
    when exists (select 1 from information_schema.columns i
                 where i.table_schema = c.tbl_schema and i.table_name = c.tbl and i.column_name = c.col)
      then (xpath('/row/n/text()', query_to_xml(c.count_sql, false, true, '')))[1]::text::bigint
    else null
  end as so_dong_con_so_day_du,
  case
    when exists (select 1 from information_schema.columns i
                 where i.table_schema = c.tbl_schema and i.table_name = c.tbl and i.column_name = c.col)
      then 'đã kiểm tra'
    else 'KHÔNG TỒN TẠI (bảng hoặc cột chưa có)'
  end as ghi_chu
from checks c
order by c.vi_tri;
