const supabase = require('../config/supabaseClient');

function getUserId(req){ return req.user && req.user.id ? req.user.id : null; }

// NEW: Core Flow Implementation - VAT validation helpers
function normalizeVAT(vat) {
  if (!vat) return null;
  return String(vat).toUpperCase().replace(/[\s\-\.]/g, '');
}

function validateVATFormat(vat) {
  if (!vat) return { valid: false, reason: 'Empty' };
  const normalized = normalizeVAT(vat);
  // Basic EU VAT regex (2-letter country code + 8-12 digits/chars)
  const euPattern = /^[A-Z]{2}[A-Z0-9]{8,12}$/;
  if (euPattern.test(normalized)) return { valid: true };
  // Allow other formats loosely (min 5 chars alphanumeric)
  if (/^[A-Z0-9]{5,}$/.test(normalized)) return { valid: true };
  return { valid: false, reason: 'Invalid format' };
}

// NEW: Core Flow Implementation - compute confidence score from available data
function computeConfidence(supplier) {
  let score = 0;
  if (supplier.name) score += 10;
  if (supplier.legal_name) score += 10;
  if (supplier.vat_number) score += 20;
  if (supplier.vat_status === 'Valid') score += 30;
  if (supplier.country) score += 5;
  if (supplier.address_line1) score += 5;
  if (supplier.email || supplier.website) score += 10;
  if (supplier.phone) score += 5;
  if (Array.isArray(supplier.keywords) && supplier.keywords.length > 0) score += 5;
  return Math.min(100, score);
}

// NEW: Core Flow Implementation - log audit entry
async function logAudit(supplierId, action, changedFields = {}, changedBy = 'system', notes = null, userId = null) {
  try {
    await supabase.from('supplier_audit').insert({
      supplier_id: supplierId,
      user_id: userId,
      action,
      changed_fields: changedFields,
      changed_by: changedBy,
      notes,
      created_at: new Date().toISOString()
    });
  } catch (e) {
    console.warn('[suppliers] audit log failed:', e.message);
  }
}

async function listSuppliers(req, res) {
  try {
    const userId = getUserId(req);
    console.log('[suppliers] listSuppliers called with userId:', userId);
    // NEW: Core Flow Implementation - use supplier_summary view for directory list
    // TEMP: Try without user_id filter first to check if data exists
    let query = supabase
      .from('supplier_summary')
      .select('*', { count: 'exact' })
      .order('name', { ascending: true });
    // Temporarily disabled: if (userId) query = query.eq('user_id', userId);
    console.log('[suppliers] executing query WITHOUT user_id filter (temp debug)');
    const { data, error, count } = await query;

    if (error) {
      console.error('Error listing suppliers:', error);
      // Try fallback to suppliers table directly
      console.log('[suppliers] Trying fallback to suppliers table...');
      const { data: fallbackData, error: fallbackError } = await supabase
        .from('suppliers')
        .select('*', { count: 'exact' })
        .order('name', { ascending: true });
      
      if (fallbackError) {
        console.error('[suppliers] Fallback also failed:', fallbackError);
        return res.status(500).json({ error: error.message });
      }
      
      console.log('[suppliers] Fallback successful, returning', fallbackData.length, 'suppliers');
      return res.json({ success: true, data: fallbackData || [], total: fallbackData?.length || 0 });
    }

    console.log('[suppliers] returning', count, 'suppliers for user:', userId);
    return res.json({ success: true, data: data || [], total: count || 0 });
  } catch (err) {
    console.error('Error in listSuppliers:', err);
    return res.status(500).json({ error: err.message });
  }
}

