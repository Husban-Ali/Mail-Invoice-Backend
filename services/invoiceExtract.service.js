// services/invoiceExtract.service.js
// Lightweight amount/currency/vendor extraction for invoices
let pdfParse;
try { pdfParse = require('pdf-parse'); } catch {
  pdfParse = null;
}

// Optional XML parser
let fxp;
try { fxp = require('fast-xml-parser'); } catch { fxp = null; }

// Optional tesseract OCR (heavy). We'll lazily create a worker if available.
let tesseract;
let tesseractWorker = null;
async function ensureTesseract() {
  if (tesseractWorker || !tesseract) return;
  try {
    const { createWorker } = tesseract;
    tesseractWorker = createWorker();
    await tesseractWorker.load();
    await tesseractWorker.loadLanguage('eng');
    await tesseractWorker.initialize('eng');
  } catch (e) {
    console.warn('[invoiceExtract] tesseract worker init failed', e && e.message);
    tesseractWorker = null;
  }
}
try { tesseract = require('tesseract.js'); } catch { tesseract = null; }

const currencyHints = ['PKR','Rs','Rs.','USD','$','EUR','€','GBP','£','₨'];

function parseAmountCandidates(text) {
  const t = String(text || '').replace(/\u00A0/g, ' ');
  const lines = t.split(/\r?\n/);
  const candidates = [];
  const labelRe = /(grand\s+total|amount\s+due|balance\s+due|total)/i;
  const moneyRe = /(?:(PKR|USD|EUR|GBP)\s*)?([₹₨$€£]|Rs\.?|Rs)?\s*([0-9]{1,3}(?:[,\s][0-9]{3})*(?:\.[0-9]{1,2})|[0-9]+(?:\.[0-9]{1,2})?)/i;

  for (const line of lines) {
    if (!labelRe.test(line) && !currencyHints.some(c => line.includes(c))) continue;
    const m = line.match(moneyRe);
    if (m) {
      const [ , iso, symbol, raw ] = m;
      const cur = (iso || symbol || '').toString().replace(/\.$/, '').toUpperCase();
      const normalized = Number(String(raw).replace(/[\s,]/g, ''));
      if (!Number.isNaN(normalized)) {
        candidates.push({ amount: normalized, currency: cur || null, source: 'line' });
      }
    }
  }

  const inlineMatch = t.match(moneyRe);
  if (inlineMatch) {
    const [ , iso, symbol, raw ] = inlineMatch;
    const cur = (iso || symbol || '').toString().replace(/\.$/, '').toUpperCase();
    const normalized = Number(String(raw).replace(/[\s,]/g, ''));
    if (!Number.isNaN(normalized)) {
      candidates.push({ amount: normalized, currency: cur || null, source: 'inline' });
    }
  }

  candidates.sort((a,b)=> (b.amount||0) - (a.amount||0));
  return candidates;
}

async function extractFromPdf(buffer) {
  if (!pdfParse || !buffer) return { amount: null, currency: null, text: null };
  try {
    const { text } = await pdfParse(buffer);
    const amounts = parseAmountCandidates(text);
    const best = amounts[0] || null;
    return { amount: best?.amount ?? null, currency: best?.currency ?? null, text };
  } catch {
    return { amount: null, currency: null, text: null };
  }
}

// Enhanced PDF extraction with OCR fallback when text is insufficient
async function extractFromPdfEnhanced(buffer) {
  if (!buffer) return { amount: null, currency: null, text: null };
  // try pdf-parse first
  if (pdfParse) {
    try {
      const { text } = await pdfParse(buffer);
      const trimmed = String(text || '').trim();
      if (trimmed && trimmed.length > 80) {
        const amounts = parseAmountCandidates(text);
        const best = amounts[0] || null;
        return { amount: best?.amount ?? null, currency: best?.currency ?? null, text };
      }
      // else fallback to OCR
    } catch (e) {
      // fall through to OCR
    }
  }

  // OCR fallback using tesseract.js if available
  if (tesseract) {
    try {
      await ensureTesseract();
      if (tesseractWorker) {
        const { data: { text } } = await tesseractWorker.recognize(buffer);
        const amounts = parseAmountCandidates(text);
        const best = amounts[0] || null;
        return { amount: best?.amount ?? null, currency: best?.currency ?? null, text };
      }
    } catch (e) {
      console.warn('[invoiceExtract] OCR failed', e && e.message);
    }
  }

  // last resort: try pdfParse even if short
  if (pdfParse) {
    try {
      const { text } = await pdfParse(buffer);
      const amounts = parseAmountCandidates(text);
      const best = amounts[0] || null;
      return { amount: best?.amount ?? null, currency: best?.currency ?? null, text };
    } catch {}
  }

  return { amount: null, currency: null, text: null };
}

