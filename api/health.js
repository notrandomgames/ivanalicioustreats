import { json } from './_lib/supabase.js';

// Reports only whether configuration is present, never the values.
export function GET() {
  return json({
    ok: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_PUBLISHABLE_KEY),
    supabaseConfigured: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_PUBLISHABLE_KEY)
  });
}
