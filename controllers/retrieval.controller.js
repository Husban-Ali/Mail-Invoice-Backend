const supabase = require('../config/supabaseClient');
const { fetchInvoicesViaImap } = require('../services/imap.service');
// NEW: Core Flow Implementation - add storage/backfill config and scheduler-friendly frequency

function getUserId(req){ return req.user && req.user.id ? req.user.id : null; }

// Storage model:
// - app_settings (key text primary key, value jsonb, updated_at timestamptz)
// If the table is missing or RLS blocks, we fallback to in-memory defaults per request.

const DEFAULTS = {
  enabled: false,
  config: {
    fileTypes: ['pdf'],
    frequency: 'manual', // manual|daily|weekly|monthly|every15|every30|hourly
    nextRun: '-',
    storage: 'supabase', // supabase|gdrive|onedrive
    backfill: {
      startDate: null,
      endDate: null,
      emailLimit: 500,
    },
  }
};

// Graceful degradation if tables are not present
const SETTINGS_TABLE = 'app_settings';
const LOGS_TABLE = 'retrieval_logs';
let settingsStorageAvailable = true;
let logsStorageAvailable = true;
let settingsMissingLogged = false;
let logsMissingLogged = false;

function isMissingTableError(err) {
  const msg = (err && (err.message || err.toString()))?.toLowerCase?.() || '';
  return msg.includes("schema cache") || msg.includes("does not exist") || msg.includes("not find the table");
}

async function readSettings(req) {
  try {
    if (!settingsStorageAvailable) return { ...DEFAULTS };
    const userId = getUserId(req);
    let q = supabase
      .from(SETTINGS_TABLE)
      .select('*')
      .eq('key', 'dataRetrieval');
    if (userId) q = q.eq('user_id', userId);
    const { data, error } = await q.single();
    if (error || !data) return { ...DEFAULTS };
    return { ...DEFAULTS, ...(data.value || {}) };
  } catch (e) {
    if (isMissingTableError(e)) {
      settingsStorageAvailable = false;
      if (!settingsMissingLogged) {
        console.warn(`[retrieval] settings table missing: public.${SETTINGS_TABLE}`);
        settingsMissingLogged = true;
      }
    }
    return { ...DEFAULTS };
  }
}

async function writeSettings(value, req) {
  if (!settingsStorageAvailable) return false;
  try {
    const userId = getUserId(req);
    const row = { key: 'dataRetrieval', user_id: userId, value, updated_at: new Date().toISOString() };
    const { error } = await supabase
      .from(SETTINGS_TABLE)
      .upsert(row, { onConflict: 'key,user_id' });
    if (error) throw new Error(error.message);
    return true;
  } catch (e) {
    if (isMissingTableError(e)) {
      settingsStorageAvailable = false;
      if (!settingsMissingLogged) {
        console.warn(`[retrieval] settings table missing: public.${SETTINGS_TABLE}`);
        settingsMissingLogged = true;
      }
    } else {
      console.warn('[retrieval] writeSettings failed:', e.message);
    }
    return false;
  }
}

// GET /api/retrieval/status
async function getStatus(req, res) {
  const settings = await readSettings(req);
  return res.json({ enabled: !!settings.enabled });
}

// POST /api/retrieval/status { enabled }
async function setStatus(req, res) {
  const { enabled } = req.body || {};
  const settings = await readSettings(req);
  settings.enabled = !!enabled;
  await writeSettings(settings, req);
  return res.json({ enabled: settings.enabled });
}

// GET /api/retrieval/config
async function getConfig(req, res) {
  const settings = await readSettings(req);
  // ensure defaults for new fields
  const cfg = { ...DEFAULTS.config, ...(settings.config || {}) };
  if (!cfg.backfill) cfg.backfill = { ...DEFAULTS.config.backfill };
  if (!cfg.storage) cfg.storage = DEFAULTS.config.storage;
  return res.json(cfg);
}

