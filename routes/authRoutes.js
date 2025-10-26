const express = require('express');
const router = express.Router();
const passport = require('passport');
const { signup, login } = require('../controllers/authController');
const { env, isGoogleConfigured, getGoogleConfigStatus } = require('../config/env');

// POST /api/auth/signup
router.post('/signup', signup);

// POST /api/auth/login
router.post('/login', login);

// Google OAuth endpoints only if configured
if (isGoogleConfigured()) {
  const frontend = (env.FRONTEND_URL || env.CLIENT_URL || 'http://localhost:5173').replace(/\/$/, '');
  const failureRedirect = `${frontend}/login?auth=google&ok=0`;

  const googleOptions = { scope: ['openid','email','profile'], prompt: 'select_account', accessType: 'offline' };
  router.get('/google', (req, res, next) => {
    console.log('[oauth] start /google');
    const original = res.redirect.bind(res);
    res.redirect = (url, ...args) => { console.log('[oauth] redirecting to:', url); return original(url, ...args); };
    next();
  }, passport.authenticate('google', googleOptions));
  router.get('/google/callback', passport.authenticate('google', { failureRedirect, session: true }), (req, res) => {
    // On success, redirect to frontend dashboard
    return res.redirect(`${frontend}/dashboard?auth=google&ok=1`);
  });
}

// Status endpoint always available
router.get('/google/status', (_req,res) => {
  const status = getGoogleConfigStatus();
  if (!status.enabled) {
    // Provide additional diagnostics (masked) so frontend devs can see lengths
    status.diagnostics = {
      clientIdLength: (process.env.GOOGLE_CLIENT_ID||'').length,
      secretLength: (process.env.GOOGLE_CLIENT_SECRET||'').length,
      attemptedEnvFiles: require('../config/env').attempted?.filter(a=>a.loaded).map(a=>a.file) || []
    };
  }
  res.json(status);
});

module.exports = router;
