-- Initial Ivanalicious Treats commerce schema.
-- Applied to Supabase project mizibismrtpscmedleco on 2026-11-18.
create extension if not exists pgcrypto;

create table if not exists public.product_categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.product_categories(id) on delete restrict,
  slug text not null unique,
  name text not null,
  description text not null default '',
  price_cents integer not null check (price_cents >= 0),
  currency text not null default 'KES' check (currency in ('KES')),
  emoji text,
  image_url text,
  is_active boolean not null default true,
  stock integer check (stock is null or stock >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text not null,
  email text,
  delivery_method text not null check (delivery_method in ('pickup','delivery')),
  delivery_address text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  customer_id uuid not null references public.customers(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending','confirmed','preparing','ready','delivered','cancelled')),
  subtotal_cents integer not null check (subtotal_cents >= 0),
  delivery_fee_cents integer not null default 0 check (delivery_fee_cents >= 0),
  total_cents integer not null check (total_cents >= 0),
  currency text not null default 'KES' check (currency in ('KES')),
  payment_method text not null default 'mpesa_on_pickup_or_delivery',
  payment_reference text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  product_name text not null,
  unit_price_cents integer not null check (unit_price_cents >= 0),
  quantity integer not null check (quantity > 0),
  line_total_cents integer not null check (line_total_cents >= 0),
  created_at timestamptz not null default now()
);

create index if not exists orders_customer_id_idx on public.orders(customer_id);
create index if not exists orders_status_idx on public.orders(status);
create index if not exists orders_created_at_idx on public.orders(created_at desc);
create index if not exists order_items_order_id_idx on public.order_items(order_id);
create index if not exists order_items_product_id_idx on public.order_items(product_id);
create index if not exists products_category_id_idx on public.products(category_id);
create index if not exists products_active_idx on public.products(is_active);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at before update on public.products
for each row execute function public.set_updated_at();

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at before update on public.orders
for each row execute function public.set_updated_at();

alter table public.product_categories enable row level security;
alter table public.products enable row level security;
alter table public.customers enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

drop policy if exists "Public read active categories" on public.product_categories;
create policy "Public read active categories" on public.product_categories
for select using (true);

drop policy if exists "Public read active products" on public.products;
create policy "Public read active products" on public.products
for select using (is_active);

drop policy if exists "No anonymous customer access" on public.customers;
create policy "No anonymous customer access" on public.customers
for select using (false);

drop policy if exists "No anonymous order access" on public.orders;
create policy "No anonymous order access" on public.orders
for select using (false);

drop policy if exists "No anonymous order item access" on public.order_items;
create policy "No anonymous order item access" on public.order_items
for select using (false);

insert into public.product_categories (slug, name, sort_order)
values ('cupcakes', 'Cupcakes', 0)
on conflict (slug) do nothing;

insert into public.products (category_id, slug, name, description, price_cents, emoji)
select c.id, v.slug, v.name, v.description, v.price_cents, v.emoji
from public.product_categories c
join (values
  ('oreo-cupcake', 'Oreo cupcake', 'Topped with crushed Oreo and drizzle.', 6000, '🧁'),
  ('vanilla-cupcake', 'Vanilla cupcake', 'Classic vanilla with a golden drizzle.', 6000, '🧁')
) as v(slug, name, description, price_cents, emoji) on c.slug = 'cupcakes'
on conflict (slug) do nothing;
