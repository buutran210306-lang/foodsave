-- 020: Lưu thông tin người nhận mà người mua điền lúc đặt hàng
-- Chạy SAU file 019. Cửa hàng xem các thông tin này ở chi tiết đơn.

alter table public.orders
  add column if not exists receiver_name text,
  add column if not exists receiver_phone text,
  add column if not exists receiver_email text;