// Parse XML invoice content (UBBL/UBL/CII/Factur-X heuristics)
function findInObject(obj, keyRegex) {
  if (!obj || typeof obj !== 'object') return null;
  for (const k of Object.keys(obj)) {
    try {
      if (keyRegex.test(k)) return obj[k];
      const v = obj[k];
      if (typeof v === 'object') {
        const found = findInObject(v, keyRegex);
        if (found) return found;
      }
    } catch (e) {}
  }
  return null;
}

function parseXmlInvoiceString(xmlStr) {
  if (!fxp) {
    console.log('[invoiceExtract] ⚠️ fast-xml-parser not loaded, cannot parse XML');
    return null;
  }
  try {
    console.log('[invoiceExtract] 🔍 Parsing XML string, length:', xmlStr?.length);
    const parsed = fxp.parse(xmlStr, { ignoreAttributes: false, parseAttributeValue: false });
    console.log('[invoiceExtract] 📦 XML parsed to object, keys:', Object.keys(parsed));

    // Common locations
    const invoiceNode = findInObject(parsed, /invoice|crossindustryinvoice|exchangedocument/i) || parsed;
    const idNode = findInObject(invoiceNode, /id|invoiceid|documentid/i);
    const dateNode = findInObject(invoiceNode, /date|issue|creationdate/i);
    const totalNode = findInObject(invoiceNode, /totalamount|grandtotal|payableamount|amount/i);
    const sellerNode = findInObject(invoiceNode, /seller|sellerparty|accountingsupplierparty|sellertradeparty|sellerparty/i) || findInObject(parsed, /seller/i);
    const buyerNode = findInObject(invoiceNode, /buyer|buyerparty|accountingcustomerparty|buyertradeparty/i) || findInObject(parsed, /buyer/i);

    const invoiceNumber = (typeof idNode === 'string' ? idNode : (idNode && idNode['#text']) || null) || null;
    const issueDate = (typeof dateNode === 'string' ? dateNode : (dateNode && dateNode['#text']) || null) || null;
    // total could be object with amount and currency
    let total = null;
    let currency = null;
    if (typeof totalNode === 'string') {
      total = totalNode;
    } else if (totalNode && typeof totalNode === 'object') {
      // try to find numeric field inside
      if (totalNode['#text']) total = totalNode['#text'];
      else {
        const val = findInObject(totalNode, /amount|value|sum/i);
        if (val) total = (typeof val === 'string' ? val : (val['#text'] || null));
      }
      // try common currency attribute/fields (UBL: currencyID attribute)
      currency = totalNode['@_currencyID'] || totalNode['currencyID'] || totalNode['CurrencyID'] || null;
      if (!currency) {
        const cNode = findInObject(totalNode, /currency|currencyid/i);
        if (typeof cNode === 'string') currency = cNode;
        else if (cNode && typeof cNode === 'object') currency = cNode['#text'] || null;
      }
    }

    const sellerName = (sellerNode && (sellerNode.name || sellerNode['Name'] || findInObject(sellerNode, /name/i))) || null;
    const buyerName = (buyerNode && (buyerNode.name || buyerNode['Name'] || findInObject(buyerNode, /name/i))) || null;

    const result = {
      invoice_number: invoiceNumber,
      date: issueDate,
      total: total,
      currency: currency,
      seller: typeof sellerName === 'object' && sellerName['#text'] ? sellerName['#text'] : sellerName,
      buyer: typeof buyerName === 'object' && buyerName['#text'] ? buyerName['#text'] : buyerName,
      raw: parsed
    };
    
    console.log('[invoiceExtract] ✅ XML extraction result:', {
      invoice_number: result.invoice_number,
      date: result.date,
      total: result.total,
      currency: result.currency,
      seller: result.seller,
      buyer: result.buyer
    });
    
    return result;
  } catch (e) {
    console.error('[invoiceExtract] ❌ XML parsing error:', e.message);
    return null;
  }
}

