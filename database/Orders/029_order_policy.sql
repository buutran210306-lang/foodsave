-- 029: Cột chính sách đơn hàng trả trước, khóa nhãn đỏ, nhật ký đơn.
-- Chạy SAU 028 (đã chạy xong và thành công). Chạy lại nhiều lần không lỗi.

alter table public.orders
  add column if not exists pay_deadline timestamptz,
  add column if not exists paid_at timestamptz,
  add column if not exists pickup_deadline timestamptz,
  add column if not exists cancel_free_until timestamptz,
  add column if not exists policy_label text check (policy_label in ('green','yellow','red')),
  add column if not exists no_show_at timestamptz,
  add column if not exists cancel_reason text,
  add column if not exists cancelled_by text check (cancelled_by in ('customer','store','system','admin')),
  add column if not exists reminder_mid_sent_at timestamptz,
  add column if not exists reminder_final_sent_at timestamptz,
  add column if not exists settlement_status text not null default 'none'
    check (settlement_status in ('none','held','released','forfeited','refunded','partially_refunded')),
  add column if not exists complaint_deadline_at timestamptz,
  -- Đã xử lý trả hàng về kho (hoặc cố ý không trả) cho đơn này: chống trả kho hai lần
  add column if not exists stock_restored_at timestamptz;

alter table public.profiles
  add column if not exists red_ban_until timestamptz;

create index if not exists orders_pay_deadline_idx on public.orders(pay_deadline) where status = 'awaiting_payment';
create index if not exists orders_pickup_deadline_idx on public.orders(pickup_deadline) where status in ('pending','confirmed','ready');
create index if not exists orders_customer_noshow_idx on public.orders(customer_id, no_show_at) where status = 'no_show';

-- Nhật ký đơn (ví dụ: không trả hàng về kho vì sản phẩm gần hết hạn). Chỉ Backend (service role) đọc/ghi.
create table if not exists public.order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  event_type text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists order_events_order_idx on public.order_events(order_id, created_at);
alter table public.order_events enable row level security;