async function getSupplier(req, res) {
  try {
    const { id } = req.params;
    const userId = getUserId(req);
    // NEW: Core Flow Implementation - fetch supplier with contacts and recent invoices
    let spq = supabase
      .from('suppliers')
      .select('*')
      .eq('id', id);
    if (userId) spq = spq.eq('user_id', userId);
    const { data: supplier, error } = await spq.single();

    if (error) {
      console.error('Error getting supplier:', error);
      return res.status(404).json({ error: 'Supplier not found' });
    }

    // Fetch contacts
    let cq = supabase
      .from('supplier_contacts')
      .select('*')
      .eq('supplier_id', id);
    if (userId) cq = cq.eq('user_id', userId);
    const { data: contacts } = await cq.order('is_primary', { ascending: false });

    // Fetch related invoices (recent 50)
    let iq = supabase
      .from('invoices')
      .select('id, subject, date, amount, currency, filename')
      .eq('supplier_id', id);
    if (userId) iq = iq.eq('user_id', userId);
    const { data: invoices } = await iq.order('date', { ascending: false }).limit(50);

    // Fetch audit history (recent 100)
    let aq = supabase
      .from('supplier_audit')
      .select('*')
      .eq('supplier_id', id);
    if (userId) aq = aq.eq('user_id', userId);
    const { data: audit } = await aq.order('created_at', { ascending: false }).limit(100);

    return res.json({
      success: true,
      data: {
        ...supplier,
        contacts: contacts || [],
        invoices: invoices || [],
        audit: audit || []
      }
    });
  } catch (err) {
    console.error('Error in getSupplier:', err);
    return res.status(500).json({ error: err.message });
  }
}

async function createSupplier(req, res) {
  try {
    const userId = getUserId(req);
    const {
      name, legal_name, aliases, vat_number, country,
      address_line1, address_line2, city, state, postal_code,
      website, email, phone, category, keywords,
      accounting_code, payment_terms, currency,
      status, metadata
    } = req.body;

    if (!name) return res.status(400).json({ error: 'name is required' });

    // NEW: Core Flow Implementation - normalize and validate VAT
    const normalizedVAT = vat_number ? normalizeVAT(vat_number) : null;
    let vatStatus = 'Unknown';
    if (normalizedVAT) {
      const validation = validateVATFormat(normalizedVAT);
      vatStatus = validation.valid ? 'Valid' : 'Invalid';
    }

    const payload = {
      user_id: userId || null,
      name,
      legal_name: legal_name || null,
      aliases: Array.isArray(aliases) ? aliases : null,
      vat_number: normalizedVAT,
      vat_status: vatStatus,
      vat_validated_at: normalizedVAT ? new Date().toISOString() : null,
      country: country || null,
      address_line1: address_line1 || null,
      address_line2: address_line2 || null,
      city: city || null,
      state: state || null,
      postal_code: postal_code || null,
      website: website || null,
      email: email || null,
      phone: phone || null,
      category: category || null,
      status: status || 'Active',
      keywords: Array.isArray(keywords) ? keywords : null,
      accounting_code: accounting_code || null,
      payment_terms: payment_terms || null,
      currency: currency || 'USD',
      metadata: metadata || {},
    };

    // Compute confidence
    payload.confidence_score = computeConfidence(payload);

    const { data, error } = await supabase
      .from('suppliers')
      .insert(payload)
      .select()
      .single();

    if (error) {
      console.error('Error creating supplier:', error);
      return res.status(500).json({ error: error.message });
    }

    // Log audit
    await logAudit(data.id, 'created', { after: data }, req.user?.email || 'system', 'Supplier created', userId);

    return res.json({ success: true, data });
  } catch (err) {
    console.error('Error in createSupplier:', err);
    return res.status(500).json({ error: err.message });
  }
}

