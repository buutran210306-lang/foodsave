-- 028: Thêm giá trị enum cho quy trình đơn hàng trả trước.
-- CHẠY RIÊNG tệp này trước (Run xong mới chạy 029): Postgres không cho dùng giá trị enum mới trong cùng giao dịch.
-- Chạy lại nhiều lần không lỗi ("if not exists").

alter type public.order_status add value if not exists 'awaiting_payment';
alter type public.order_status add value if not exists 'no_show';

-- Chỉ thêm giá trị này khi kiểu seller_violation_type đã tồn tại (file 002). Chưa có thì bỏ qua, không lỗi.
do $$
begin
  if exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
             where t.typname = 'seller_violation_type' and n.nspname = 'public') then
    alter type public.seller_violation_type add value if not exists 'COMPLAINT_UPHELD';
  end if;
end $$;
