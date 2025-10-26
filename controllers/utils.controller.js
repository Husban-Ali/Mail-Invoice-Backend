const { sendEmail } = require('../services/resend.service');

async function sendTestEmail(req, res) {
  try {
    const { to, subject, html, text } = req.body;
    if (!to) return res.status(400).json({ error: 'to email required' });

    const from = process.env.EMAIL_FROM || 'no-reply@example.com';

    const result = await sendEmail({ from, to, subject: subject || 'Test email', html, text });

    return res.json({ success: true, data: result });
  } catch (err) {
    console.error('sendTestEmail failed', err);
    return res.status(500).json({ error: err.message, details: err.response || null });
  }
}

module.exports = { sendTestEmail };