async function updateSupplier(req, res) {
  try {
    const { id } = req.params;

    // Fetch existing for audit
    const userId = getUserId(req);
    let eqr = supabase
      .from('suppliers')
      .select('*')
      .eq('id', id);
    if (userId) eqr = eqr.eq('user_id', userId);
    const { data: existing, error: fetchErr } = await eqr.single();

    if (fetchErr || !existing) {
      return res.status(404).json({ error: 'Supplier not found' });
    }

    const updates = { ...req.body };

    // NEW: Core Flow Implementation - revalidate VAT if changed
    if (updates.vat_number && updates.vat_number !== existing.vat_number) {
      const normalizedVAT = normalizeVAT(updates.vat_number);
      updates.vat_number = normalizedVAT;
      const validation = validateVATFormat(normalizedVAT);
      updates.vat_status = validation.valid ? 'Valid' : 'Invalid';
      updates.vat_validated_at = new Date().toISOString();
    }

    // Recompute confidence
    const merged = { ...existing, ...updates };
    updates.confidence_score = computeConfidence(merged);
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('suppliers')
      .update(updates)
      .eq('id', id)
      .eq('user_id', getUserId(req))
      .select()
      .single();

    if (error) {
      console.error('Error updating supplier:', error);
      return res.status(500).json({ error: error.message });
    }

    // Log audit
    await logAudit(id, 'updated', { before: existing, after: data }, req.user?.email || 'system', 'Supplier updated', getUserId(req));

    return res.json({ success: true, data });
  } catch (err) {
    console.error('Error in updateSupplier:', err);
    return res.status(500).json({ error: err.message });
  }
}

async function deleteSuppliers(req, res) {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids array required' });

    const { data, error } = await supabase
      .from('suppliers')
      .delete()
      .in('id', ids)
      .eq('user_id', getUserId(req))
      .select();

    if (error) {
      console.error('Error deleting suppliers:', error);
      return res.status(500).json({ error: error.message });
    }

    return res.json({ success: true, deleted: data.length, data });
  } catch (err) {
    console.error('Error in deleteSuppliers:', err);
    return res.status(500).json({ error: err.message });
  }
}

/**
 * NEW: Core Flow Implementation - Merge suppliers: keep primaryId, mark others as 'Merged'
 * Re-link invoices to primary, aggregate contacts, log audit.
 * body: { ids: [id1,id2...], primaryId }
 */
async function mergeSuppliers(req, res) {
  try {
    const { ids, primaryId } = req.body;
    if (!Array.isArray(ids) || ids.length < 2) return res.status(400).json({ error: 'ids array with at least 2 ids required' });
    if (!primaryId || !ids.includes(primaryId)) return res.status(400).json({ error: 'primaryId must be one of ids' });

    const dupIds = ids.filter(i => i !== primaryId);

    // Fetch primary
    const uid = getUserId(req);
    const { data: primary, error: pErr } = await supabase
      .from('suppliers')
      .select('*')
      .eq('id', primaryId)
      .eq('user_id', uid)
      .single();

    if (pErr || !primary) return res.status(404).json({ error: 'Primary supplier not found' });

    // Re-link all invoices from duplicates to primary
    const { error: invErr } = await supabase
      .from('invoices')
      .update({ supplier_id: primaryId })
      .in('supplier_id', dupIds)
      .eq('user_id', uid);

    if (invErr) {
      console.warn('Error re-linking invoices during merge:', invErr.message);
    }

    // Migrate contacts from duplicates to primary (mark non-primary)
    const { data: dupContacts } = await supabase
      .from('supplier_contacts')
      .select('*')
      .in('supplier_id', dupIds)
      .eq('user_id', uid);

    if (dupContacts && dupContacts.length > 0) {
      const migratedContacts = dupContacts.map(c => ({
        ...c,
        id: undefined, // let DB generate new UUID
        supplier_id: primaryId,
        is_primary: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }));
      await supabase.from('supplier_contacts').insert(migratedContacts.map(c => ({ ...c, user_id: uid })));
    }

    // Mark duplicates as Merged
    const { error: mergeErr } = await supabase
      .from('suppliers')
      .update({ status: 'Merged', updated_at: new Date().toISOString() })
      .in('id', dupIds)
      .eq('user_id', uid);

    if (mergeErr) {
      console.error('Error marking merged suppliers:', mergeErr);
      return res.status(500).json({ error: mergeErr.message });
    }

    // Log audit on primary
    await logAudit(primaryId, 'merged', { merged_ids: dupIds }, req.user?.email || 'system', `Merged ${dupIds.length} duplicate(s)`, getUserId(req));

    return res.json({ success: true, primary, merged: dupIds.length });
  } catch (err) {
    console.error('Error in mergeSuppliers:', err);
    return res.status(500).json({ error: err.message });
  }
}

