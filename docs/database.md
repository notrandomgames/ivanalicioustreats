# Ivanalicious Treats — database

Supabase project: `ivanalicioustreats` (ref `mizibismrtpscmedleco`, region ap-south-1).
Migrations live in `supabase/migrations/` and are applied in order.

## Tables

| Table | Purpose | Key relationships |
|---|---|---|
| `product_categories` | Menu sections (cupcakes, cookies). | — |
| `products` | Catalog. `sku` matches the ids used by the site (`cu1`…`co5`). Prices are integer cents (KES). Optional `stock` (null = unlimited). | `category_id → product_categories` |
| `discount_codes` | Server-side discount codes (e.g. `M.OLISE`, KES 10 off cupcakes). Never readable by the browser. | `category_id → product_categories` |
| `customers` | Name, normalised phone (`2547XXXXXXXX`), fulfilment details for each order. | — |
| `orders` | Order number (`ITT-YYMMDD-XXXXX`), status, subtotal/discount/total, fulfilment, payment method, `idempotency_key`. | `customer_id → customers` |
| `order_items` | Line items with the authoritative unit price at time of order. | `order_id → orders`, `product_id → products` |
| `order_status_events` | Automatic status history (trigger on `orders.status`). | `order_id → orders` |
| `payments` | M-Pesa receipts recorded against orders (unique receipt). | `order_id → orders` |

Constraints include: non-negative money columns, `total = subtotal − discount + delivery_fee`,
status/fulfilment enums, unique order numbers, unique idempotency keys, unique M-Pesa receipts.

## Security model

- RLS is enabled on every table.
- `anon` may only `SELECT` active products and categories.
- `anon` has no read or write access to customers, orders, order items, payments, status events or discount codes.
- The website writes orders exclusively through `create_order(jsonb)`, a `SECURITY DEFINER` function that:
  - validates name, Kenyan phone number, fulfilment, address, notes and items;
  - looks up every price in `products` (client prices are ignored) and checks/decrements stock;
  - validates the discount code and computes the discount;
  - is idempotent: the same `idempotencyKey` returns the original order instead of creating a duplicate;
  - limits each phone number to 5 orders per 10 minutes;
  - runs in a single transaction (no partial orders);
  - returns only the order it just created.
- `check_discount_code(text)` returns only valid/invalid for one code; the code list is never exposed.
- The browser never talks to Supabase directly. The Vercel Functions in `api/` call these RPCs using the
  publishable key stored as a Vercel environment variable. The service-role key is not used by the website.

## Order lifecycle

1. Customer builds an order ticket and submits the form.
2. `/api/create-order` validates the payload and calls `create_order`.
3. The order is stored as `pending` and an order reference is returned.
4. The site copies the order (with reference) and opens Instagram DM to @ivanalicioustreats for confirmation.
5. Staff update `orders.status` (confirmed → preparing → ready → delivered / cancelled) in the Supabase
   dashboard; each change is logged in `order_status_events`.
6. Payment is M-Pesa on pickup/delivery; record the receipt in `payments` (and `orders.payment_reference`).

## Viewing orders

Supabase dashboard → Table Editor → `orders`, or SQL:

```sql
select o.order_number, o.status, o.total_cents / 100 as total_kes, c.full_name, c.phone,
       o.delivery_method, o.created_at
from orders o join customers c on c.id = o.customer_id
order by o.created_at desc;
```

## Environment variables (Vercel)

| Name | Environments | Notes |
|---|---|---|
| `SUPABASE_URL` | Production, Preview | Project REST URL. |
| `SUPABASE_PUBLISHABLE_KEY` | Production, Preview | Encrypted; used only by server functions. |

Never commit `.env` files or keys.
