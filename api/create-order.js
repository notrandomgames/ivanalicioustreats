const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const JSON_HEADERS = { 'content-type': 'application/json' };

function badRequest(message, details) {
  return Response.json({ error: message, details }, { status: 400, headers: JSON_HEADERS });
}

function serverError(message) {
  return Response.json({ error: message }, { status: 500, headers: JSON_HEADERS });
}

function normalizeItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => ({
      productId: typeof item?.productId === 'string' ? item.productId.trim() : '',
      quantity: Number(item?.quantity)
    }))
    .filter((item) => item.productId && Number.isInteger(item.quantity) && item.quantity > 0);
}

export default async function handler(request) {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers: JSON_HEADERS });
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return serverError('Order service is not configured.');
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest('Invalid JSON body.');
  }

  const fullName = String(body?.fullName ?? '').trim();
  const phone = String(body?.phone ?? '').trim();
  const email = String(body?.email ?? '').trim();
  const deliveryMethod = String(body?.deliveryMethod ?? '').trim().toLowerCase();
  const deliveryAddress = String(body?.deliveryAddress ?? '').trim();
  const notes = String(body?.notes ?? '').trim();
  const items = normalizeItems(body?.items);

  const errors = {};
  if (fullName.length < 2 || fullName.length > 100) errors.fullName = 'Enter your full name.';
  if (!/^(?:\+?254|0)(?:7|1)\d{8}$/.test(phone.replace(/\s+/g, ''))) errors.phone = 'Enter a valid Kenyan mobile number.';
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'Enter a valid email address.';
  if (!['pickup', 'delivery'].includes(deliveryMethod)) errors.deliveryMethod = 'Choose pickup or delivery.';
  if (deliveryMethod === 'delivery' && deliveryAddress.length < 8) errors.deliveryAddress = 'Enter a delivery address.';
  if (!items.length) errors.items = 'Add at least one item to your order.';

  if (Object.keys(errors).length) {
    return Response.json({ error: 'Please correct the highlighted fields.', fieldErrors: errors }, { status: 400, headers: JSON_HEADERS });
  }

  const payload = {
    fullName,
    phone: phone.replace(/\s+/g, ''),
    email: email || null,
    deliveryMethod,
    deliveryAddress: deliveryMethod === 'delivery' ? deliveryAddress : null,
    notes: notes || null,
    items
  };

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/create_order`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_ROLE_KEY,
        authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const text = await response.text();
    let result;
    try {
      result = text ? JSON.parse(text) : null;
    } catch {
      result = null;
    }

    if (!response.ok) {
      const message = result?.message || 'We could not save your order. Please try again.';
      return Response.json({ error: message }, { status: response.status === 400 ? 400 : 502, headers: JSON_HEADERS });
    }

    return Response.json(result, { status: 201, headers: JSON_HEADERS });
  } catch {
    return serverError('Order service is temporarily unavailable.');
  }
}
