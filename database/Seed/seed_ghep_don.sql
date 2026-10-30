-- Dữ liệu THỬ cho tính năng ghép đơn. Chạy SAU file 027_charity_needs_matching.sql.
-- An toàn chạy lại nhiều lần: mỗi lần chạy sẽ đặt lại các lô thử về trạng thái "đang mở" và hạn mới.
-- Tạo quanh tổ chức đầu tiên có tọa độ: 4 cửa hàng thử + 1 cửa hàng ở xa, mỗi nơi một lô, và 1 nhu cầu "50 phần bánh".
--   Mây 20 phần (nhãn đỏ) + Bếp Xanh 18 + Sớm Mai 15 -> ghép đủ 50 (lô cuối lấy 12, dư 3 trả về kho)
--   Cơm hộp 30 phần (khác loại hàng, bị loại) + cửa hàng xa ~22 km (ngoài bán kính, bị loại)
-- Dọn dữ liệu thử: xem câu lệnh ở cuối file.

do $$
declare
  v_owner uuid;
  v_lat double precision;
  v_lng double precision;
  v_charity uuid;
  v_store uuid;
  v_product uuid;
  v_deadline timestamptz;
  r record;
begin
  select owner_id into v_owner from public.stores order by created_at limit 1;
  select id, latitude, longitude into v_charity, v_lat, v_lng
  from public.charity_profiles where latitude is not null and longitude is not null order by created_at limit 1;
  if v_owner is null or v_charity is null then
    raise exception 'Cần có ít nhất 1 cửa hàng và 1 tổ chức đã có tọa độ trước khi chạy file seed';
  end if;

  for r in
    select * from (values
      ('seed-ghep-may',     'Tiệm bánh Mây (thử)',      '12 Đường thử số 1', 0.012,  0.008, 'Bánh ngọt / bánh tươi', 'Bánh mì ngọt',  20, 3,  'red'),
      ('seed-ghep-bepxanh', 'Bếp Xanh (thử)',           '34 Đường thử số 2', -0.015, 0.010, 'Bánh ngọt / bánh tươi', 'Bánh bông lan', 18, 8,  'yellow'),
      ('seed-ghep-somai',   'Lò bánh Sớm Mai (thử)',    '56 Đường thử số 3', 0.020, -0.012, 'Bánh ngọt / bánh tươi', 'Bánh su kem',    15, 10, 'yellow'),
      ('seed-ghep-comhop',  'Cơm hộp Nhà Mình (thử)',   '78 Đường thử số 4', 0.005, -0.005, 'Bữa ăn / cơm hộp',      'Cơm gà xối mỡ',  30, 6,  'yellow'),
      ('seed-ghep-xa',      'Tiệm bánh Xa (thử)',       '90 Đường thử số 5', 0.200,  0.050, 'Bánh ngọt / bánh tươi', 'Bánh mì que',    25, 8,  'yellow')
    ) as t(slug, store_name, addr, dlat, dlng, category, product_name, qty, hours, urgency)
  loop
    select id into v_store from public.stores where slug = r.slug;
    if v_store is null then
      insert into public.stores (owner_id, name, slug, address, latitude, longitude, is_verified, is_open, status)
      values (v_owner, r.store_name, r.slug, r.addr, v_lat + r.dlat, v_lng + r.dlng, true, true, 'active')
      returning id into v_store;
    else
      update public.stores
      set latitude = v_lat + r.dlat, longitude = v_lng + r.dlng, status = 'active', updated_at = now()
      where id = v_store;
    end if;

    v_deadline := now() + make_interval(hours => r.hours);

    select id into v_product from public.products where store_id = v_store and name = r.product_name;
    if v_product is null then
      insert into public.products (store_id, name, description, category, price_cents, original_price_cents, label,
                                   expires_at, stock_quantity, food_group, is_active)
      values (v_store, r.product_name, 'Sản phẩm thử cho ghép đơn', r.category, 10000, 50000, r.urgency::public.product_label,
              v_deadline, 0, 'cooked', true)
      returning id into v_product;
    else
      update public.products set expires_at = v_deadline, effective_deadline_at = v_deadline, is_active = true where id = v_product;
    end if;

    insert into public.donations (donation_code, store_id, product_id, quantity, is_auto, items, amount_text, weight_kg,
                                  expires_at, pickup_start, pickup_end, urgency, status, offer_expires_at)
    values ('SEED-G-' || upper(substr(r.slug, 11)), v_store, v_product, r.qty, false, r.product_name, r.qty || ' phần',
            round(r.qty * 0.3, 2), v_deadline,
            to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
            to_char(v_deadline at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
            r.urgency::public.donation_urgency, 'open', v_deadline)
    on conflict (donation_code) do update
      set quantity = excluded.quantity, amount_text = excluded.amount_text, weight_kg = excluded.weight_kg,
          expires_at = excluded.expires_at, pickup_start = excluded.pickup_start, pickup_end = excluded.pickup_end,
          status = 'open', charity_id = null, assigned_volunteer_id = null, store_confirmed_at = null,
          accepted_at = null, completed_at = null, offer_expires_at = excluded.offer_expires_at, updated_at = now();
  end loop;

  -- Nhu cầu mẫu: 50 phần bánh, cần trong 6 giờ tới (đặt lại mỗi lần chạy)
  delete from public.charity_needs where charity_id = v_charity and title = 'Cần 50 phần bánh (thử)';
  insert into public.charity_needs (charity_id, title, category_codes, quantity, needed_by)
  values (v_charity, 'Cần 50 phần bánh (thử)', array['bakery'], 50, now() + interval '6 hours');
end $$;

-- Dọn dữ liệu thử (chạy khi không cần nữa):
-- delete from public.donations where donation_code like 'SEED-G-%';
-- delete from public.charity_needs where title = 'Cần 50 phần bánh (thử)';
-- delete from public.stores where slug like 'seed-ghep-%';   -- tự xóa luôn sản phẩm thử
