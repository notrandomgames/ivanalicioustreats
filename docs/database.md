# Ivanalicious Treats database

The Supabase project `ivanalicioustreats` stores the product catalog, customer contact details, orders, and order line items.

## Tables

| Table | Purpose |
|---|---|
| `product_categories` | Menu categories, such as cupcakes. |
| `products` | Individual products, prices in Kenyan shillings stored as integer cents, availability, and optional stock. |
| `customers` | Customer contact and fulfilment details. |
| `orders` | Order totals, status, payment method/reference, and notes. |
| `order_items` | Individual ordered products, authoritative unit price, quantity, and line total. |

## Security model

- Row Level Security is enabled on every table.
- Anonymous visitors can read active product and category records only.
- Anonymous visitors cannot select, insert, update, or delete customer, order, or order-item records.
- The Vercel serverless endpoint uses the Supabase service-role key exclusively on the server.
- `create_order(jsonb)` is a `security definer` function and execute permission is revoked from `anon` and `authenticated`; only `service_role` may execute it.
- The function recalculates all prices from `products`, so a malicious browser cannot submit forged prices or totals.
- Orders are created in a single database transaction, preventing partial customer/order/item records.

## Order lifecycle

1. Customer submits the order through `/api/create-order`.
2. The API validates contact and delivery fields.
3. The database validates product availability, quantity, and stock.
4. The database creates the customer, order, and items atomically.
5. The order starts as `pending`.
6. Payment remains M-Pesa on pickup/delivery, preserving the existing business workflow; a payment reference can be recorded later.

## Environment variables

Configure these in Vercel, never in Git:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

The browser must never receive the service-role key.