// NEW: Core Flow Implementation - Find duplicate suppliers using VAT, name, email, and keywords
async function findDuplicates(req, res) {
  try {
    const { data: suppliers, error } = await supabase
      .from('suppliers')
      .select('*')
      .neq('status', 'Merged')
      .eq('user_id', getUserId(req)); // exclude already merged and scope to user

    if (error) return res.status(500).json({ error: error.message });

    const normalize = (name = '') => {
      return name
        .toLowerCase()
        .replace(/\b(gmbh|ug|ag|llc|ltd|inc|sarl|sa|gbr|co|company|limited)\b/g, '')
        .replace(/[^a-z0-9]/g, '')
        .trim();
    };

    const byVAT = {};
    const byName = {};
    const byEmail = {};
    const byKeyword = {};

    for (const s of suppliers || []) {
      if (s.vat_number) {
        const k = normalizeVAT(s.vat_number);
        if (k) (byVAT[k] = byVAT[k] || []).push(s);
      }
      const nm = normalize(s.name || '');
      if (nm) (byName[nm] = byName[nm] || []).push(s);

      const email = s.email || (s.metadata && s.metadata.email) || null;
      if (email) {
        const e = email.toLowerCase().trim();
        (byEmail[e] = byEmail[e] || []).push(s);
      }

      // Group by keywords
      if (Array.isArray(s.keywords)) {
        for (const kw of s.keywords) {
          const k = kw.toLowerCase().trim();
          if (k) (byKeyword[k] = byKeyword[k] || []).push(s);
        }
      }
    }

    const groups = [];
    const seen = new Set();

    // VAT groups (highest confidence)
    for (const k of Object.keys(byVAT)) {
      const arr = byVAT[k];
      if (arr.length > 1) {
        groups.push({ type: 'vat', key: k, suppliers: arr, confidence: 'high' });
        arr.forEach(s => seen.add(s.id));
      }
    }

    // Name groups
    for (const k of Object.keys(byName)) {
      const arr = byName[k].filter(s => !seen.has(s.id));
      if (arr.length > 1) {
        groups.push({ type: 'name', key: k, suppliers: arr, confidence: 'medium' });
        arr.forEach(s => seen.add(s.id));
      }
    }

    // Email groups
    for (const k of Object.keys(byEmail)) {
      const arr = byEmail[k].filter(s => !seen.has(s.id));
      if (arr.length > 1) {
        groups.push({ type: 'email', key: k, suppliers: arr, confidence: 'medium' });
        arr.forEach(s => seen.add(s.id));
      }
    }

    // Keyword groups (lower confidence, may have false positives)
    for (const k of Object.keys(byKeyword)) {
      const arr = byKeyword[k].filter(s => !seen.has(s.id));
      if (arr.length > 1) {
        groups.push({ type: 'keyword', key: k, suppliers: arr, confidence: 'low' });
        arr.forEach(s => seen.add(s.id));
      }
    }

    return res.json({ success: true, groups });
  } catch (err) {
    console.error('Error in findDuplicates:', err);
    return res.status(500).json({ error: err.message });
  }
}

async function blockSuppliers(req, res) {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids array required' });

    const { data, error } = await supabase
      .from('suppliers')
      .update({ status: 'Blocked', updated_at: new Date().toISOString() })
      .in('id', ids)
      .eq('user_id', getUserId(req))
      .select();

    if (error) {
      console.error('Error blocking suppliers:', error);
      return res.status(500).json({ error: error.message });
    }

    // Log audit for each
    for (const supplier of data) {
      await logAudit(supplier.id, 'blocked', { status: 'Blocked' }, req.user?.email || 'system', 'Supplier blocked', getUserId(req));
    }

    return res.json({ success: true, blocked: data.length, data });
  } catch (err) {
    console.error('Error in blockSuppliers:', err);
    return res.status(500).json({ error: err.message });
  }
}

