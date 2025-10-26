// services/scheduler.service.js
// NEW: Core Flow Implementation - lightweight scheduler for retrieval runs without extra deps

const supabase = require('../config/supabaseClient');
const { runNow } = require('../controllers/retrieval.controller');

const SETTINGS_TABLE = 'app_settings';
const KEY = 'dataRetrieval';
const DEFAULTS = {
  enabled: false,
  config: {
    frequency: 'manual', // manual|daily|weekly|monthly|every15|every30|hourly
    nextRun: '-',
    fileTypes: ['pdf'],
    storage: 'supabase',
    backfill: { startDate: null, endDate: null, emailLimit: 500 }
  }
};

let timer = null;
let busy = false;

async function readSettings() {
  try {
    const { data } = await supabase
      .from(SETTINGS_TABLE)
      .select('*')
      .eq('key', KEY)
      .single();
    if (!data) return { ...DEFAULTS };
    return { ...DEFAULTS, ...(data.value || {}) };
  } catch {
    return { ...DEFAULTS };
  }
}

async function writeSettings(value) {
  try {
    const row = { key: KEY, value, updated_at: new Date().toISOString() };
    await supabase.from(SETTINGS_TABLE).upsert(row, { onConflict: 'key' });
  } catch {}
}

function computeNextRunFromFreq(freq) {
  const now = new Date();
  switch (freq) {
    case 'every15': return new Date(now.getTime() + 15 * 60 * 1000);
    case 'every30': return new Date(now.getTime() + 30 * 60 * 1000);
    case 'hourly': return new Date(now.getTime() + 60 * 60 * 1000);
    case 'daily': return new Date(now.getTime() + 24 * 60 * 60 * 1000);
    case 'weekly': return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    case 'monthly': return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    default: return null;
  }
}

async function tick() {
  if (busy) return;
  busy = true;
  try {
    const settings = await readSettings();
    const enabled = !!settings.enabled;
    const freq = settings.config?.frequency || 'manual';
    const nextRunStr = settings.config?.nextRun || '-';

    if (!enabled || freq === 'manual') {
      return; // do nothing
    }

    const now = Date.now();
    const nextRunTime = nextRunStr && nextRunStr !== '-' ? Date.parse(nextRunStr) : NaN;

    if (!Number.isFinite(nextRunTime) || nextRunTime <= now) {
      // time to run
      try {
        // Call controller directly with a fake res to avoid HTTP context.
        await new Promise((resolve, reject) => {
          const fakeReq = {};
          const fakeRes = { json: resolve, status: () => ({ json: reject }) };
          runNow(fakeReq, fakeRes);
        });
      } catch (e) {
        // swallow errors; logging happens inside controller
      }

      // schedule next run
      const next = computeNextRunFromFreq(freq);
      settings.config = settings.config || {};
      settings.config.nextRun = next ? next.toISOString() : '-';
      await writeSettings(settings);
    }
  } finally {
    busy = false;
  }
}

function startScheduler() {
  if (timer) return;
  // Run every minute to check
  timer = setInterval(tick, 60 * 1000);
  // Also schedule a delayed first tick to start soon after boot
  setTimeout(tick, 10 * 1000);
  console.log('[scheduler] started (interval 60s)');
}

function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { startScheduler, stopScheduler };
