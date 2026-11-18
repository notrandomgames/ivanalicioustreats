// Server-only Supabase RPC helper. Runs inside Vercel Functions; never shipped to the browser.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;

export const MAX_BODY_BYTES = 10_000;

export function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }
  });
}

export async function readJson(request) {
  if (request.method !== 'POST') return { error: json({ error: 'Method not allowed' }, 405) };
  const type = request.headers.get('content-type') || '';
  if (!type.includes('application/json')) return { error: json({ error: 'Expected JSON.' }, 415) };
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return { error: json({ error: 'Request too large.' }, 413) };
  try {
    return { body: JSON.parse(text) };
  } catch {
    return { error: json({ error: 'Invalid JSON body.' }, 400) };
  }
}

const STATUS_BY_CODE = { '22023': 400, '22P02': 400, P0429: 429, '23505': 409 };

export async function rpc(fn, args) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error(`[${fn}] Missing SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY`);
    return { status: 503, error: 'Ordering is temporarily unavailable. Please message us on Instagram.' };
  }
  let response;
  try {
    response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, authorization: `Bearer ${SUPABASE_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(8000)
    });
  } catch (err) {
    console.error(`[${fn}] network error`, err?.name);
    return { status: 503, error: 'Our order service is temporarily unavailable. Please try again.' };
  }
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (response.ok) return { status: 200, data };

  const code = data?.code;
  const mapped = STATUS_BY_CODE[code];
  if (mapped) return { status: mapped, error: data?.message || 'Please check your order and try again.' };
  // Unknown database errors: log the code only (no customer data) and return a generic message.
  console.error(`[${fn}] supabase error`, response.status, code);
  return { status: 502, error: 'We could not save your order. Please try again.' };
}
