// services/supplierMatch.service.js
// NEW: Core Flow Implementation - match invoices to suppliers using keywords, VAT, domain, etc.

const supabase = require('../config/supabaseClient');

/**
 * Extract domain from email address
 */
function extractDomain(email) {
  if (!email) return null;
  const m = String(email).match(/@([A-Z0-9.-]+\.[A-Z]{2,})/i);
  return m ? m[1].toLowerCase() : null;
}

/**
 * Normalize text for matching
 */
function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

/**
 * Find best supplier match for an invoice based on:
 * - VAT number in invoice text/metadata
 * - Supplier keywords appearing in subject/body/from
 * - Email domain match
 * - Vendor field match
 * Returns { supplier, confidence } or null
 */
async function findSupplierForInvoice(invoice) {
  try {
    // Fetch all active suppliers with keywords
    const { data: suppliers, error } = await supabase
      .from('suppliers')
      .select('*')
      .in('status', ['Active', 'Inactive']); // exclude Merged/Blocked

    if (error || !suppliers || suppliers.length === 0) return null;

    const candidates = [];

    // Extract signals from invoice
    const subject = invoice.subject || '';
    const fromAddr = invoice.from_addr || '';
    const vendor = invoice.vendor || '';
    const body = invoice.body || (invoice.meta && invoice.meta.text) || '';
    const combined = [subject, fromAddr, vendor, body].join(' ').toLowerCase();
    const domain = extractDomain(fromAddr);

    for (const supplier of suppliers) {
      let score = 0;

      // 1. VAT match (high confidence)
      if (supplier.vat_number) {
        const vatNorm = normalize(supplier.vat_number);
        if (vatNorm && combined.includes(vatNorm)) {
          score += 50;
        }
      }

      // 2. Keyword match
      if (Array.isArray(supplier.keywords)) {
        for (const kw of supplier.keywords) {
          const kwNorm = normalize(kw);
          if (kwNorm && combined.includes(kwNorm)) {
            score += 15;
          }
        }
      }

      // 3. Name match
      const nameNorm = normalize(supplier.name);
      if (nameNorm && combined.includes(nameNorm)) {
        score += 20;
      }

      // 4. Legal name match
      if (supplier.legal_name) {
        const legalNorm = normalize(supplier.legal_name);
        if (legalNorm && combined.includes(legalNorm)) {
          score += 20;
        }
      }

      // 5. Aliases
      if (Array.isArray(supplier.aliases)) {
        for (const alias of supplier.aliases) {
          const aliasNorm = normalize(alias);
          if (aliasNorm && combined.includes(aliasNorm)) {
            score += 10;
          }
        }
      }

      // 6. Domain match (supplier email or website)
      if (domain) {
        const supplierEmail = supplier.email || '';
        const supplierWebsite = supplier.website || '';
        const supplierDomain = extractDomain(supplierEmail) || supplierWebsite.replace(/^https?:\/\//i, '').split('/')[0].toLowerCase();
        if (supplierDomain && domain === supplierDomain) {
          score += 25;
        }
      }

      // 7. Vendor field exact match
      if (vendor && supplier.name) {
        if (normalize(vendor) === normalize(supplier.name)) {
          score += 30;
        }
      }

      if (score > 0) {
        candidates.push({ supplier, score });
      }
    }

    if (candidates.length === 0) return null;

    // Sort by score descending
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];

    // Only return if confidence is reasonable (score >= 20)
    if (best.score < 20) return null;

    return { supplier: best.supplier, confidence: Math.min(100, best.score) };
  } catch (e) {
    console.error('[supplierMatch] error:', e.message);
    return null;
  }
}

/**
 * Link an invoice to a supplier (update invoices.supplier_id)
 */
async function linkInvoiceToSupplier(invoiceId, supplierId) {
  try {
    const { error } = await supabase
      .from('invoices')
      .update({ supplier_id: supplierId })
      .eq('id', invoiceId);
    if (error) throw error;
    return true;
  } catch (e) {
    console.error('[supplierMatch] linkInvoiceToSupplier failed:', e.message);
    return false;
  }
}

/**
 * Batch process: find and link suppliers for all unlinked invoices
 * Returns stats: { processed, linked, unmatched }
 */
async function autoLinkInvoices() {
  try {
    const { data: invoices, error } = await supabase
      .from('invoices')
      .select('*')
      .is('supplier_id', null)
      .limit(500); // process in batches

    if (error || !invoices || invoices.length === 0) {
      return { processed: 0, linked: 0, unmatched: 0 };
    }

    let linked = 0;
    let unmatched = 0;

    for (const invoice of invoices) {
      const match = await findSupplierForInvoice(invoice);
      if (match && match.supplier) {
        const success = await linkInvoiceToSupplier(invoice.id, match.supplier.id);
        if (success) linked++;
        else unmatched++;
      } else {
        unmatched++;
      }
    }

    return { processed: invoices.length, linked, unmatched };
  } catch (e) {
    console.error('[supplierMatch] autoLinkInvoices failed:', e.message);
    return { processed: 0, linked: 0, unmatched: 0, error: e.message };
  }
}

module.exports = {
  findSupplierForInvoice,
  linkInvoiceToSupplier,
  autoLinkInvoices
};
