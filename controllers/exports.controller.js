const supabase = require('../config/supabaseClient');

function getUserId(req){ return req.user && req.user.id ? req.user.id : null; }

// Helpers
function pickFields(rows, fields) {
  if (!Array.isArray(fields) || fields.length === 0) return rows;
  return rows.map(r => {
    const o = {}; fields.forEach(f => { if (r[f] !== undefined) o[f] = r[f]; });
    return o;
  });
}

function jsonToCsv(rows) {
  if (!rows || rows.length === 0) return '';
  const headers = Array.from(new Set(rows.flatMap(r => Object.keys(r))));
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  const lines = [];
  lines.push(headers.join(','));
  for (const r of rows) {
    lines.push(headers.map(h => esc(r[h])).join(','));
  }
  return lines.join('\n');
}

async function listTemplates(req, res) {
  try {
    const userId = getUserId(req);
    const { data, error } = await supabase
      .from('export_templates')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ data });
  } catch (e) { return res.status(500).json({ error: e.message }); }
}

async function createTemplate(req, res) {
  try {
    const userId = getUserId(req);
    const { name, entity, format='CSV', fields=[], filters=null, options=null } = req.body || {};
    if (!name || !entity) return res.status(400).json({ error: 'name and entity are required' });
    const payload = { user_id: userId, name, entity, format, fields, filters, options };
    const { data, error } = await supabase
      .from('export_templates')
      .insert(payload).select('*').single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ data });
  } catch (e) { return res.status(500).json({ error: e.message }); }
}

async function updateTemplate(req, res) {
  try {
    const userId = getUserId(req);
    const { id } = req.params;
    const { name, entity, format, fields, filters, options } = req.body || {};
    const updates = { updated_at: new Date().toISOString() };
    if (name !== undefined) updates.name = name;
    if (entity !== undefined) updates.entity = entity;
    if (format !== undefined) updates.format = format;
    if (fields !== undefined) updates.fields = fields;
    if (filters !== undefined) updates.filters = filters;
    if (options !== undefined) updates.options = options;
    const { data, error } = await supabase
      .from('export_templates')
      .update(updates)
      .eq('id', id).eq('user_id', userId)
      .select('*').single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ data });
  } catch (e) { return res.status(500).json({ error: e.message }); }
}

async function deleteTemplate(req, res) {
  try {
    const userId = getUserId(req);
    const { id } = req.params;
    const { data, error } = await supabase
      .from('export_templates')
      .delete()
      .eq('id', id).eq('user_id', userId)
      .select('*').single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ data });
  } catch (e) { return res.status(500).json({ error: e.message }); }
}

async function listRuns(req, res) {
  try {
    const userId = getUserId(req);
    const { data, error } = await supabase
      .from('export_runs')
      .select('*')
      .eq('user_id', userId)
      .order('started_at', { ascending: false })
      .limit(200);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ data });
  } catch (e) { return res.status(500).json({ error: e.message }); }
}

async function getRun(req, res) {
  try {
    const userId = getUserId(req);
    const { id } = req.params;
    const { data, error } = await supabase
      .from('export_runs')
      .select('*')
      .eq('user_id', userId)
      .eq('id', id)
      .single();
    if (error) return res.status(404).json({ error: 'Run not found' });
    return res.json({ data });
  } catch (e) { return res.status(500).json({ error: e.message }); }
}

async function downloadRun(req, res) {
  try {
    const userId = getUserId(req);
    const { id } = req.params;
    const { data, error } = await supabase
      .from('export_runs')
      .select('id, user_id, file_url')
      .eq('user_id', userId)
      .eq('id', id)
      .single();
    if (error || !data) return res.status(404).json({ error: 'Run not found' });
    if (!data.file_url) return res.status(404).json({ error: 'Export file not available' });
    return res.redirect(data.file_url);
  } catch (e) { return res.status(500).json({ error: e.message }); }
}

