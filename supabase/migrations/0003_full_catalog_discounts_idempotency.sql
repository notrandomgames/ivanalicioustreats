-- 0003: full product catalog, server-side discount codes, idempotent order creation,
-- order-level fulfilment details, status history, payments, and basic abuse limits.
-- Non-destructive: only adds columns/tables/rows and replaces create_order().

-- ---------------------------------------------------------------------------
-- Catalog
-- ---------------------------------------------------------------------------
alter table public.products add column if not exists sku text;
alter table public.products add column if not exists sort_order integer not null default 0;
create unique index if not exists products_sku_key on public.products (sku) where sku is not null;

insert into public.product_categories (slug, name, sort_order)
values ('cupcakes', 'Cupcakes', 1), ('cookies', 'Cookies', 2)
on conflict (slug) do update set sort_order = excluded.sort_order;

with c as (select id, slug from public.product_categories)
insert into public.products (category_id, sku, slug, name, description, price_cents, currency, emoji, image_url, is_active, sort_order)
select c.id, v.sku, v.slug, v.name, v.description, v.price_cents, 'KES', v.emoji, v.image_url, true, v.sort_order
from (values
  ('cupcakes','cu1','oreo-cupcake','Oreo cupcake','Topped with crushed Oreo and drizzle.',6000,'🧁','/assets/img/cu1.jpg',1),
  ('cupcakes','cu2','vanilla-cupcake','Vanilla cupcake','Classic vanilla with a golden drizzle.',6000,'🧁','/assets/img/cu2.jpg',2),
  ('cupcakes','cu3','chocolate-cupcake','Chocolate cupcake','Rich chocolate with chocolate drizzle.',6000,'🧁','/assets/img/cu3.jpg',3),
  ('cupcakes','cu4','red-velvet-cupcake','Red velvet cupcake','Classic red velvet with white drizzle.',6000,'🧁','/assets/img/cu4.jpg',4),
  ('cupcakes','cu5','coffee-cupcake','Coffee cupcake','Coffee-infused, topped with chocolate pearls.',6000,'🧁','/assets/img/cu5.jpg',5),
  ('cookies','co1','oreo-cookie','Oreo cookie','Loaded with Oreo chunks and drizzle.',7000,'🍪','/assets/img/co1.jpg',6),
  ('cookies','co2','chocolate-chip-cookie','Chocolate chip cookie','Classic, loaded with chocolate chips.',7000,'🍪','/assets/img/co2.jpg',7),
  ('cookies','co3','milk-white-chocolate-cookie','Milk and white chocolate cookie','Double chocolate, milk and white chunks.',7000,'🍪','/assets/img/co3.jpg',8),
  ('cookies','co4','mm-cookie','M&M cookie','Colorful M&Ms baked right in.',7000,'🍪','/assets/img/co4.jpg',9),
  ('cookies','co5','twix-cookie','Twix cookie','Loaded with Twix pieces and caramel drizzle.',7000,'🍪','/assets/img/co5.jpg',10)
) as v(cat, sku, slug, name, description, price_cents, emoji, image_url, sort_order)
join c on c.slug = v.cat
on conflict (slug) do update
  set sku = excluded.sku, description = excluded.description, image_url = excluded.image_url,
      sort_order = excluded.sort_order, emoji = excluded.emoji;

-- ---------------------------------------------------------------------------
-- Discount codes (validated only on the server)
-- ---------------------------------------------------------------------------
create table if not exists public.discount_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  description text,
  amount_cents integer not null check (amount_cents > 0),
  category_id uuid references public.product_categories(id) on delete restrict,
  is_active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists discount_codes_code_key on public.discount_codes (lower(code));
alter table public.discount_codes enable row level security;
-- No policies: codes are never readable by anon/authenticated clients.