async function extractFromAny(bufferOrString) {
  try {
    // if buffer provided, check for XML vs PDF header
    if (Buffer.isBuffer(bufferOrString)) {
      console.log('[invoiceExtract] 📥 extractFromAny called with Buffer, size:', bufferOrString.length);
      const head = bufferOrString.slice(0, 120).toString('utf8','utf8');
      console.log('[invoiceExtract] 🔍 Buffer header:', head.substring(0, 50));
      
      if (/^\s*<\?xml|^\s*</.test(head)) {
        console.log('[invoiceExtract] ✅ Detected XML from buffer header');
        const xmlStr = bufferOrString.toString('utf8');
        const xmlParsed = fxp ? parseXmlInvoiceString(xmlStr) : null;
        if (xmlParsed) return { xml: xmlParsed };
      }
      if (head.includes('%PDF')) {
        console.log('[invoiceExtract] ✅ Detected PDF from buffer header');
        return await extractFromPdfEnhanced(bufferOrString);
      }
      // fallback: try to treat as text and parse xml
      const asText = bufferOrString.toString('utf8');
      if (/^\s*<\?xml|^\s*</.test(asText)) {
        console.log('[invoiceExtract] ✅ Detected XML from buffer text fallback');
        const xmlParsed = fxp ? parseXmlInvoiceString(asText) : null;
        if (xmlParsed) return { xml: xmlParsed };
      }
      // try OCR/pdf
      console.log('[invoiceExtract] ⚠️ No XML/PDF detected, trying OCR fallback');
      return await extractFromPdfEnhanced(bufferOrString);
    } else if (typeof bufferOrString === 'string') {
      console.log('[invoiceExtract] 📥 extractFromAny called with string, length:', bufferOrString.length);
      const s = bufferOrString.trim();
      if (s.startsWith('<')) {
        console.log('[invoiceExtract] ✅ Detected XML from string');
        const xmlParsed = fxp ? parseXmlInvoiceString(s) : null;
        if (xmlParsed) return { xml: xmlParsed };
      }
      // no buffer: treat as plain text for amounts
      console.log('[invoiceExtract] ⚠️ No XML detected, parsing as plain text');
      const amounts = parseAmountCandidates(bufferOrString);
      const best = amounts[0] || null;
      return { amount: best?.amount ?? null, currency: best?.currency ?? null, text: bufferOrString };
    }
  } catch (e) {
    console.error('[invoiceExtract] ❌ extractFromAny failed', e && e.message);
  }
  return { amount: null, currency: null, text: null };
}

function extractFromSubjectBody(subject, body) {
  const combined = [subject, body].filter(Boolean).join('\n');
  const amounts = parseAmountCandidates(combined);
  const best = amounts[0] || null;
  return { amount: best?.amount ?? null, currency: best?.currency ?? null };
}

function inferVendor(fromAddr = '') {
  if (!fromAddr) return null;
  const m = String(fromAddr).match(/[A-Z0-9._%+-]+@([A-Z0-9.-]+)\.[A-Z]{2,}/i);
  return m ? m[1] : null;
}

module.exports = {
  // keep API stable: export extractFromPdf (enhanced) for callers
  extractFromPdf: extractFromPdfEnhanced,
  extractFromSubjectBody,
  inferVendor,
  // advanced exports
  extractFromPdfRaw: extractFromPdf,
  extractFromAny,
  parseXmlInvoiceString
};