// NEW: Core Flow Implementation - activate/deactivate suppliers
async function activateSuppliers(req, res) {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids array required' });

    const { data, error } = await supabase
      .from('suppliers')
      .update({ status: 'Active', updated_at: new Date().toISOString() })
      .in('id', ids)
      .eq('user_id', getUserId(req))
      .select();

    if (error) {
      console.error('Error activating suppliers:', error);
      return res.status(500).json({ error: error.message });
    }

    for (const supplier of data) {
      await logAudit(supplier.id, 'activated', { status: 'Active' }, req.user?.email || 'system', 'Supplier activated', getUserId(req));
    }

    return res.json({ success: true, activated: data.length, data });
  } catch (err) {
    console.error('Error in activateSuppliers:', err);
    return res.status(500).json({ error: err.message });
  }
}

async function deactivateSuppliers(req, res) {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids array required' });

    const { data, error } = await supabase
      .from('suppliers')
      .update({ status: 'Inactive', updated_at: new Date().toISOString() })
      .in('id', ids)
      .eq('user_id', getUserId(req))
      .select();

    if (error) {
      console.error('Error deactivating suppliers:', error);
      return res.status(500).json({ error: error.message });
    }

    for (const supplier of data) {
      await logAudit(supplier.id, 'deactivated', { status: 'Inactive' }, req.user?.email || 'system', 'Supplier deactivated', getUserId(req));
    }

    return res.json({ success: true, deactivated: data.length, data });
  } catch (err) {
    console.error('Error in deactivateSuppliers:', err);
    return res.status(500).json({ error: err.message });
  }
}

// NEW: Core Flow Implementation - review queue for uncertain matches/dupes
async function getReviewQueue(req, res) {
  try {
    const { data, error } = await supabase
      .from('supplier_review_queue')
      .select('*')
      .eq('user_id', getUserId(req))
      .limit(100);

    if (error) {
      console.error('Error fetching review queue:', error);
      return res.status(500).json({ error: error.message });
    }

    return res.json({ success: true, data });
  } catch (err) {
    console.error('Error in getReviewQueue:', err);
    return res.status(500).json({ error: err.message });
  }
}

// NEW: Core Flow Implementation - manage supplier contacts
async function listContacts(req, res) {
  try {
    const { supplierId } = req.params;
    const { data, error } = await supabase
      .from('supplier_contacts')
      .select('*')
      .eq('supplier_id', supplierId)
      .eq('user_id', getUserId(req))
      .order('is_primary', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function createContact(req, res) {
  try {
    const { supplierId } = req.params;
    const { name, role, email, phone, is_primary, notes } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });

    const payload = {
      supplier_id: supplierId,
      user_id: getUserId(req),
      name,
      role: role || null,
      email: email || null,
      phone: phone || null,
      is_primary: !!is_primary,
      notes: notes || null
    };

    const { data, error } = await supabase
      .from('supplier_contacts')
      .insert(payload)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function updateContact(req, res) {
  try {
    const { contactId } = req.params;
    const updates = { ...req.body, updated_at: new Date().toISOString() };

    const { data, error } = await supabase
      .from('supplier_contacts')
      .update(updates)
      .eq('id', contactId)
      .eq('user_id', getUserId(req))
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function deleteContact(req, res) {
  try {
    const { contactId } = req.params;
    const { error } = await supabase
      .from('supplier_contacts')
      .delete()
      .eq('id', contactId)
      .eq('user_id', getUserId(req));

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

// NEW: Core Flow Implementation - trigger auto-linking of invoices to suppliers
async function autoLinkInvoices(req, res) {
  try {
    const { autoLinkInvoices } = require('../services/supplierMatch.service');
    const stats = await autoLinkInvoices();
    return res.json({ success: true, stats });
  } catch (err) {
    console.error('Error in autoLinkInvoices:', err);
    return res.status(500).json({ error: err.message });
  }
}

module.exports = {
  listSuppliers,
  getSupplier,
  createSupplier,
  updateSupplier,
  deleteSuppliers,
  mergeSuppliers,
  findDuplicates,
  blockSuppliers,
  activateSuppliers,
  deactivateSuppliers,
  getReviewQueue,
  listContacts,
  createContact,
  updateContact,
  deleteContact,
  autoLinkInvoices
};