insert into public.discount_codes (code, description, amount_cents, category_id)
select 'M.OLISE', 'KES 10 off cupcakes (capped at cupcake subtotal)', 1000, id
from public.product_categories where slug = 'cupcakes'
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Orders: fulfilment, discount, idempotency
-- ---------------------------------------------------------------------------
alter table public.orders add column if not exists delivery_method text;
alter table public.orders add column if not exists delivery_address text;
alter table public.orders add column if not exists discount_cents integer not null default 0;
alter table public.orders add column if not exists discount_code text;
alter table public.orders add column if not exists idempotency_key uuid;
alter table public.orders add column if not exists confirmation_channel text not null default 'instagram';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'orders_delivery_method_check') then
    alter table public.orders add constraint orders_delivery_method_check
      check (delivery_method is null or delivery_method in ('pickup','delivery'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'orders_discount_cents_check') then
    alter table public.orders add constraint orders_discount_cents_check check (discount_cents >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'orders_total_math_check') then
    alter table public.orders add constraint orders_total_math_check
      check (total_cents = subtotal_cents - discount_cents + delivery_fee_cents);
  end if;
end $$;

create unique index if not exists orders_idempotency_key_key on public.orders (idempotency_key) where idempotency_key is not null;
create index if not exists orders_customer_id_idx on public.orders (customer_id);
create index if not exists orders_status_created_idx on public.orders (status, created_at desc);
create index if not exists order_items_order_id_idx on public.order_items (order_id);
create index if not exists order_items_product_id_idx on public.order_items (product_id);
create index if not exists products_category_id_idx on public.products (category_id);
create index if not exists customers_phone_idx on public.customers (phone);

-- ---------------------------------------------------------------------------
-- Status history and payments
-- ---------------------------------------------------------------------------
create table if not exists public.order_status_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  status text not null check (status in ('pending','confirmed','preparing','ready','delivered','cancelled')),
  note text,
  created_at timestamptz not null default now()
);
create index if not exists order_status_events_order_idx on public.order_status_events (order_id, created_at);
alter table public.order_status_events enable row level security;

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  method text not null default 'mpesa' check (method in ('mpesa','cash')),
  amount_cents integer not null check (amount_cents >= 0),
  mpesa_receipt text,
  status text not null default 'pending' check (status in ('pending','received','refunded','failed')),
  received_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists payments_mpesa_receipt_key on public.payments (mpesa_receipt) where mpesa_receipt is not null;
create index if not exists payments_order_idx on public.payments (order_id);
alter table public.payments enable row level security;

create or replace function public.log_order_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.order_status_events (order_id, status) values (new.id, new.status);
  end if;
  return new;
end $$;
revoke all on function public.log_order_status() from public, anon, authenticated;

drop trigger if exists orders_status_history on public.orders;
create trigger orders_status_history after insert or update of status on public.orders
for each row execute function public.log_order_status();

