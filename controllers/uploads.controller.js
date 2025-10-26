const supabase = require('../config/supabaseClient');
const STORAGE_BUCKET = process.env.STORAGE_BUCKET || process.env.SUPABASE_STORAGE_BUCKET || 'invoices';

async function uploadFile(req, res) {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No file uploaded (form field "file" required)' });

    const accountId = req.body.accountId || 'manual';
    const filename = `${Date.now()}_${(file.originalname || 'upload.pdf').replace(/[^a-zA-Z0-9_.-]/g, '_')}`;
    const path = `${accountId}/${filename}`;

    // Upload buffer to supabase storage preserving content type
    const { data, error } = await supabase.storage.from(STORAGE_BUCKET).upload(path, file.buffer, {
      contentType: file.mimetype || 'application/pdf',
      upsert: false
    });

    if (error) {
      console.error('[uploads] upload failed', error);
      return res.status(500).json({ error: error.message || 'Upload failed' });
    }

    const { data: publicUrlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(data.path);

    return res.json({ path: data.path, publicUrl: publicUrlData?.publicUrl || null });
  } catch (e) {
    console.error('[uploads] unexpected error', e);
    return res.status(500).json({ error: e.message });
  }
}

module.exports = { uploadFile };