async function runExport(req, res) {
  const userId = getUserId(req);
  const STORAGE_BUCKET = process.env.EXPORTS_BUCKET || process.env.SUPABASE_STORAGE_BUCKET || 'exports';
  try {
    const { templateId, inline } = req.body || {};
    let template = inline || null;
    if (!template && templateId) {
      const { data: t, error } = await supabase
        .from('export_templates')
        .select('*')
        .eq('id', templateId).eq('user_id', userId).single();
      if (error) return res.status(404).json({ error: 'Template not found' });
      template = t;
    }
    if (!template) return res.status(400).json({ error: 'templateId or inline config required' });

    const entity = template.entity;
    const fields = template.fields || [];
    const format = (template.format || 'CSV').toUpperCase();
    const filters = template.filters || {};

    const startedAt = Date.now();
    // Insert run row (Queued->Running)
    const runPayload = { user_id: userId, template_id: template.id || null, name: template.name || null, status: 'Running', format, entity, params: filters };
    const { data: runRow, error: runErr } = await supabase
      .from('export_runs').insert(runPayload).select('*').single();
    if (runErr) return res.status(500).json({ error: runErr.message });

    // Fetch data by entity
    let rows = [];
    if (entity === 'invoices') {
      let q = supabase.from('invoices').select('*').eq('user_id', userId).order('created_at', { ascending: false });
      // apply basic filters (status, format, date range, vendor)
      if (filters.status) q = q.eq('status', filters.status);
      if (filters.format) q = q.eq('format', filters.format);
      if (filters.vendor) q = q.eq('vendor', filters.vendor);
      if (filters.startDate) q = q.gte('created_at', filters.startDate);
      if (filters.endDate) q = q.lte('created_at', filters.endDate);
      const { data, error } = await q;
      if (error) throw error;
      rows = data || [];
    } else if (entity === 'suppliers') {
      // suppliers + counts by format
      const { data: supp, error: sErr } = await supabase
        .from('suppliers').select('*').eq('user_id', userId).order('created_at', { ascending: false });
      if (sErr) throw sErr;
      const { data: inv, error: iErr } = await supabase
        .from('invoices').select('supplier_id, format').eq('user_id', userId);
      if (iErr) throw iErr;
      const counts = {};
      for (const x of inv || []) {
        if (!x.supplier_id) continue;
        const k = x.supplier_id;
        if (!counts[k]) counts[k] = { PDF:0, XML:0, Scan:0 };
        const f = (x.format || 'PDF');
        counts[k][f] = (counts[k][f] || 0) + 1;
      }
      rows = (supp || []).map(s => ({
        id: s.id,
        name: s.name,
        legal_name: s.legal_name,
        vat_number: s.vat_number,
        country: s.country,
        status: s.status,
        invoices_pdf: counts[s.id]?.PDF || 0,
        invoices_xml: counts[s.id]?.XML || 0,
        invoices_scan: counts[s.id]?.Scan || 0,
      }));
    } else if (entity === 'rules') {
      const { data, error } = await supabase.from('rules').select('*').eq('user_id', userId).order('created_at', { ascending: false });
      if (error) throw error;
      rows = data || [];
    } else {
      return res.status(400).json({ error: 'Unsupported entity for export' });
    }

    // Pick fields if specified
    const dataOut = pickFields(rows, fields);

    // Serialize
    let fileBuffer, fileExt, mime;
    if (format === 'CSV') {
      const csv = jsonToCsv(dataOut);
      fileBuffer = Buffer.from(csv, 'utf8');
      fileExt = 'csv';
      mime = 'text/csv';
    } else if (format === 'JSON') {
      const json = JSON.stringify(dataOut, null, 2);
      fileBuffer = Buffer.from(json, 'utf8');
      fileExt = 'json';
      mime = 'application/json';
    } else {
      return res.status(400).json({ error: 'Format not implemented yet. Use CSV or JSON.' });
    }

    // Upload to storage
    const filename = `${Date.now()}_${entity}.${fileExt}`;
    const path = `${userId}/${filename}`;
    let file_url = null;
    let storageError = null;
    try {
      if (supabase.storage) {
        const { data: up, error: upErr } = await supabase.storage.from(STORAGE_BUCKET).upload(path, fileBuffer, { contentType: mime, upsert: true });
        if (upErr) {
          storageError = upErr.message || 'Storage upload failed';
          console.error('[exports] Storage upload error:', upErr);
          throw upErr;
        }
        const { data: pub } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
        file_url = pub?.publicUrl || null;
        console.log('[exports] File uploaded to storage:', file_url);
      } else {
        storageError = 'Storage client not available';
        console.warn('[exports] Storage client unavailable; file will not be persisted');
      }
    } catch (e) {
      storageError = e.message || 'Storage error';
      console.warn('[exports] Storage upload failed:', storageError, '– will save run without file_url');
    }

    const finishedAt = Date.now();
    const duration = finishedAt - startedAt;
    const { data: updated, error: upRunErr } = await supabase
      .from('export_runs')
      .update({ 
        status: 'Completed', 
        finished_at: new Date(finishedAt).toISOString(), 
        duration_ms: duration, 
        count_rows: dataOut.length, 
        file_path: path, 
        file_url,
        error: storageError || null
      })
      .eq('id', runRow.id).eq('user_id', userId)
      .select('*').single();
    if (upRunErr) return res.status(500).json({ error: upRunErr.message });

    return res.json({ data: updated });
  } catch (e) {
    try {
      // best-effort run error persistence
      const userId = getUserId(req);
      const { templateId } = req.body || {};
      await supabase.from('export_runs').insert({ user_id: userId, template_id: templateId || null, status: 'Failed', error: e.message, entity: (req.body?.inline?.entity || 'unknown'), format: (req.body?.inline?.format || 'CSV') });
    } catch {}
    return res.status(500).json({ error: e.message });
  }
}

// Presets
async function createPresets(req, res) {
  try {
    const userId = getUserId(req);
    const presets = [
      { name: 'Full Data Export – Invoices & Emails', entity: 'invoices', format: 'CSV', fields: [], filters: {} },
      { name: 'Full Supplier Export', entity: 'suppliers', format: 'CSV', fields: [], filters: {} },
    ];
    const rows = presets.map(p => ({ ...p, user_id: userId }));
    const { data, error } = await supabase.from('export_templates').insert(rows).select('*');
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ data });
  } catch (e) { return res.status(500).json({ error: e.message }); }
}

module.exports = {
  listTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  listRuns,
  getRun,
  downloadRun,
  runExport,
  createPresets,
};