-- ---------------------------------------------------------------------------
-- create_order(): the only write path for customers
-- ---------------------------------------------------------------------------
create or replace function public.create_order(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key uuid;
  v_existing record;
  v_name text;
  v_phone text;
  v_method text;
  v_address text;
  v_notes text;
  v_code text;
  v_discount record;
  v_customer_id uuid;
  v_order_id uuid;
  v_order_number text;
  v_subtotal integer := 0;
  v_discount_base integer := 0;
  v_discount_cents integer := 0;
  v_item jsonb;
  v_product record;
  v_qty integer;
  v_count integer := 0;
  v_recent integer;
  v_items jsonb := '[]'::jsonb;
begin
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'Order payload is required' using errcode = '22023';
  end if;

  -- Idempotency: replaying the same submission returns the original order.
  begin
    v_key := nullif(payload->>'idempotencyKey','')::uuid;
  exception when others then
    raise exception 'Invalid idempotency key' using errcode = '22023';
  end;
  if v_key is null then
    raise exception 'Idempotency key is required' using errcode = '22023';
  end if;

  select o.id, o.order_number, o.subtotal_cents, o.discount_cents, o.delivery_fee_cents, o.total_cents
    into v_existing from public.orders o where o.idempotency_key = v_key;
  if found then
    return jsonb_build_object(
      'orderId', v_existing.id, 'orderNumber', v_existing.order_number,
      'subtotalCents', v_existing.subtotal_cents, 'discountCents', v_existing.discount_cents,
      'deliveryFeeCents', v_existing.delivery_fee_cents, 'totalCents', v_existing.total_cents,
      'items', (select coalesce(jsonb_agg(jsonb_build_object('name', product_name, 'quantity', quantity,
                 'unitPriceCents', unit_price_cents, 'lineTotalCents', line_total_cents) order by created_at), '[]'::jsonb)
                from public.order_items where order_id = v_existing.id),
      'duplicate', true);
  end if;

  -- Customer fields (validated here too, because this is the trust boundary).
  v_name := trim(coalesce(payload->>'fullName',''));
  if char_length(v_name) < 2 or char_length(v_name) > 100 then
    raise exception 'Enter your full name' using errcode = '22023';
  end if;

  v_phone := regexp_replace(coalesce(payload->>'phone',''), '[\s\-()]', '', 'g');
  if v_phone ~ '^\+?254[17]\d{8}$' then
    v_phone := '254' || right(v_phone, 9);
  elsif v_phone ~ '^0[17]\d{8}$' then
    v_phone := '254' || right(v_phone, 9);
  else
    raise exception 'Enter a valid Kenyan mobile number' using errcode = '22023';
  end if;

  v_method := lower(coalesce(payload->>'deliveryMethod',''));
  if v_method not in ('pickup','delivery') then
    raise exception 'Choose pickup or delivery' using errcode = '22023';
  end if;
  v_address := nullif(trim(coalesce(payload->>'deliveryAddress','')), '');
  if v_method = 'delivery' and (v_address is null or char_length(v_address) < 5) then
    raise exception 'Enter a delivery address' using errcode = '22023';
  end if;
  if v_method = 'pickup' then v_address := null; end if;
  if char_length(coalesce(v_address,'')) > 300 then
    raise exception 'Delivery address is too long' using errcode = '22023';
  end if;

  v_notes := nullif(trim(coalesce(payload->>'notes','')), '');
  if char_length(coalesce(v_notes,'')) > 500 then
    raise exception 'Notes are too long' using errcode = '22023';
  end if;

  if jsonb_typeof(payload->'items') <> 'array' or jsonb_array_length(payload->'items') = 0 then
    raise exception 'Add at least one item to your order' using errcode = '22023';
  end if;
  if jsonb_array_length(payload->'items') > 20 then
    raise exception 'Too many different items' using errcode = '22023';
  end if;

  -- Basic abuse limit: at most 5 orders per phone number in 10 minutes.
  select count(*) into v_recent
  from public.orders o join public.customers c on c.id = o.customer_id
  where c.phone = v_phone and o.created_at > now() - interval '10 minutes';
  if v_recent >= 5 then
    raise exception 'Too many orders from this number. Please try again shortly.' using errcode = 'P0429';
  end if;

  insert into public.customers (full_name, phone, delivery_method, delivery_address, notes)
  values (v_name, v_phone, v_method, v_address, v_notes)
  returning id into v_customer_id;

  v_order_number := 'ITT-' || to_char(now() at time zone 'Africa/Nairobi', 'YYMMDD') || '-' ||
                    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 5));

  insert into public.orders (order_number, customer_id, status, subtotal_cents, discount_cents,
    delivery_fee_cents, total_cents, currency, payment_method, notes, delivery_method,
    delivery_address, idempotency_key)
  values (v_order_number, v_customer_id, 'pending', 0, 0, 0, 0, 'KES',
    'mpesa_on_pickup_or_delivery', v_notes, v_method, v_address, v_key)
  returning id into v_order_id;

  v_code := nullif(trim(coalesce(payload->>'discountCode','')), '');
  if v_code is not null then
    select d.* into v_discount from public.discount_codes d
    where lower(d.code) = lower(v_code) and d.is_active
      and (d.starts_at is null or d.starts_at <= now())
      and (d.ends_at is null or d.ends_at > now());
    if not found then
      raise exception 'That discount code isn''t valid' using errcode = '22023';
    end if;
  end if;

  for v_item in select * from jsonb_array_elements(payload->'items') loop
    begin
      v_qty := (v_item->>'quantity')::integer;
    exception when others then
      raise exception 'Invalid item quantity' using errcode = '22023';
    end;
    if v_qty is null or v_qty < 1 or v_qty > 100 then
      raise exception 'Invalid item quantity' using errcode = '22023';
    end if;

    select p.id, p.name, p.price_cents, p.is_active, p.stock, p.category_id into v_product
    from public.products p
    where p.sku = (v_item->>'sku') or p.slug = (v_item->>'sku')
    for update;
    if not found or not v_product.is_active then
      raise exception 'A product in your order is no longer available' using errcode = '22023';
    end if;
    if v_product.stock is not null then
      if v_product.stock < v_qty then
        raise exception 'Only % % left', v_product.stock, v_product.name using errcode = '22023';
      end if;
      update public.products set stock = stock - v_qty, updated_at = now() where id = v_product.id;
    end if;

    insert into public.order_items (order_id, product_id, product_name, unit_price_cents, quantity, line_total_cents)
    values (v_order_id, v_product.id, v_product.name, v_product.price_cents, v_qty, v_product.price_cents * v_qty);

    v_subtotal := v_subtotal + v_product.price_cents * v_qty;
    v_count := v_count + v_qty;
    if v_code is not null and (v_discount.category_id is null or v_discount.category_id = v_product.category_id) then
      v_discount_base := v_discount_base + v_product.price_cents * v_qty;
    end if;
    v_items := v_items || jsonb_build_object('name', v_product.name, 'quantity', v_qty,
      'unitPriceCents', v_product.price_cents, 'lineTotalCents', v_product.price_cents * v_qty);
  end loop;

  if v_count > 300 then
    raise exception 'Order is too large for online pre-order. Please message us on Instagram.' using errcode = '22023';
  end if;

  if v_code is not null then
    if v_discount_base = 0 then
      raise exception 'This code only works on cupcakes — add a cupcake to use it.' using errcode = '22023';
    end if;
    v_discount_cents := least(v_discount.amount_cents, v_discount_base);
  end if;

  update public.orders
     set subtotal_cents = v_subtotal,
         discount_cents = v_discount_cents,
         discount_code = case when v_code is not null then v_discount.code end,
         total_cents = v_subtotal - v_discount_cents,
         updated_at = now()
   where id = v_order_id;

  return jsonb_build_object(
    'orderId', v_order_id, 'orderNumber', v_order_number,
    'subtotalCents', v_subtotal, 'discountCents', v_discount_cents,
    'deliveryFeeCents', 0, 'totalCents', v_subtotal - v_discount_cents,
    'items', v_items, 'duplicate', false);
exception
  when unique_violation then
    -- Concurrent replay of the same idempotency key.
    raise exception 'This order was already submitted' using errcode = '23505';
end;
$$;

-- The Vercel function at /api/create-order calls this with the project's publishable
-- (anon) key, kept server-side as an env var. anon still has NO table access to
-- customers/orders/items/payments: this validated function is its only write path,
-- and it can only ever return the order it just created. The service-role key is
-- therefore not needed by the website at all.
revoke all on function public.create_order(jsonb) from public, authenticated;
grant execute on function public.create_order(jsonb) to anon, service_role;

-- Read-only discount preview (no code list is exposed; only a yes/no for a given code).
create or replace function public.check_discount_code(p_code text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(
    (select jsonb_build_object('valid', true, 'amountCents', d.amount_cents, 'category', c.slug)
       from public.discount_codes d left join public.product_categories c on c.id = d.category_id
      where lower(d.code) = lower(trim(p_code)) and d.is_active
        and (d.starts_at is null or d.starts_at <= now())
        and (d.ends_at is null or d.ends_at > now())),
    jsonb_build_object('valid', false));
$$;
revoke all on function public.check_discount_code(text) from public, authenticated;
grant execute on function public.check_discount_code(text) to anon, service_role;
