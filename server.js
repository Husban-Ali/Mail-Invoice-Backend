const { env, missing, getGoogleConfigStatus, attempted } = require('./config/env');
if (missing.length) {
  console.warn('[env] Missing required vars:', missing);
}
const googleStatus = getGoogleConfigStatus();
console.log('[startup] Env summary:', {
  supabaseUrl: !!env.SUPABASE_URL,
  supabaseAnon: !!env.SUPABASE_ANON_KEY,
  google: googleStatus.enabled,
  attempted: attempted.filter(a=>a.loaded).map(a=>a.file)
});
const app = require('./app');
// NEW: Core Flow Implementation - start background scheduler
try {
  const { startScheduler } = require('./services/scheduler.service');
  startScheduler();
} catch (e) {
  console.warn('[startup] scheduler not started:', e && e.message);
}

const PORT = process.env.PORT || 3000;

// Export for Vercel serverless
module.exports = app;

// Only start server if not in Vercel environment
if (process.env.VERCEL !== '1') {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}