// POST /api/retrieval/config { fileTypes, frequency, nextRun }
async function setConfig(req, res) {
  const { fileTypes, frequency, nextRun, storage, backfill } = req.body || {};
  const settings = await readSettings(req);
  const prev = settings.config || DEFAULTS.config;
  const mergedBackfill = {
    startDate: backfill?.startDate ?? prev.backfill?.startDate ?? DEFAULTS.config.backfill.startDate,
    endDate: backfill?.endDate ?? prev.backfill?.endDate ?? DEFAULTS.config.backfill.endDate,
    emailLimit: Number(backfill?.emailLimit ?? prev.backfill?.emailLimit ?? DEFAULTS.config.backfill.emailLimit)
  };
  settings.config = {
    fileTypes: Array.isArray(fileTypes) ? fileTypes : (prev.fileTypes || DEFAULTS.config.fileTypes),
    frequency: frequency || prev.frequency || DEFAULTS.config.frequency,
    nextRun: nextRun || prev.nextRun || DEFAULTS.config.nextRun,
    storage: storage || prev.storage || DEFAULTS.config.storage,
    backfill: mergedBackfill,
  };
  await writeSettings(settings, req);
  return res.json(settings.config);
}

// POST /api/retrieval/run -> trigger immediate scan for all viable accounts
async function runNow(req, res) {
  try {
    const userId = getUserId(req);
    let aq = supabase
      .from('accounts')
      .select('*')
      .order('created_at', { ascending: false });
    if (userId) aq = aq.eq('user_id', userId);
    const { data: accounts, error } = await aq;
    if (error) return res.status(500).json({ error: error.message });

    // NEW: Core Flow Implementation - compute sinceDays from backfill.startDate if provided
    const settings = await readSettings(req);
    const cfg = settings.config || DEFAULTS.config;
    const sinceDays = (() => {
      const s = cfg.backfill?.startDate ? new Date(cfg.backfill.startDate) : null;
      if (!s) return null;
      const ms = Date.now() - s.getTime();
      return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
    })();
    const unseenOnly = true;

    const results = [];
    for (const acc of (accounts || [])) {
      const m = acc.meta || {};
      if (!m.host || !m.port || !m.password) {
        results.push({ accountId: acc.id, email: acc.email, ok: false, error: 'Missing IMAP meta' });
        continue;
      }
      try {
        const invoices = await fetchInvoicesViaImap({
          host: m.host,
          port: m.port,
          user: acc.email,
          password: m.password,
          tls: m.tls !== undefined ? m.tls : true,
          accountId: acc.id,
          userId, // NEW: pass user ownership
          folder: 'INBOX',
          unseenOnly,
          sinceDays: sinceDays ?? 7,
          // NEW: Core Flow Implementation - pass through storage and fileTypes so service can honor config
          storage: cfg.storage,
          fileTypes: Array.isArray(cfg.fileTypes) ? cfg.fileTypes : DEFAULTS.config.fileTypes,
        });
        results.push({ accountId: acc.id, email: acc.email, ok: true, fetched: invoices.length });
        // write a log record if table exists
        try {
          if (logsStorageAvailable) {
            const { error } = await supabase.from(LOGS_TABLE).insert({ user_id: userId, account_id: acc.id, email: acc.email, status: 'ok', fetched: invoices.length, created_at: new Date().toISOString() });
            if (error) throw new Error(error.message);
          }
        } catch (e) {
          if (isMissingTableError(e)) {
            logsStorageAvailable = false;
            if (!logsMissingLogged) {
              console.warn(`[retrieval] logs table missing: public.${LOGS_TABLE}`);
              logsMissingLogged = true;
            }
          }
        }
      } catch (e) {
        results.push({ accountId: acc.id, email: acc.email, ok: false, error: e.message });
        try {
          if (logsStorageAvailable) {
            const { error } = await supabase.from(LOGS_TABLE).insert({ user_id: userId, account_id: acc.id, email: acc.email, status: 'error', error: e.message, created_at: new Date().toISOString() });
            if (error) throw new Error(error.message);
          }
        } catch (ee) {
          if (isMissingTableError(ee)) {
            logsStorageAvailable = false;
            if (!logsMissingLogged) {
              console.warn(`[retrieval] logs table missing: public.${LOGS_TABLE}`);
              logsMissingLogged = true;
            }
          }
        }
      }
    }

    return res.json({ results });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}

// GET /api/retrieval/logs
async function listLogs(_req, res) {
  try {
    if (!logsStorageAvailable) {
      return res.json([]);
    }
    const { data, error } = await supabase
      .from(LOGS_TABLE)
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    return res.json(Array.isArray(data) ? data : []);
  } catch (e) {
    if (isMissingTableError(e)) {
      logsStorageAvailable = false;
      if (!logsMissingLogged) {
        console.warn(`[retrieval] logs table missing: public.${LOGS_TABLE}`);
        logsMissingLogged = true;
      }
    }
    return res.json([]);
  }
}

module.exports = { getStatus, setStatus, getConfig, setConfig, runNow, listLogs };
