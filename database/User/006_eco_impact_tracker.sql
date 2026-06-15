-- Eco Impact Tracker
-- Records idempotent impact events from completed orders and donations.

do $$
begin
  create type public.eco_impact_source as enum ('order', 'donation', 'manual_adjustment');
exception
  when duplicate_object then null;
end $$;

alter table public.products
  add column if not exists estimated_weight_kg numeric(10,3) check (estimated_weight_kg is null or estimated_weight_kg > 0),
  add column if not exists servings_count integer check (servings_count is null or servings_count > 0);

create table if not exists public.eco_impact_factors (
  id text primary key default 'default',
  co2_kg_per_food_kg numeric(8,3) not null default 2.500 check (co2_kg_per_food_kg > 0),
  water_liters_per_food_kg numeric(10,2) not null default 890.00 check (water_liters_per_food_kg > 0),
  food_kg_per_meal numeric(8,3) not null default 0.350 check (food_kg_per_meal > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.eco_impact_factors (id)
values ('default')
on conflict (id) do nothing;

create table if not exists public.eco_impact_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  store_id uuid references public.stores(id) on delete set null,
  charity_id uuid references public.charity_profiles(id) on delete set null,
  source_type public.eco_impact_source not null,
  source_id uuid not null,
  occurred_at timestamptz not null default now(),
  food_saved_kg numeric(12,3) not null default 0 check (food_saved_kg >= 0),
  co2_avoided_kg numeric(12,3) not null default 0 check (co2_avoided_kg >= 0),
  water_saved_liters numeric(12,2) not null default 0 check (water_saved_liters >= 0),
  meals_equivalent integer not null default 0 check (meals_equivalent >= 0),
  money_saved_cents integer not null default 0 check (money_saved_cents >= 0),
  calculation_method text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (source_type, source_id)
);

create index if not exists idx_eco_impact_events_actor_time on public.eco_impact_events(actor_id, occurred_at desc);
create index if not exists idx_eco_impact_events_store_time on public.eco_impact_events(store_id, occurred_at desc);
create index if not exists idx_eco_impact_events_charity_time on public.eco_impact_events(charity_id, occurred_at desc);
create index if not exists idx_eco_impact_events_source on public.eco_impact_events(source_type, source_id);
create index if not exists idx_eco_impact_events_occurred_at on public.eco_impact_events(occurred_at desc);

alter table public.eco_impact_factors enable row level security;
alter table public.eco_impact_events enable row level security;

drop policy if exists eco_impact_factors_public_select on public.eco_impact_factors;
create policy eco_impact_factors_public_select on public.eco_impact_factors for select using (true);

drop policy if exists eco_impact_factors_admin_modify on public.eco_impact_factors;
create policy eco_impact_factors_admin_modify on public.eco_impact_factors for all
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists eco_impact_events_scoped_select on public.eco_impact_events;
create policy eco_impact_events_scoped_select on public.eco_impact_events for select using (
  actor_id = auth.uid()
  or (store_id is not null and public.owns_store(store_id))
  or (charity_id is not null and public.owns_charity(charity_id))
  or public.is_admin()
);

drop policy if exists eco_impact_events_admin_insert on public.eco_impact_events;
create policy eco_impact_events_admin_insert on public.eco_impact_events for insert
  with check (public.is_admin());

drop policy if exists eco_impact_events_admin_update on public.eco_impact_events;
create policy eco_impact_events_admin_update on public.eco_impact_events for update
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists eco_impact_events_admin_delete on public.eco_impact_events;
create policy eco_impact_events_admin_delete on public.eco_impact_events for delete
  using (public.is_admin());
