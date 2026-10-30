-- 031: Luồng khiếu nại mới (đặc tả mục 2.7): lý do + ảnh bắt buộc, cửa hàng phản hồi trong 12 giờ, admin quyết định.
-- Chạy SAU 029 (cần cột orders.complaint_deadline_at). Chạy lại nhiều lần không lỗi.
--
-- Làm gì: chỉ THÊM cột vào bảng complaints (không đổi / không xóa dữ liệu khiếu nại cũ) và thêm chỉ mục.
--  * Khiếu nại cũ (tạo trước đợt này) có reason_code = null và vẫn chạy theo luồng cũ.
--  * Chỉ mục "mỗi đơn một khiếu nại": nếu đang có đơn bị khiếu nại trùng thì chỉ mục được BỎ QUA kèm thông báo
--    (backend vẫn chặn trùng ở tầng ứng dụng); xử lý trùng rồi chạy lại tệp này để tạo chỉ mục.
-- Quay lại (nếu cần): `drop index if exists public.complaints_one_per_order;` rồi xóa các cột mới bằng `alter table public.complaints drop column ...`
--   (các cột mới đều cho phép null / có giá trị mặc định nên bỏ nguyên cũng không ảnh hưởng luồng cũ).

alter table public.complaints
  add column if not exists reason_code text,
  add column if not exists response_due_at timestamptz,
  add column if not exists store_response text,
  add column if not exists store_response_action text,
  add column if not exists store_response_images text[] not null default '{}',
  add column if not exists store_responded_at timestamptz,
  add column if not exists escalated_at timestamptz,
  add column if not exists decision text,
  add column if not exists refund_cents bigint not null default 0,
  add column if not exists is_false_claim boolean not null default false,
  add column if not exists admin_note text,
  add column if not exists decided_by uuid references public.profiles(id),
  add column if not exists decided_at timestamptz;

-- Ràng buộc giá trị (thêm riêng, bỏ qua nếu đã có)
do $$
begin
  alter table public.complaints add constraint complaints_reason_code_check
    check (reason_code is null or reason_code in ('wrong_item', 'spoiled_expired', 'missing_items', 'other'));
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.complaints add constraint complaints_store_response_action_check
    check (store_response_action is null or store_response_action in ('accept', 'dispute'));
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.complaints add constraint complaints_decision_check
    check (decision is null or decision in ('refund_full', 'refund_partial', 'reject'));
exception when duplicate_object then null;
end $$;

do $$
begin
  create unique index if not exists complaints_one_per_order on public.complaints(order_id);
exception when unique_violation then
  raise notice 'Bỏ qua chỉ mục complaints_one_per_order vì đang có đơn bị khiếu nại trùng. Xử lý trùng rồi chạy lại tệp này.';
end $$;

create index if not exists complaints_queue_idx on public.complaints(status, response_due_at);
create index if not exists complaints_store_idx on public.complaints(store_id, created_at desc);

-- Mọi thay đổi khiếu nại đi qua Backend (service role). Gỡ hai policy cho phép người dùng GHI trực tiếp bằng khóa công khai
-- (khách tự chèn khiếu nại / chủ cửa hàng tự sửa quyết định, số tiền hoàn), nếu không họ vượt được luật hạn, ảnh và quyết định.
-- Policy ĐỌC (complaints_access_select) giữ nguyên. Quay lại: chạy lại hai lệnh create policy ở database/User/001_foodsave_schema.sql.
drop policy if exists complaints_customer_insert on public.complaints;
drop policy if exists complaints_store_owner_update on public.complaints;
