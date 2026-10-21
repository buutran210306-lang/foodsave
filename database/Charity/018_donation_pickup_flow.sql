-- 018: Quy trình nhận hàng tặng có tình nguyện viên (TNV)
-- Chạy SAU file 017.
-- Quy trình: tổ chức chọn lô -> cửa hàng chấp nhận -> tổ chức phân TNV (sinh mã nhận hàng)
--            -> cửa hàng đóng gói -> TNV đến, đưa mã -> cửa hàng nhập mã xác nhận bàn giao.

alter table public.donations
  add column if not exists store_confirmed_at timestamptz,
  add column if not exists volunteer_assigned_at timestamptz,
  add column if not exists packed_at timestamptz,
  -- Mã TNV đưa cho cửa hàng khi nhận hàng (cửa hàng nhập tay thay cho máy quét)
  add column if not exists pickup_code text;

-- Tra cứu TNV theo số điện thoại khi đăng nhập
create index if not exists volunteers_phone_idx on public.volunteers(phone);
create index if not exists donations_volunteer_idx on public.donations(assigned_volunteer_id)
where assigned_volunteer_id is not null;
