-- 0004: pin search_path on the updated_at trigger helper (Supabase advisor 0011).
alter function public.set_updated_at() set search_path = public;
revoke all on function public.set_updated_at() from public, anon, authenticated;

comment on table public.discount_codes is 'RLS on, no policies: deny-all to anon/authenticated by design. Read only via check_discount_code()/create_order().';
comment on table public.payments is 'RLS on, no policies: deny-all to anon/authenticated by design. Managed by staff via dashboard/service role.';
comment on table public.order_status_events is 'RLS on, no policies: deny-all by design. Written by trigger on orders.status.';
comment on function public.create_order(jsonb) is 'Sole customer write path. SECURITY DEFINER executable by anon by design: validates all input, prices from products, idempotent, rate-limited, returns only the created order.';
