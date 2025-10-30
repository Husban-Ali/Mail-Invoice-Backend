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
  router.get('/google/callback', passport.authenticate('google', { failureRedirect, session: true }), async (req, res) => {
    try {
      // Get user info from Google OAuth
      const googleProfile = req.user?.profile;
      if (!googleProfile || !googleProfile.emails || !googleProfile.emails[0]) {
        console.error('[oauth] No email in Google profile');
        return res.redirect(failureRedirect);
      }

      const email = googleProfile.emails[0].value;
      const name = googleProfile.displayName || email.split('@')[0];
      
      // Create or sign in user in Supabase
      const { getOrCreateGoogleUser } = require('../models/userModel');
      const session = await getOrCreateGoogleUser(email, name, googleProfile);
      
      if (!session || !session.access_token) {
        console.error('[oauth] Failed to create session');
        return res.redirect(failureRedirect);
      }

      // Encode session as base64 to pass via URL
      const sessionToken = Buffer.from(JSON.stringify(session)).toString('base64');
      return res.redirect(`${frontend}/dashboard?auth=google&ok=1&token=${sessionToken}`);
    } catch (error) {
      console.error('[oauth] Callback error:', error);
      return res.redirect(failureRedirect);
    }
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
