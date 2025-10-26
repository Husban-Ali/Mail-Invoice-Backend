const supabase = require('../config/supabaseClient');
const { fetchInvoicesViaImap, testImapConnection } = require('../services/imap.service');
const resendService = require('../services/resend.service');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });
let imaps;
try { imaps = require('imap-simple'); } catch { imaps = null; }

function getUserId(req){ return req.user && req.user.id ? req.user.id : null; }

async function listInvoices(req, res) {
  try {
    let q = supabase.from('invoices').select('*').order('created_at', { ascending: false });
    const userId = getUserId(req);
    console.log('[invoices] listInvoices called with userId:', userId);
    if (userId) q = q.eq('user_id', userId);
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    console.log('[invoices] returning', data?.length || 0, 'invoices for user:', userId);
    return res.json(data);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}

async function getInvoice(req, res) {
  try {
    const { id } = req.params;
    let q = supabase.from('invoices').select('*').eq('id', id);
    const userId = getUserId(req);
    if (userId) q = q.eq('user_id', userId);
    const { data, error } = await q.single();
    if (error) return res.status(404).json({ error: 'Invoice not found' });
    return res.json(data);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}

// Trigger IMAP fetch for a given accountId (body contains imap credentials OR account saved meta used)
async function fetchFromImap(req, res) {
  try {
    const { accountId, host, port, email, password, tls=true, folder = 'INBOX', unseenOnly = false, sinceDays = null } = req.body;

    if (!accountId && (!host || !email || !password)) {
      return res.status(400).json({ error: 'Provide accountId or IMAP host/email/password' });
    }

    // If accountId provided, load credentials from accounts table (meta)
    let creds = {};
    if (accountId) {
      const { data: account, error } = await supabase.from('accounts').select('*').eq('id', accountId).single();
      if (error) return res.status(404).json({ error: 'Account not found by id' });
      creds = account.meta || {};
      // meta should include host, port, password (if stored) - be careful with secrets
      creds.user = account.email;
    } else {
      creds = { host, port, user: email, password, tls };
    }

    // call IMAP fetcher (imap service will insert with user_id if provided via accountId lookup or direct param)
    const userId = getUserId(req);
    console.log('[invoices] fetchFromImap called with userId:', userId, 'accountId:', accountId);
    const savedInvoices = await fetchInvoicesViaImap({
      host: creds.host,
      port: creds.port,
      user: creds.user,
      password: creds.password,
      tls: creds.tls !== undefined ? creds.tls : true,
      accountId: accountId || null,
      userId, // NEW: pass user_id so IMAP service can set ownership
      folder,
      unseenOnly,
      sinceDays
    });
    console.log('[invoices] IMAP fetch completed, saved', savedInvoices.length, 'invoices');

    // On success, if we have an accountId, mark account as connected and bump updated_at/lastSync (if column exists)
    try {
      if (accountId) {
        const updates = { status: 'connected', updated_at: new Date().toISOString() };
        // Try to also set lastSync if the column exists; ignore errors
        const { error: accErr } = await supabase.from('accounts').update(updates).eq('id', accountId);
        if (accErr) console.warn('[fetchFromImap] account status update failed:', accErr.message);
      }
    } catch (e) {
      console.warn('[fetchFromImap] post-success account update warning:', e.message);
    }

    return res.json({ fetched: savedInvoices.length, invoices: savedInvoices });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}

module.exports = { listInvoices, getInvoice, fetchFromImap };

// Quick IMAP connectivity test (no mailbox scan)
async function testImap(req, res) {
  try {
    const { host, port, email, password, tls = true, folder = 'INBOX' } = req.body || {};
    if (!host || !port || !email || !password) {
      return res.status(400).json({ error: 'host, port, email, and password are required' });
    }
    const result = await testImapConnection({ host, port, user: email, password, tls, folder });
    if (!result.success) return res.status(400).json({ error: result.message });

    // If there is an existing account for this email, mark as connected and persist IMAP meta (host/port/tls/password)
    try {
      const { data: existing } = await supabase
        .from('accounts')
        .select('*')
        .eq('email', email)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const meta = { host, port, tls, password };

      if (existing && existing.id) {
        const nextMeta = { ...(existing.meta || {}), ...meta };
        const { error: upErr } = await supabase
          .from('accounts')
          .update({ status: 'connected', meta: nextMeta, updated_at: new Date().toISOString() })
          .eq('id', existing.id);
        if (upErr) console.warn('[testImap] account update failed:', upErr.message);
      } else {
        // Create a new account row if not exists
        const { error: insErr } = await supabase
          .from('accounts')
          .insert({ provider: 'imap', email, status: 'connected', meta, created_at: new Date().toISOString() });
        if (insErr) console.warn('[testImap] account insert failed:', insErr.message);
      }
    } catch (e) {
      console.warn('[testImap] post-success account persistence warning:', e.message);
    }

    return res.json({ ok: true, message: result.message });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}

module.exports.testImap = testImap;

// List folders for an account by email (uses saved meta). GET /api/invoices/folders?email=...
async function listFolders(req, res) {
  try {
    const { email } = req.query || {};
    if (!email) return res.status(400).json({ error: 'email is required' });
    if (!imaps) return res.json({ folders: ['INBOX', 'Spam', 'Invoices'] });

    const { data: account, error } = await supabase
      .from('accounts')
      .select('*')
      .eq('email', email)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    if (error || !account) return res.json({ folders: ['INBOX'] });
    const meta = account.meta || {};
    if (!meta.host || !meta.port || !meta.password) {
      return res.json({ folders: ['INBOX'] });
    }

    const config = {
      imap: {
        user: account.email,
        password: meta.password,
        host: meta.host,
        port: parseInt(meta.port, 10),
        tls: meta.tls !== undefined ? meta.tls : true,
        authTimeout: 10000,
        tlsOptions: { rejectUnauthorized: false },
      },
    };

    const connection = await imaps.connect(config);
    try {
      const boxes = await connection.getBoxes();
      const names = [];
      (function walk(obj, prefix = ''){
        for (const k of Object.keys(obj||{})) {
          const full = prefix ? `${prefix}${k}` : k;
          names.push(full);
          if (obj[k] && obj[k].children) {
            walk(obj[k].children, `${full}${obj[k].delimiter || '/'}`);
          }
        }
      })(boxes);
      const uniq = Array.from(new Set(names.filter(Boolean)));
      return res.json({ folders: uniq.length ? uniq : ['INBOX'] });
    } finally {
      try { await connection.end(); } catch {}
    }
  } catch (e) {
    console.error('[listFolders] failed', e);
    return res.json({ folders: ['INBOX'] });
  }
}

module.exports.listFolders = listFolders;

// Send invoice via email with attachment
async function sendInvoiceEmail(req, res) {
  try {
    const { to, subject, message, invoiceId } = req.body;
    const file = req.file;

    if (!to || !file) {
      return res.status(400).json({ error: 'Recipient email and file are required' });
    }

    const userId = getUserId(req);
    console.log('[invoices] sendInvoiceEmail called with userId:', userId, 'invoiceId:', invoiceId);

    // Prepare email data
    const emailData = {
      to,
      subject: subject || `Invoice ${invoiceId || ''}`,
      html: `<p>${(message || '').replace(/\n/g, '<br>')}</p>`,
      replyTo: (req.user && req.user.email) ? req.user.email : undefined,
      attachments: [{
        filename: file.originalname,
        content: file.buffer,
        contentType: file.mimetype
      }]
    };

    // Send via Resend service
    let result = await resendService.sendEmail(emailData);

    if (!result.success) {
      const errMsg = String(result.error || '').toLowerCase();
      const responseMsg = result.response && result.response.message ? String(result.response.message).toLowerCase() : '';
      const fullMsg = errMsg + ' ' + responseMsg;
      const restricted = 
        fullMsg.includes('testing email') || 
        fullMsg.includes('verify') || 
        fullMsg.includes('only send') ||
        fullMsg.includes('domain') ||
        (result.status && (result.status === 401 || result.status === 403 || result.status === 422));
      
      if (restricted) {
        // Fallback: redirect email to the current user (or EMAIL_FROM) so dev flow doesn't break
        const fallbackTo = (req.user && req.user.email) || process.env.EMAIL_FROM || 'alihusban458@gmail.com';
        console.warn('[invoices] Resend restricted recipient or sender; redirecting email to', fallbackTo, 'original to:', to);
        console.warn('[invoices] Original error:', result.error);
        
        const redirected = {
          ...emailData,
          to: fallbackTo,
          subject: `[REDIRECTED from: ${to}] ${emailData.subject}`,
          html: `<p><strong>Original recipient: ${to}</strong></p><hr>${emailData.html}`,
        };
        
        result = await resendService.sendEmail(redirected);
      }
    }

    if (!result.success) {
      console.error('[invoices] Email send failed even after fallback:', result.error);
      return res.status(500).json({ error: result.error || 'Failed to send email' });
    }

    console.log('[invoices] Email sent successfully, message ID:', result.messageId);

    // Optionally update invoice status to 'Assigned' if invoiceId provided
    if (invoiceId && userId) {
      try {
        await supabase
          .from('invoices')
          .update({ status: 'Assigned', updated_at: new Date().toISOString() })
          .eq('id', invoiceId)
          .eq('user_id', userId);
      } catch (e) {
        console.warn('[sendInvoiceEmail] invoice status update warning:', e.message);
      }
    }

    return res.json({ success: true, messageId: result.messageId });
  } catch (err) {
    console.error('[sendInvoiceEmail] error:', err);
    return res.status(500).json({ error: err.message });
  }
}

module.exports.sendInvoiceEmail = sendInvoiceEmail;
module.exports.uploadMiddleware = upload.single('file');
