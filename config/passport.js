const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { env, isGoogleConfigured, getGoogleConfigStatus } = require('./env');

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = env;
const runtimePort = env.PORT || 3000;
const callbackURL = env.GOOGLE_CALLBACK_URL || `http://localhost:${runtimePort}/api/auth/google/callback`;

if (isGoogleConfigured()) {
	passport.use(new GoogleStrategy({ clientID: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET, callbackURL },
		async (_accessToken, _refreshToken, profile, done) => {
			try { return done(null, { provider: 'google', profile }); }
			catch (e) { return done(e); }
		}));
	console.log('[passport] Google strategy enabled -> callback:', callbackURL, 'clientIdLen:', (GOOGLE_CLIENT_ID||'').length, 'secretLen:', (GOOGLE_CLIENT_SECRET||'').length);
} else {
	const status = getGoogleConfigStatus();
	console.warn('[passport] Google auth disabled. Missing vars:', status.missing, 'clientIdLen:', (GOOGLE_CLIENT_ID||'').length, 'secretLen:', (GOOGLE_CLIENT_SECRET||'').length);
}

module.exports = passport;

