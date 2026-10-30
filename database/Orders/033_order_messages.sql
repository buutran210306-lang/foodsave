-- 033: Chat theo đơn giữa người mua và cửa hàng. Chạy lại nhiều lần không lỗi.
-- (Đánh số 033 theo đặc tả; có thể chạy ngay sau 029 vì không phụ thuộc 030-032.)

create table if not exists public.order_messages (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  sender_id uuid references public.profiles(id) on delete set null,
  sender_role text not null check (sender_role in ('customer','partner','system')),
  body text not null check (char_length(body) between 1 and 500),
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists order_messages_order_idx on public.order_messages(order_id, created_at);
create index if not exists order_messages_sender_idx on public.order_messages(sender_id, created_at desc);
alter table public.order_messages enable row level security;

-- Người mua của đơn và chủ cửa hàng của đơn được SELECT; mọi INSERT đi qua API (service role).
do $$
begin
  drop policy if exists order_messages_select_participants on public.order_messages;
  create policy order_messages_select_participants on public.order_messages for select using (
    exists (select 1 from public.orders o where o.id = order_id and (
      o.customer_id = auth.uid()
      or exists (select 1 from public.stores s where s.id = o.store_id and s.owner_id = auth.uid())))
  );
end $$;

-- Bật Realtime (đã bật rồi thì bỏ qua)
do $$
begin
  alter publication supabase_realtime add table public.order_messages;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
