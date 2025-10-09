// api/sipay/hash-3d.js  (Vercel Serverless - Node.js, CommonJS)
'use strict';
const crypto = require('crypto');

/* ===== CORS ===== */
function setCORS(req, res) {
  // Test için tüm origin'lere izin: istersen buraya 'https://do-lab.co' yazıp sabitle.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST,GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Access-Control-Max-Age', '86400');
}

/* ===== Body okuma (fallback) ===== */
function readJSON(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', c => (raw += c));
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

const two = n => Number(n).toFixed(2);

/* ===== Ortam değişkenleri ===== */
function pickSecrets(isLive) {
  const env = process.env;
  // Tek isim kullanıyoruz: SIPAY_MERCHANT_KEY, SIPAY_APP_SECRET
  // (ileride _LIVE/_TEST eklersen yine buradan türetebilirsin)
  const merchant_key = env.SIPAY_MERCHANT_KEY;
  const app_secret   = env.SIPAY_APP_SECRET;
  return { merchant_key, app_secret };
}

/* ===== Hash üretimi (Sipay örneği ile aynı) ===== */
function makeHash({ total, installments_number, currency_code, merchant_key, invoice_id, app_secret }) {
  const data = `${two(total)}|${installments_number}|${currency_code}|${merchant_key}|${invoice_id}`;
  const iv = crypto.createHash('sha1').update(String(Math.random())).digest('hex').substring(0, 16);
  const password = crypto.createHash('sha1').update(app_secret).digest('hex');
  const salt = crypto.createHash('sha1').update(String(Math.random())).digest('hex').substring(0, 4);
  const saltWithPassword = crypto.createHash('sha256').update(password + salt).digest();
  const cipher = crypto.createCipheriv('aes-256-cbc', saltWithPassword, Buffer.from(iv, 'utf8'));
  const enc = Buffer.concat([cipher.update(Buffer.from(data, 'utf8')), cipher.final()]).toString('base64');
  return `${iv}:${salt}:${enc}`.replace(/\//g, '__');
}

/* ===== Handler ===== */
module.exports = async (req, res) => {
  setCORS(req, res); // CORS’u HER path’te önce ayarla

  // Preflight
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  // Health check
  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, route: '/api/sipay/hash-3d', method: 'GET' });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST,GET,OPTIONS');
    return res.status(405).json({ ok: false, error: 'METHOD' });
  }

  // Body: önce req.body (Vercel bodyParser varsa), yoksa stream
  let body = req.body;
  if (!body || typeof body !== 'object') {
    try { body = await readJSON(req); }
    catch (e) { return res.status(400).json({ ok:false, error:'BAD_JSON', detail:e.message }); }
  }

  const env = String(body.env || 'live').toLowerCase();
  const isLive = env === 'live';
  const base = isLive
    ? 'https://app.sipay.com.tr/ccpayment'
    : 'https://provisioning.sipay.com.tr/ccpayment';

  const currency_code = String(body.currency_code || 'TRY').toUpperCase();
  const installments_number = Number(body.installments_number || 1);
  const total = Number(body.total);

  if (!isFinite(total) || total <= 0) {
    return res.status(400).json({ ok: false, error: 'BAD_TOTAL' });
  }

  const { merchant_key, app_secret } = pickSecrets(isLive);
  if (!merchant_key || !app_secret) {
    return res.status(500).json({ ok:false, error:'CONFIG', detail:'Missing SIPAY_MERCHANT_KEY or SIPAY_APP_SECRET' });
  }

  const invoice_id = `INV-${Date.now()}`;

  let hash_key;
  try {
    hash_key = makeHash({ total, installments_number, currency_code, merchant_key, invoice_id, app_secret });
  } catch (e) {
    return res.status(500).json({ ok:false, error:'HASH', detail:e.message });
  }

  return res.status(200).json({
    ok: true,
    merchant_key,
    invoice_id,
    hash_key,
    currency_code,
    installments_number,
    base
  });
};
