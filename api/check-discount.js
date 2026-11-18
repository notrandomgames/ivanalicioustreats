import { json, readJson, rpc } from './_lib/supabase.js';

export async function POST(request) {
  const { body, error: bad } = await readJson(request);
  if (bad) return bad;
  const code = String(body?.code ?? '').trim().slice(0, 40);
  if (!code) return json({ valid: false, error: 'Enter a code first.' }, 400);

  const result = await rpc('check_discount_code', { p_code: code });
  if (result.error) return json({ valid: false, error: 'Could not check the code right now.' }, result.status);
  if (!result.data?.valid) return json({ valid: false, error: "That code isn't valid." });
  return json({ valid: true, amountCents: result.data.amountCents, category: result.data.category });
}

export function GET() {
  return json({ error: 'Method not allowed' }, 405);
}
