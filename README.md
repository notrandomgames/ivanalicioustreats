# ivanalicioustreats

Pre-order storefront for **Ivanalicious Treats** — homemade cupcakes and cookies in Nairobi.
Customers build an order ticket, the order is saved to Supabase, then confirmed via Instagram
DM (@ivanalicioustreats) and paid by M-Pesa on pickup/delivery.

## Structure

```
index.html              Page markup
assets/css/styles.css   Styles (gingham theme)
assets/js/app.js        Menu, order ticket, checkout, Instagram hand-off
assets/img/             Product photos
api/create-order.js     Vercel Function: validate + save order (Supabase RPC)
api/check-discount.js   Vercel Function: validate a discount code
api/health.js           Vercel Function: config health check (no secrets)
api/_lib/supabase.js    Shared server-only Supabase helper
supabase/migrations/    Database schema, RLS, functions
docs/database.md        Schema, security model, order lifecycle
tests/                  Node test runner tests (`npm test`)
```

## Hosting

- Vercel project `ivanalicioustreats`, connected to this GitHub repo. Pushes to the production
  branch deploy to production; other branches get preview deployments.
- No build step (static files + Node functions). Node 20+.
- Required environment variables are listed in `docs/database.md`.

## Managing the menu

Product names/prices shown on the site live in `assets/js/app.js`; the authoritative prices used for
orders live in the Supabase `products` table. Change both together (match on `sku`).
To pause a product, set `products.is_active = false`; to cap quantities, set `products.stock`.
