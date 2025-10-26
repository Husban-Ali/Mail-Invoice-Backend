const { createClient } = require('@supabase/supabase-js');
const { env } = require('./env');

const SUPABASE_URL = env.SUPABASE_URL;
const usingServiceRole = !!env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY;

function looksLikeJwt(key){
  return typeof key === 'string' && key.split('.').length >= 3 && key.length > 20;
}

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Supabase env vars missing. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

if (!looksLikeJwt(SUPABASE_SERVICE_ROLE_KEY)) {
  console.warn('[supabase] The provided API key does not look like a valid JWT. Double-check your SUPABASE_SERVICE_ROLE_KEY (preferred) or SUPABASE_ANON_KEY in Backend/.env.');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  // optionally adjust fetch or other client options
});

if (!usingServiceRole) {
  console.warn('[supabase] WARNING: SERVICE_ROLE_KEY missing. Falling back to ANON key; RLS-protected inserts/updates may fail.');
}

module.exports = supabase;
