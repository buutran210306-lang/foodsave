-- 027: Ghép đơn từ tổ chức từ thiện đến nhiều cửa hàng
-- Chạy SAU file 026 (hoặc sau 023 nếu chưa có 024-026 cũng được, file này không phụ thuộc chúng).
-- Không đổi tên hay xóa bảng/cột đang có. Chỉ thêm bảng charity_needs và hàm giữ hàng.
--
-- Ý tưởng: tổ chức đăng "cần 50 phần bánh trước 18:00". Backend ghép các lô tặng (donations) của nhiều cửa hàng
-- cho đủ 50; khi tổ chức chọn phương án, hàm reserve_donations_for_need giữ tất cả lô trong MỘT giao dịch
-- (hoặc nhận đủ, hoặc không nhận lô nào), rồi các lô đi tiếp luồng cũ: cửa hàng chấp nhận -> phân TNV -> bàn giao.

-- 1) Nhu cầu của tổ chức (đơn vị: số phần)
create table if not exists public.charity_needs (
  id uuid primary key default gen_random_uuid(),
  charity_id uuid not null references public.charity_profiles(id) on delete cascade,
  title text not null,
  -- Mã loại hàng: bakery (bánh ngọt/bánh tươi), meal (bữa ăn/cơm hộp)
  category_codes text[] not null check (cardinality(category_codes) between 1 and 5),
  quantity integer not null check (quantity > 0),
  needed_by timestamptz not null,
  status text not null default 'open' check (status in ('open', 'matched', 'cancelled')),
  note text,
  matched_donation_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists charity_needs_charity_idx on public.charity_needs (charity_id, status, created_at desc);

-- Chỉ backend (service role) đọc/ghi; trình duyệt không được đụng trực tiếp
alter table public.charity_needs enable row level security;

-- 2) Giữ hàng nguyên tử theo phương án
--    p_lines: [{"id": "<donation uuid>", "qty": <số phần lấy>}, ...]
--    - Chỉ nhận khi TẤT CẢ lô còn mở, chưa ai nhận, chưa hết hạn, còn trong thời gian nhận lời 45 phút.
--    - Lô cuối chỉ lấy đúng số phần còn thiếu: phần dư (nếu có) được trả về kho bán của sản phẩm.
--    - Cập nhật y như khi tổ chức nhận một lô riêng (status accepted, xóa xác nhận cũ của cửa hàng/TNV).
create or replace function public.reserve_donations_for_need(p_need_id uuid, p_lines jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_charity uuid;
  v_ids uuid[];
  v_n int;
  v_ok int;
  v_line record;
  v_d record;
begin
  select charity_id into v_charity
  from public.charity_needs
  where id = p_need_id and status = 'open'
  for update;
  if v_charity is null then
    raise exception 'need_not_open';
  end if;

  select array_agg((x ->> 'id')::uuid order by (x ->> 'id')::uuid) into v_ids
  from jsonb_array_elements(p_lines) x;
  v_n := coalesce(cardinality(v_ids), 0);
  if v_n = 0 or v_n <> (select count(distinct e) from unnest(v_ids) e) then
    raise exception 'invalid_lines';
  end if;

  -- Khóa theo thứ tự id để hai yêu cầu cùng lúc không chờ nhau vòng tròn (deadlock)
  perform 1 from public.donations where id = any(v_ids) order by id for update;

  select count(*) into v_ok
  from public.donations
  where id = any(v_ids)
    and status = 'open'
    and charity_id is null
    and quantity is not null
    and expires_at > now()
    and (offer_expires_at is null or offer_expires_at > now());
  if v_ok <> v_n then
    raise exception 'not_available';
  end if;

  for v_line in
    select (x ->> 'id')::uuid as id, (x ->> 'qty')::int as qty
    from jsonb_array_elements(p_lines) x
  loop
    select id, quantity, weight_kg, product_id into v_d from public.donations where id = v_line.id;
    if v_line.qty is null or v_line.qty < 1 or v_line.qty > v_d.quantity then
      raise exception 'invalid_quantity';
    end if;
    -- Lấy ít hơn cả lô: thu nhỏ lô và trả phần dư về kho (chỉ khi lô có sản phẩm gốc để trả)
    if v_line.qty < v_d.quantity and v_d.product_id is not null then
      update public.products
      set stock_quantity = stock_quantity + (v_d.quantity - v_line.qty), updated_at = now()
      where id = v_d.product_id;
      update public.donations
      set quantity = v_line.qty,
          amount_text = v_line.qty || ' phần',
          weight_kg = greatest(0.01, round(v_d.weight_kg * v_line.qty / v_d.quantity, 2))
      where id = v_line.id;
    end if;
  end loop;

  update public.donations
  set charity_id = v_charity,
      status = 'accepted',
      assigned_volunteer_id = null,
      store_confirmed_at = null,
      accepted_at = now(),
      updated_at = now()
  where id = any(v_ids);

  update public.charity_needs
  set status = 'matched', matched_donation_ids = v_ids, updated_at = now()
  where id = p_need_id;
end;
$$;

revoke all on function public.reserve_donations_for_need(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.reserve_donations_for_need(uuid, jsonb) to service_role;
