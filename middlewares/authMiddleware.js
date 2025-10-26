const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
// Load env from both root and Backend
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env'), override: true });
dotenv.config({ path: path.resolve(__dirname, '..', '.env'), override: true });

let supabase;
function getSupabase() {
  if (!supabase) {
    const url = process.env.SUPABASE_URL;
    const anon = process.env.SUPABASE_ANON_KEY;
    if (!url || !anon) throw new Error('Supabase env vars missing for auth middleware');
    supabase = createClient(url, anon);
  }
  return supabase;
}

const protectRoute = async (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const { data: { user }, error } = await getSupabase().auth.getUser(token);

  if (error || !user) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  req.user = user;
  next();
};

module.exports = protectRoute;
