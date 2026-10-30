-- 034: Chuẩn bị nối cổng thanh toán thật (MoMo...). Chạy SAU 030. Chạy lại nhiều lần không lỗi.
-- Làm gì: (1) thêm cột lưu nhà cung cấp + mã tham chiếu thanh toán vào đơn; (2) bảng payment_events để chống xử lý trùng webhook.
-- Không đổi dữ liệu cũ; các cột mới cho phép null.
-- Quay lại: `alter table public.orders drop column if exists payment_provider, drop column if exists payment_ref;`
--           `drop table if exists public.payment_events;`  (chỉ làm khi chưa dùng cổng thật)

alter table public.orders
  add column if not exists payment_provider text,
  add column if not exists payment_ref text;

create index if not exists orders_payment_ref_idx on public.orders(payment_provider, payment_ref) where payment_ref is not null;

-- Mỗi thông báo từ nhà cung cấp (webhook) ghi MỘT dòng, khóa duy nhất theo (nhà cung cấp, mã giao dịch của họ):
-- gọi lại cùng mã giao dịch thì không xử lý lần hai.
create table if not exists public.payment_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_txn_id text not null,
  order_id uuid references public.orders(id) on delete set null,
  amount_cents bigint,
  status text not null default 'received' check (status in ('received', 'processed', 'rejected', 'ignored')),
  payload_hash text,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint payment_events_unique_txn unique (provider, provider_txn_id)
);
create index if not exists payment_events_order_idx on public.payment_events(order_id);

-- Chỉ Backend (service role) đọc/ghi
alter table public.payment_events enable row level security;
