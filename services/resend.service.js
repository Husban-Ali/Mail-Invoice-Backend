const https = require('https');
const { URL } = require('url');
const { env } = require('../config/env');

const RESEND_API_KEY = env.RESEND_API_KEY || process.env.RESEND_API_KEY;

if (!RESEND_API_KEY) {
  console.warn('[resend] RESEND_API_KEY not set. Email sending will fail until set in env.');
}

const RESEND_API_BASE = 'https://api.resend.com';

function postJson(urlString, headers, payload) {
  return new Promise((resolve, reject) => {
    try {
      const url = new URL(urlString);
      const data = JSON.stringify(payload);
      const options = {
        method: 'POST',
        hostname: url.hostname,
        path: url.pathname + (url.search || ''),
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          ...headers,
        },
      };
      const req = https.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          let parsed = null;
          try { parsed = JSON.parse(body); } catch {}
          if (res.statusCode >= 200 && res.statusCode < 300) {
            return resolve({ ok: true, status: res.statusCode, data: parsed });
          } else {
            const msg = (parsed && (parsed.error || parsed.message)) || `HTTP ${res.statusCode}`;
            return resolve({ ok: false, status: res.statusCode, data: parsed, error: msg });
          }
        });
      });
      req.on('error', reject);
      req.write(data);
      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

async function sendEmail({ from, to, subject, html, text, attachments = [], replyTo }) {
  if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY not configured');

  // Use from address from env if not provided
  let fromAddress = from || env.EMAIL_FROM || process.env.EMAIL_FROM || 'noreply@example.com';
  try {
    const unsafeDomains = new Set([
      'gmail.com','yahoo.com','hotmail.com','outlook.com','live.com','aol.com','icloud.com','proton.me','protonmail.com','yandex.com','mail.com','zoho.com'
    ]);
    const domain = String(fromAddress).split('@')[1]?.toLowerCase();
    if (!domain || unsafeDomains.has(domain)) {
      // Fallback to Resend onboarding domain for dev/testing to avoid domain verification error
      const fallback = env.RESEND_FROM_FALLBACK || process.env.RESEND_FROM_FALLBACK || 'onboarding@resend.dev';
      if (fromAddress !== fallback) {
        console.warn(`[resend] Using fallback sender ${fallback} (original '${fromAddress}' is likely unverified). Set EMAIL_FROM to a verified domain for production.`);
      }
      // Keep reply-to as original sender if available
      replyTo = replyTo || fromAddress;
      fromAddress = fallback;
    }
  } catch {}

  const payload = {
    from: fromAddress,
    to,
    subject,
    ...(html && { html }),
    ...(text && { text }),
    ...(replyTo && { reply_to: Array.isArray(replyTo) ? replyTo : [replyTo] }),
    ...(attachments && attachments.length > 0 && { attachments: attachments.map(att => ({
      filename: att.filename,
      content: att.content.toString('base64'),
      ...(att.contentType && { type: att.contentType })
    })) })
  };

  const res = await postJson(`${RESEND_API_BASE}/emails`, {
    'Authorization': `Bearer ${RESEND_API_KEY}`
  }, payload);

  if (!res.ok) {
    const msg = res.error || `Resend API responded ${res.status}`;
    return { success: false, error: msg, response: res.data, status: res.status };
  }

  return { success: true, messageId: res.data?.id, data: res.data, status: res.status };
}

module.exports = { sendEmail };
