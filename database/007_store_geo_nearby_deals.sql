-- Nearby deals / GPS prioritization support.
-- Uses existing stores.latitude and stores.longitude columns.

create index if not exists stores_geo_lookup_idx
on public.stores(latitude, longitude)
where latitude is not null and longitude is not null;

create index if not exists products_active_store_expiry_idx
on public.products(store_id, is_active, expires_at)
where is_active = true;
