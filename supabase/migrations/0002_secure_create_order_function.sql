-- Transactional, server-side order creation.
-- The browser sends product IDs and quantities only; the database supplies prices.
create or replace function public.create_order(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_id uuid;
  v_order_id uuid;
  v_order_number text;
  v_subtotal integer := 0;
  v_delivery_fee integer := 0;
  v_item jsonb;
  v_product record;
  v_quantity integer;
  v_delivery_method text;
  v_delivery_address text;
begin
  if payload is null then
    raise exception 'Order payload is required';
  end if;

  v_delivery_method := lower(coalesce(payload->>'deliveryMethod', ''));
  if v_delivery_method not in ('pickup', 'delivery') then
    raise exception 'Invalid delivery method';
  end if;

  v_delivery_address := nullif(trim(coalesce(payload->>'deliveryAddress', '')), '');
  if v_delivery_method = 'delivery' and v_delivery_address is null then
    raise exception 'Delivery address is required for delivery orders';
  end if;

  if jsonb_typeof(payload->'items') <> 'array' or jsonb_array_length(payload->'items') = 0 then
    raise exception 'Order must contain at least one item';
  end if;

  insert into public.customers (full_name, phone, email, delivery_method, delivery_address, notes)
  values (
    trim(payload->>'fullName'),
    trim(payload->>'phone'),
    nullif(trim(coalesce(payload->>'email', '')), ''),
    v_delivery_method,
    v_delivery_address,
    nullif(trim(coalesce(payload->>'notes', '')), '')
  )
  returning id into v_customer_id;

  v_order_number := 'ITT-' || to_char(now(), 'YYYYMMDD') || '-' ||
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));

  insert into public.orders (
    order_number, customer_id, status, subtotal_cents, delivery_fee_cents,
    total_cents, currency, payment_method, notes
  ) values (
    v_order_number,
    v_customer_id,
    'pending',
    0,
    v_delivery_fee,
    0,
    'KES',
    'mpesa_on_pickup_or_delivery',
    nullif(trim(coalesce(payload->>'notes', '')), '')
  )
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(payload->'items') loop
    v_quantity := (v_item->>'quantity')::integer;

    if v_quantity is null or v_quantity < 1 or v_quantity > 50 then
      raise exception 'Invalid item quantity';
    end if;

    select id, name, price_cents, is_active, stock
    into v_product
    from public.products
    where id = (v_item->>'productId')::uuid;

    if not found or not v_product.is_active then
      raise exception 'Product is unavailable';
    end if;

    if v_product.stock is not null and v_product.stock < v_quantity then
      raise exception 'Insufficient stock for %', v_product.name;
    end if;

    insert into public.order_items (
      order_id, product_id, product_name, unit_price_cents, quantity, line_total_cents
    ) values (
      v_order_id,
      v_product.id,
      v_product.name,
      v_product.price_cents,
      v_quantity,
      v_product.price_cents * v_quantity
    );

    v_subtotal := v_subtotal + (v_product.price_cents * v_quantity);
  end loop;

  update public.orders
  set subtotal_cents = v_subtotal,
      total_cents = v_subtotal + v_delivery_fee
  where id = v_order_id;

  return jsonb_build_object(
    'orderId', v_order_id,
    'orderNumber', v_order_number,
    'subtotalCents', v_subtotal,
    'deliveryFeeCents', v_delivery_fee,
    'totalCents', v_subtotal + v_delivery_fee
  );
end;
$$;

revoke execute on function public.create_order(jsonb) from anon, authenticated;
grant execute on function public.create_order(jsonb) to service_role;
