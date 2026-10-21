-- 017: Vị trí trụ sở và bán kính phục vụ của tổ chức từ thiện
-- Chạy SAU file 016.
-- Dùng để: gửi lô tặng của cửa hàng cho tổ chức ở gần, hiện bản đồ điều phối, tính khoảng cách.

alter table public.charity_profiles
  add column if not exists latitude double precision check (latitude is null or (latitude between -90 and 90)),
  add column if not exists longitude double precision check (longitude is null or (longitude between -180 and 180)),
  -- "Địa bàn phục vụ" tổ chức khai lúc đăng ký (km). Cửa hàng trong bán kính này mới gửi thông báo tặng.
  add column if not exists service_radius_km numeric(6,2) not null default 5 check (service_radius_km > 0 and service_radius_km <= 100);

create index if not exists charity_profiles_geo_idx
on public.charity_profiles(latitude, longitude)
where latitude is not null and longitude is not null;

-- Tổ chức đã đăng ký trước khi chạy file này: lấy vị trí đã lưu tạm trong metadata (nếu có)
update public.charity_profiles
set latitude = (metadata -> 'location' ->> 'latitude')::double precision,
    longitude = (metadata -> 'location' ->> 'longitude')::double precision,
    service_radius_km = coalesce((metadata -> 'location' ->> 'service_radius_km')::numeric, service_radius_km)
where latitude is null
  and metadata ? 'location'
  and (metadata -> 'location' ->> 'latitude') ~ '^-?[0-9.]+$'
  and (metadata -> 'location' ->> 'longitude') ~ '^-?[0-9.]+$';
