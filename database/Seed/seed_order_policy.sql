-- Dữ liệu THỬ cho quy trình đơn hàng trả trước (kịch bản 1-9). Chạy SAU 028 + 029 (+ 033 nếu thử chat).
-- AN TOÀN: chỉ tạo 1 cửa hàng thử "[THỬ] Tiệm Đơn Hàng" (slug seed-op-store) và 3 sản phẩm tên bắt đầu bằng "[THỬ]".
-- Không sửa, không xóa dữ liệu thật. Chạy lại nhiều lần: mỗi lần sẽ đặt lại kho và hạn sử dụng của 3 sản phẩm thử.
--
-- Cần có sẵn: 1 tài khoản CỬA HÀNG (đã đăng ký) để làm chủ cửa hàng thử. Điền email đó ở dòng v_owner_email.
-- Người mua: tự đăng ký một tài khoản người mua thường trên FOODSAVE_USER.html (không tạo bằng SQL được).

do $$
declare
  v_owner_email text := 'THAY-BANG-EMAIL-TAI-KHOAN-CUA-HANG@example.com';  -- <== SỬA DÒNG NÀY
  v_owner uuid;
  v_store uuid;
  r record;
begin
  select id into v_owner from auth.users where lower(email) = lower(v_owner_email) limit 1;
  if v_owner is null then
    raise exception 'Không tìm thấy tài khoản có email % . Hãy sửa v_owner_email thành email tài khoản cửa hàng của bạn.', v_owner_email;
  end if;

  select id into v_store from public.stores where slug = 'seed-op-store';
  if v_store is null then
    insert into public.stores (owner_id, name, slug, address, latitude, longitude, is_verified, is_open, status)
    values (v_owner, '[THỬ] Tiệm Đơn Hàng', 'seed-op-store', '1 Đường thử đơn hàng, Q.1, TP.HCM', 10.7769, 106.7009, true, true, 'active')
    returning id into v_store;
  else
    update public.stores set status = 'active', is_open = true, updated_at = now() where id = v_store;
  end if;

  -- 3 sản phẩm "đồ nấu chín" (xanh > 12h, vàng 4-12h, đỏ < 4h) với hạn đủ dài để đặt và lấy hàng
  for r in
    select * from (values
      ('[THỬ] Bánh xanh', 'Bánh ngọt / bánh tươi', 'green',  interval '20 hours', 50000, 62500),
      ('[THỬ] Bánh vàng', 'Bánh ngọt / bánh tươi', 'yellow', interval '8 hours',  50000, 100000),
      ('[THỬ] Bánh đỏ',   'Bánh ngọt / bánh tươi', 'red',    interval '3 hours',  50000, 250000)
    ) as t(name, category, label, ttl, price, original)
  loop
    if exists (select 1 from public.products where store_id = v_store and name = r.name) then
      update public.products
      set stock_quantity = 50, sold_count = 0, is_active = true, blocked_reason = null,
          expires_at = now() + r.ttl, effective_deadline_at = now() + r.ttl,
          label = r.label::public.product_label, updated_at = now()
      where store_id = v_store and name = r.name;
    else
      insert into public.products (store_id, name, description, category, price_cents, original_price_cents, label,
                                   expires_at, effective_deadline_at, stock_quantity, food_group, is_active)
      values (v_store, r.name, 'Sản phẩm thử cho quy trình đơn hàng', r.category, r.price, r.original,
              r.label::public.product_label, now() + r.ttl, now() + r.ttl, 50, 'cooked', true);
    end if;
  end loop;
end $$;

-- ───────── Lệnh hỗ trợ thử (chạy từng lệnh khi cần, thay NGUOI_MUA_EMAIL / mã đơn) ─────────
-- Giả lập "quá hạn lấy hàng" cho một đơn đã thanh toán (rồi bấm "Chạy tác vụ đơn hàng" ở Admin):
--   update public.orders set pickup_deadline = now() - interval '1 minute' where order_number = 'FS-XXXX';
-- Giả lập "quá hạn thanh toán":
--   update public.orders set pay_deadline = now() - interval '1 minute' where order_number = 'FS-XXXX' and status = 'awaiting_payment';
-- Xem điểm / khóa của người mua:
--   select p.points, p.rank, p.red_ban_until from public.profiles p join auth.users u on u.id = p.id where lower(u.email) = lower('NGUOI_MUA_EMAIL');
-- Đặt điểm 30 (thử kịch bản 6 "bị chặn"):
--   update public.profiles set points = 30 where id = (select id from auth.users where lower(email) = lower('NGUOI_MUA_EMAIL'));
-- Đặt lại điểm 100 và bỏ khóa:
--   update public.profiles set points = 100, rank = 'Tin cậy', red_ban_until = null where id = (select id from auth.users where lower(email) = lower('NGUOI_MUA_EMAIL'));
-- Xem nhật ký đơn (ví dụ lý do không trả hàng về kho):
--   select o.order_number, e.event_type, e.detail, e.created_at from public.order_events e join public.orders o on o.id = e.order_id order by e.created_at desc limit 20;

-- ───────── Dọn dữ liệu thử (chạy khi không cần nữa) ─────────
-- delete from public.orders where store_id = (select id from public.stores where slug = 'seed-op-store');
-- delete from public.stores where slug = 'seed-op-store';   -- tự xóa luôn sản phẩm thử
