// NEW: Core Flow Implementation - enhanced IMAP intake with XML support, dedupe, and storage adapter

async function saveConnectedAccount({ user, provider = 'imap', status = 'pending', meta = {}, }) {
  const now = new Date().toISOString();
  const accountRecord = {
    provider,
    email: user,
    status,
    meta,
    created_at: now,
    updated_at: now
  };
  try {
    const { data, error } = await supabase
      .from('accounts')
      .insert(accountRecord)
      .select()
      .single();
    if (error) {
      console.error('Insert account error', error);
      return { success: false, error };
    }
    return { success: true, data };
  } catch (err) {
    return { success: false, error: err.message };
  }
}
// imap.service.js (resilient)
let imaps, parseMailFn, uuidv4;
const missingDeps = [];
try { imaps = require('imap-simple'); } catch { console.warn('[imap] imap-simple not installed'); missingDeps.push('imap-simple'); }
try { ({ parseMail: parseMailFn } = require('./mailparser.service')); } catch { console.warn('[imap] mailparser.service not available'); missingDeps.push('mailparser'); }
try { ({ v4: uuidv4 } = require('uuid')); } catch { uuidv4 = () => Date.now().toString(36); }
let extractFromPdf, extractFromSubjectBody, inferVendor, extractFromAny;
try { ({ extractFromPdf, extractFromSubjectBody, inferVendor, extractFromAny } = require('./invoiceExtract.service')); } catch {
  console.warn('[imap] invoiceExtract.service not available');
  extractFromPdf = async () => ({ amount: null, currency: null });
  extractFromSubjectBody = () => ({ amount: null, currency: null });
  inferVendor = () => null;
  extractFromAny = async () => ({ amount: null, currency: null, text: null });
}
// NEW: Core Flow Implementation - auto-match suppliers using keywords
let findSupplierForInvoice;
try { ({ findSupplierForInvoice } = require('./supplierMatch.service')); } catch {
  console.warn('[imap] supplierMatch.service not available');
  findSupplierForInvoice = async () => null;
}
const supabase = require('../config/supabaseClient');
const STORAGE_BUCKET = process.env.STORAGE_BUCKET || process.env.SUPABASE_STORAGE_BUCKET || 'invoices';
const crypto = require('crypto');


