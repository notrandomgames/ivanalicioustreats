-- 0005: fix create_order() failing for orders without a discount code
-- (PL/pgSQL read an unassigned RECORD). Uses scalar variables instead.

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
  v_discount_id uuid;
  v_discount_code text;
  v_discount_amount integer;
  v_discount_category uuid;
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
    select d.id, d.code, d.amount_cents, d.category_id
      into v_discount_id, v_discount_code, v_discount_amount, v_discount_category
      from public.discount_codes d
    where lower(d.code) = lower(v_code) and d.is_active
      and (d.starts_at is null or d.starts_at <= now())
      and (d.ends_at is null or d.ends_at > now());
    if v_discount_id is null then
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
    if v_code is not null and (v_discount_category is null or v_discount_category = v_product.category_id) then
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
    v_discount_cents := least(v_discount_amount, v_discount_base);
  end if;

  update public.orders
     set subtotal_cents = v_subtotal,
         discount_cents = v_discount_cents,
         discount_code = v_discount_code,
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

revoke all on function public.create_order(jsonb) from public, authenticated;
grant execute on function public.create_order(jsonb) to anon, service_role;
