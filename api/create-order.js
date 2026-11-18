import { json, readJson, rpc } from './_lib/supabase.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SKU = /^[a-z0-9-]{2,60}$/;
const str = (v, max) => String(v ?? '').trim().slice(0, max);

export function validateOrder(body) {
  const fullName = str(body?.fullName, 200);
  const phone = String(body?.phone ?? '').replace(/[\s\-()]/g, '');
  const deliveryMethod = str(body?.deliveryMethod, 20).toLowerCase();
  const deliveryAddress = str(body?.deliveryAddress, 400);
  const notes = str(body?.notes, 600);
  const discountCode = str(body?.discountCode, 40);
  const idempotencyKey = str(body?.idempotencyKey, 40);

  const merged = new Map();
  if (Array.isArray(body?.items)) {
    for (const item of body.items.slice(0, 50)) {
      const sku = str(item?.sku, 60).toLowerCase();
      const quantity = Number(item?.quantity);
      if (!SKU.test(sku) || !Number.isInteger(quantity) || quantity < 1 || quantity > 100) continue;
      merged.set(sku, Math.min(100, (merged.get(sku) || 0) + quantity));
    }
  }
  const items = [...merged].map(([sku, quantity]) => ({ sku, quantity }));

  const fieldErrors = {};
  if (fullName.length < 2 || fullName.length > 100) fieldErrors.name = 'Please add your name so we can confirm your order.';
  if (!/^(?:\+?254|0)[17]\d{8}$/.test(phone)) fieldErrors.phone = 'Enter a valid Kenyan mobile number, e.g. 0712 345 678.';
  if (!['pickup', 'delivery'].includes(deliveryMethod)) fieldErrors.fulfil = 'Choose pickup or delivery.';
  if (deliveryMethod === 'delivery' && deliveryAddress.length < 5) fieldErrors.addr = 'Please add a delivery address (estate, building, landmark).';
  if (deliveryAddress.length > 300) fieldErrors.addr = 'Delivery address is too long.';
  if (notes.length > 500) fieldErrors.notes = 'Notes are too long (500 characters max).';

  let error = null;
  if (!UUID.test(idempotencyKey)) error = 'Please refresh the page and try again.';
  else if (!items.length) error = 'Add at least one item to your order.';
  else if (Object.keys(fieldErrors).length) error = 'Please fix the highlighted fields.';

  return {
    error, fieldErrors,
    payload: {
      idempotencyKey, fullName, phone, deliveryMethod,
      deliveryAddress: deliveryMethod === 'delivery' ? deliveryAddress : null,
      notes: notes || null, discountCode: discountCode || null, items
    }
  };
}

export async function POST(request) {
  const { body, error: bad } = await readJson(request);
  if (bad) return bad;

  const { error, fieldErrors, payload } = validateOrder(body);
  if (error) return json({ error, fieldErrors }, 400);

  const result = await rpc('create_order', { payload });
  if (result.error) return json({ error: result.error }, result.status);
  return json(result.data, result.data?.duplicate ? 200 : 201);
}

export function GET() {
  return json({ error: 'Method not allowed' }, 405);
}
