const supabase = require('../config/supabaseClient');

const RULES_TABLE = 'rules';
function getUserId(req){ return req.user && req.user.id ? req.user.id : null; }

async function listRules(_req, res) {
  try {
    let q = supabase
      .from(RULES_TABLE)
      .select('*')
      .order('created_at', { ascending: false });
    const userId = getUserId(_req);
    if (userId) q = q.eq('user_id', userId);
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true, data: Array.isArray(data) ? data : [] });
  } catch (err) {
    console.error('[rules] listRules failed', err);
    return res.status(500).json({ error: err.message });
  }
}

async function getRuleById(req, res) {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'id is required' });
    let q = supabase
      .from(RULES_TABLE)
      .select('*')
      .eq('id', id);
    const userId = getUserId(req);
    if (userId) q = q.eq('user_id', userId);
    const { data, error } = await q.single();
    if (error) return res.status(404).json({ error: 'Rule not found' });
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[rules] getRuleById failed', err);
    return res.status(500).json({ error: err.message });
  }
}

async function createRule(req, res) {
  try {
    const { name, conditions = {}, actions = {}, active = true } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name is required' });
    const row = {
      user_id: getUserId(req),
      name,
      conditions,
      actions,
      active: !!active,
      created_at: new Date().toISOString()
    };
    const { data, error } = await supabase
      .from(RULES_TABLE)
      .insert(row)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[rules] createRule failed', err);
    return res.status(500).json({ error: err.message });
  }
}

async function updateRule(req, res) {
  try {
    const { id } = req.params;
    const updates = req.body || {};
    if (!id) return res.status(400).json({ error: 'id is required' });
    updates.updated_at = new Date().toISOString();
    const { data, error } = await supabase
      .from(RULES_TABLE)
      .update(updates)
      .eq('id', id)
      .eq('user_id', getUserId(req))
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[rules] updateRule failed', err);
    return res.status(500).json({ error: err.message });
  }
}

async function deleteRules(req, res) {
  try {
    const { ids } = req.body || {};
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids array is required' });
    }
    const { data, error } = await supabase
      .from(RULES_TABLE)
      .delete()
      .in('id', ids)
      .eq('user_id', getUserId(req))
      .select();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true, deleted: Array.isArray(data) ? data.length : 0, data });
  } catch (err) {
    console.error('[rules] deleteRules failed', err);
    return res.status(500).json({ error: err.message });
  }
}

async function activateRule(req, res) {
  try {
    const { id } = req.params;
    const { active } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id is required' });
    const { data, error } = await supabase
      .from(RULES_TABLE)
      .update({ active: !!active, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', getUserId(req))
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[rules] activateRule failed', err);
    return res.status(500).json({ error: err.message });
  }
}

module.exports = { listRules, getRuleById, createRule, updateRule, deleteRules, activateRule };
