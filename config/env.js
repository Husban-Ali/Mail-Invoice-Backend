const path = require('path');
const dotenv = require('dotenv');

function load(p){
  const res = dotenv.config({ path: p, override:false });
  return { file:p, loaded: !res.error };
}
const attempted = [];
// Load root .env then Backend/.env (second can override if variables not already set externally)
attempted.push(load(path.resolve(__dirname, '..', '.env')));
attempted.push(load(path.resolve(__dirname, '.env')));


// Required application (non-optional) environment variables
const required = ['SUPABASE_URL','SUPABASE_ANON_KEY'];
const missing = required.filter(k=>!process.env[k]);

// Trim values to avoid stray whitespace issues (Google + Supabase)
['GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','GOOGLE_CALLBACK_URL','SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','RESEND_API_KEY','EMAIL_FROM'].forEach(k=>{
  if (process.env[k]) process.env[k] = process.env[k].trim();
});
const googleVars = ['GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET'];
const googleMissing = googleVars.filter(k=>!process.env[k]);
const isGoogleConfigured = () => googleMissing.length === 0; // callback is optional; has a default

function getGoogleConfigStatus(){
  return {
    enabled: isGoogleConfigured(),
    missing: googleMissing,
    clientIdPresent: !!process.env.GOOGLE_CLIENT_ID,
    secretPresent: !!process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:8080/api/auth/google/callback'
  };
}

module.exports = {
  env: process.env,
  missing,
  attempted,
  googleMissing,
  isGoogleConfigured,
  getGoogleConfigStatus
};

// One-time snapshot log (redacted sensitive values) to confirm load success
if (!process.env.__ENV_SNAPSHOT_LOGGED) {
  const redact = (val, key) => {
    if (!val) return 'MISSING';
    if (/KEY|SECRET|TOKEN|PASSWORD/i.test(key)) return `${key}(${val.length} chars)`;
    return val;
  };
  const keysToShow = [
    'SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY',
    'GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','GOOGLE_CALLBACK_URL','PORT',
    'RESEND_API_KEY','EMAIL_FROM'
  ];
  const snapshot = {};
  keysToShow.forEach(k=> snapshot[k] = redact(process.env[k], k));
  console.log('[env] snapshot', snapshot);
  process.env.__ENV_SNAPSHOT_LOGGED = '1';
}