async function fetchInvoicesViaImap({ host, port, user, password, tls = true, accountId, userId = null, folder = 'INBOX', unseenOnly = false, sinceDays = null, storage = 'supabase', fileTypes = ['pdf','xml'] }) {
  console.log('[imap] fetchInvoicesViaImap called with:', { host, port, user, folder, unseenOnly, sinceDays, storage, fileTypes, accountId, userId });
  
  const config = {
    imap: {
      user,
      password,
      host,
      port: parseInt(port, 10),
      tls,
      authTimeout: 10000,
      tlsOptions: { rejectUnauthorized: false }
    }
  };

  if (!imaps || !parseMailFn) throw new Error(`IMAP fetch dependencies missing${missingDeps.length ? ': ' + missingDeps.join(', ') : ''}`);
  
  console.log('[imap] Connecting to IMAP server...');
  const connection = await imaps.connect(config);
  try {
    console.log('[imap] Opening mailbox:', folder);
    await connection.openBox(folder);

    const searchCriteria = [];
    if (unseenOnly) {
      searchCriteria.push('UNSEEN');
    } else {
      searchCriteria.push('ALL');
    }
    if (sinceDays && Number(sinceDays) > 0) {
      const sinceDate = new Date(Date.now() - Number(sinceDays) * 24 * 60 * 60 * 1000);
      searchCriteria.push(['SINCE', sinceDate]);
    }
    
    console.log('[imap] Search criteria:', JSON.stringify(searchCriteria));
    
    const fetchOptions = {
      bodies: [''],
      struct: true,
      markSeen: false
    };

    const results = await connection.search(searchCriteria, fetchOptions);
    console.log('[imap] Found', results.length, 'emails matching criteria');
    const savedInvoices = [];

    for (const res of results) {
      const raw = res.parts.find(p => p.which === '');
      if (!raw || !raw.body) continue;

      const mail = await parseMailFn(Buffer.from(raw.body, 'utf8'));
      if (!mail.attachments || mail.attachments.length === 0) {
        console.log('[imap] Email has no attachments, skipping');
        continue;
      }

      console.log('[imap] Processing email with', mail.attachments.length, 'attachment(s)');
      for (const attachment of mail.attachments) {
        // Accept attachments by configured file types (pdf, xml)
        const ct = (attachment.contentType || '').toLowerCase();
        const fname = (attachment.filename || '').toLowerCase();
        const wantsPdf = fileTypes.includes('pdf');
        const wantsXml = fileTypes.includes('xml');
        const looksPdf = ct.includes('pdf') || fname.endsWith('.pdf');
        const looksXml = ct.includes('xml') || fname.endsWith('.xml');
        if (!((wantsPdf && looksPdf) || (wantsXml && looksXml))) {
          if (looksXml && !wantsXml) {
            console.log('[imap] ⏭️ Skipping XML because fileTypes does not include xml');
          }
          if (looksPdf && !wantsPdf) {
            console.log('[imap] ⏭️ Skipping PDF because fileTypes does not include pdf');
          }
          continue;
        }

        // generate filename
        const filename = `${Date.now()}_${attachment.filename || uuidv4()}`;
        const bucket = STORAGE_BUCKET; // ensure this bucket exists in supabase storage
        const path = `${accountId || 'unknown'}/${filename}`;

        // NEW: Core Flow Implementation - dedup using message_id + content hash or file path
        let fileHash = null;
        try {
          if (attachment.content) {
            fileHash = crypto.createHash('sha256').update(attachment.content).digest('hex');
          }
        } catch {}
        try {
          const orExpr = [
            mail.messageId ? `message_id.eq.${mail.messageId}` : '',
            fileHash ? `meta->>file_hash.eq.${fileHash}` : '',
            attachment.filename ? `filename.eq.${attachment.filename}` : ''
          ].filter(Boolean).join(',');
          if (orExpr) {
            const { data: existing } = await supabase
              .from('invoices')
              .select('id')
              .or(orExpr)
              .eq('account_id', accountId)
              .limit(1)
              .maybeSingle();
            if (existing && existing.id) {
              // skip duplicate
              continue;
            }
          }
        } catch {}

        // upload using configured storage (currently only supabase implemented)
        let publicUrl = null;
        if (storage === 'supabase') {
          const { data, error: uploadError } = await supabase.storage
            .from(bucket)
            .upload(path, attachment.content, { upsert: false });

          if (uploadError) {
            console.error('Upload error', uploadError);
            continue;
          }

          // create public url (or signed URL)
          const { data: publicUrlData } = supabase.storage.from(bucket).getPublicUrl(path);
          publicUrl = publicUrlData && publicUrlData.publicUrl ? publicUrlData.publicUrl : path;
        } else {
          // Placeholder: in future implement gdrive/onedrive adapters
          // For now, fallback to supabase to avoid data loss
          const { data, error: uploadError } = await supabase.storage
            .from(bucket)
            .upload(path, attachment.content, { upsert: false });
          if (uploadError) {
            console.error('Upload error', uploadError);
            continue;
          }
          const { data: publicUrlData } = supabase.storage.from(bucket).getPublicUrl(path);
          publicUrl = publicUrlData && publicUrlData.publicUrl ? publicUrlData.publicUrl : path;
        }

        // Try to extract amount/currency/vendor
        let amount = null;
        let currency = null;
        let xmlSummary = null;
        // Track derived fields
        let format = looksPdf ? 'PDF' : (looksXml ? 'XML' : null);
        let status = 'Pending';
        let invoiceNumber = null;
        try {
          if (attachment.content) {
            if (looksPdf) {
              console.log('[imap] 📄 Processing PDF attachment:', fname);
              const res = await extractFromPdf(attachment.content);
              amount = res?.amount ?? null;
              currency = res?.currency ?? null;
              console.log('[imap] ✅ PDF extracted - amount:', amount, 'currency:', currency);
              if (res && (res.amount != null || (res.text && String(res.text).trim().length > 0))) {
                status = 'Parsed';
              }
            } else if (looksXml) {
              console.log('[imap] 📋 Processing XML attachment:', fname);
              const parsed = await extractFromAny(attachment.content);
              if (parsed && parsed.xml) {
                xmlSummary = parsed.xml;
                console.log('[imap] ✅ XML parsed successfully:', JSON.stringify(xmlSummary).substring(0, 200) + '...');
                // try map total amount if looks numeric
                const total = parsed.xml.total;
                if (typeof total === 'string') {
                  const num = Number(String(total).replace(/[,\s]/g, ''));
                  if (!Number.isNaN(num)) amount = num;
                }
                // prefer currency from XML if present
                if (!currency && parsed.xml.currency) {
                  currency = parsed.xml.currency;
                }
                // prefer seller/vendor from XML if present
                if (parsed.xml.seller) {
                  try { vendor = parsed.xml.seller || vendor; } catch {}
                }
                // set invoice number if present
                invoiceNumber = parsed.xml.invoice_number || parsed.xml.invoiceNumber || null;
                // ensure format/status for XML
                format = 'XML';
                status = 'Parsed';
              } else {
                console.log('[imap] ⚠️ XML parsing returned no data');
              }
            }
          }
        } catch (e) {
          console.error('[imap] ❌ Error parsing attachment:', fname, e.message);
        }
        if (amount == null) {
          try {
            const fb = extractFromSubjectBody(mail.subject, mail.text || mail.html || '');
            amount = fb?.amount ?? null;
            currency = currency ?? (fb?.currency ?? null);
          } catch {}
        }
        const fromAddr = mail.from ? mail.from.value.map(v => v.address).join(', ') : null;
        let vendor = null;
        try { vendor = inferVendor(fromAddr) || null; } catch { vendor = null; }

        // NEW: Core Flow Implementation - try to match supplier using keywords
        let supplierId = null;
        try {
          const tempInvoice = {
            subject: mail.subject || null,
            from_addr: fromAddr,
            vendor,
            body: mail.text || mail.html || '',
            meta: { xml: xmlSummary }
          };
          const match = await findSupplierForInvoice(tempInvoice);
          if (match && match.supplier) {
            supplierId = match.supplier.id;
          }
        } catch {}

        // save metadata into invoices table
        const invoiceRecord = {
          user_id: userId || null, // NEW: multi-tenant ownership
          account_id: accountId,
          message_id: mail.messageId || null,
          subject: mail.subject || null,
          from_addr: fromAddr,
          date: mail.date ? mail.date.toISOString() : null,
          filename,
          file_path: publicUrl || path,
          size: attachment.size || null,
          amount,
          currency,
          vendor,
          format: format || (looksXml ? 'XML' : (looksPdf ? 'PDF' : null)),
          status,
          invoice_number: invoiceNumber || null,
          supplier_id: supplierId, // NEW: auto-linked supplier
          meta: {
            contentType: attachment.contentType,
            original_filename: attachment.filename || null,
            storage,
            file_hash: fileHash,
            xml: xmlSummary || null
          }
        };

        const { data: inserted, error: insertError } = await supabase
          .from('invoices')
          .insert(invoiceRecord)
          .select()
          .single();

        if (insertError) {
          console.error('Insert invoice error', insertError);
          continue;
        }

        savedInvoices.push(inserted);
        console.log('[imap] ✅ Saved invoice:', inserted.id, 'filename:', filename);
      }
    }

    console.log('[imap] Completed processing. Saved', savedInvoices.length, 'invoice(s)');
    return savedInvoices;
  } finally {
    try { await connection.end(); } catch (e) { /* ignore */ }
  }
}

// Test function to verify IMAP connection
async function testImapConnection({ host, port, user, password, tls = true, folder = 'INBOX' }) {
  const config = {
    imap: {
      user,
      password,
      host,
      port: parseInt(port, 10),
      tls,
      authTimeout: 10000,
      tlsOptions: { rejectUnauthorized: false }
    }
  };
  if (!imaps) throw new Error('imap-simple not installed');
  let connection;
  try {
    connection = await imaps.connect(config);
    await connection.openBox(folder);
    await connection.end();
    return { success: true, message: 'IMAP connection successful.' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

module.exports = { fetchInvoicesViaImap, testImapConnection, saveConnectedAccount };
