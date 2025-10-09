// api/sipay/purchase-link.js
// Node (Vercel Serverless) — Sipay /purchase/link robust çağrı
const https = require('https');
const { URL } = require('url');

/* ---------- helpers ---------- */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => (data += c));
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch (e) { reject(new Error('BAD_JSON')); }
    });
    req.on('error', reject);
  });
}

function sanitizePhone(v) {
  const s = String(v ?? '').replace(/[^\d]/g, '');
  // TR için 10-13 arası kabul; çok kısa/uzunsa yine gönderiyoruz ama 500 sebebi olabilir
  return s;
}
function clientIp(req) {
  const xf = (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim();
  if (xf) return xf;
  const ra = req.socket && req.socket.remoteAddress || '';
  return ra.replace('::ffff:', '') || '127.0.0.1';
}
function normStr(v, d = '') { return (v ?? d).toString().trim(); }
function makeInvoiceArray(itemsInput = []) {
  const arr = Array.isArray(itemsInput) ? itemsInput : [];
  return arr.map((it, i) => ({
    name: normStr(it.name || `Item ${i + 1}`),
    price: Number(it.price || 0),
    quantity: parseInt(it.quantity || 1, 10),
    description: normStr(it.description || '')
  }));
}
function totalFromInvoice(items = []) {
  return (items || []).reduce((s, it) => s + Number(it.price || 0) * parseInt(it.quantity || 1, 10), 0);
}
function postJSON(url, bodyObj, headers = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(bodyObj || {});
    const u = new URL(url);
    const opts = {
      method: 'POST',
      hostname: u.hostname,
      path: u.pathname + (u.search || ''),
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...headers
      }
    };
    const req = https.request(opts, res => {
      let out = '';
      res.on('data', d => (out += d));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(out); } catch {}
        resolve({ status: res.statusCode, json, raw: out });
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/* ---------- optional token ---------- */
async function tryGetToken(base, appId, appSecret) {
  if (!appId || !appSecret) return null;
  try {
    const { status, json, raw } = await postJSON(`${base}/api/token`, { app_id: appId, app_secret: appSecret });
    if (status !== 200 || !json) return null;
    // Olası biçimler: {data:{token:"..."}} ya da {token:"..."}; emin olmak için string arıyoruz
    const str = JSON.stringify(json);
    const m = str.match(/"token"\s*:\s*"([^"]+)"/i);
    return m ? m[1] : null;
  } catch { return null; }
}

/* ---------- handler ---------- */
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  // ENV
  const MERCHANT_KEY = process.env.SIPAY_MERCHANT_KEY;
  const APP_ID       = process.env.SIPAY_APP_ID;
  const APP_SECRET   = process.env.SIPAY_APP_SECRET;

  if (!MERCHANT_KEY) {
    return res.status(500).json({ ok: false, error: 'CONFIG', detail: 'Missing SIPAY_MERCHANT_KEY' });
  }

  // Body
  let body;
  try { body = await readBody(req); }
  catch (e) { return res.status(400).json({ ok:false, error:'BAD_JSON', detail:e.message }); }

  const {
    env, // "test" -> provisioning
    name, surname,
    bill_email, bill_phone,
    bill_address1, bill_address2,
    bill_city, bill_state, bill_postcode, bill_country,
    currency_code = 'TRY',
    max_installment = 1,
    items = []
  } = body || {};

  // temel doğrulamalar
  if (!name || !surname)  return res.status(400).json({ ok:false, error:'REQ_NAME_SURNAME' });
  if (!bill_email)        return res.status(400).json({ ok:false, error:'REQ_EMAIL' });
  if (!bill_phone)        return res.status(400).json({ ok:false, error:'REQ_PHONE' });
  if (!Array.isArray(items) || items.length === 0)
    return res.status(400).json({ ok:false, error:'REQ_ITEMS' });

  const base = (env === 'test')
    ? 'https://provisioning.sipay.com.tr/ccpayment'
    : 'https://app.sipay.com.tr/ccpayment';

  // invoice ve toplam
  const invoiceArr = makeInvoiceArray(items);
  const total = totalFromInvoice(invoiceArr);
  if (!isFinite(total) || total <= 0) {
    return res.status(400).json({ ok:false, error:'BAD_TOTAL', detail:'items total must be > 0' });
  }

  // payload — Sipay purchase/link beklentisi
  const payload = {
    merchant_key: MERCHANT_KEY,
    invoice: JSON.stringify(invoiceArr),
    currency_code,
    name: normStr(name),
    surname: normStr(surname),
    bill_email: normStr(bill_email),
    bill_phone: sanitizePhone(bill_phone),
    bill_address1: normStr(bill_address1 || ''),
    bill_address2: normStr(bill_address2 || ''),
    bill_city: normStr(bill_city || ''),
    bill_state: normStr(bill_state || ''),
    bill_postcode: normStr(bill_postcode || ''),
    // Bazı ortamlarda ülke ismi yerine ISO tercih ediliyor — TR gönderelim:
    bill_country: normStr(bill_country || 'TR'),
    max_installment: parseInt(max_installment, 10) || 1,
    // Bazı kurulumlar IP bekliyor:
    ip: clientIp(req)
  };

  try {
    // Opsiyonel: Bearer token al
    const token = await tryGetToken(base, APP_ID, APP_SECRET);
    const headers = token ? { Authorization: `Bearer ${token}` } : {};

    const { status, json, raw } = await postJSON(`${base}/purchase/link`, payload, headers);

    if (status === 200 && json && json.status === true && json.link) {
      return res.status(200).json({
        ok: true,
        link: json.link,
        order_id: json.order_id || null
      });
    }

    // Sipay bazen HTML döndürüyor; debug için ham çıktıyı kısaltıp gönderelim
    const rawShort = typeof raw === 'string' ? raw.slice(0, 500) : null;
    return res.status(502).json({
      ok: false,
      error: 'SIPAY_ERROR',
      status,
      sipay: json || rawShort || null
    });

  } catch (err) {
    return res.status(500).json({ ok:false, error:'SERVER', detail: err.message });
  }
};
