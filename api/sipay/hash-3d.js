// api/sipay/hash-3d.js
// Vercel Node.js Serverless Function (CommonJS)

const crypto = require('crypto');

function toMoney2(n) {
  const num = Number(n || 0);
  return num.toFixed(2); // "1299.00"
}

function genInvoiceId() {
  return 'INV-' + Date.now();
}

// Sipay hash üretimi (dokümandaki PHP örneğinin Node karşılığı)
function generateHashKey(total, installments, currency_code, merchant_key, invoice_id, app_secret) {
  // data = total|installments|currency_code|merchant_key|invoice_id
  const data = [
    toMoney2(total),
    String(installments),
    String(currency_code),
    String(merchant_key),
    String(invoice_id),
  ].join('|');

  const iv = crypto.createHash('sha1').update(String(Math.random())).digest('hex').slice(0, 16);
  const password = crypto.createHash('sha1').update(String(app_secret)).digest('hex'); // sha1(app_secret)

  const salt = crypto.createHash('sha1').update(String(Math.random())).digest('hex').slice(0, 4);
  const saltWithPassword = crypto.createHash('sha256').update(password + salt).digest(); // Buffer

  const cipher = crypto.createCipheriv('aes-256-cbc', saltWithPassword, iv);
  let encrypted = cipher.update(data, 'utf8', 'base64');
  encrypted += cipher.final('base64');

  const bundle = `${iv}:${salt}:${encrypted}`;
  return bundle.replace(/\//g, '__'); // PHP örneğindeki gibi '/' → '__'
}

// Vercel (Node) body reader
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  let body;
  try { body = await readJsonBody(req); }
  catch (e) {
    return res.status(400).json({ ok: false, error: 'BAD_JSON', detail: String(e && e.message || e) });
  }

  // İstekten gelenler
  const {
    total,                   // number | string
    currency_code = 'TRY',   // "TRY"
    installments_number = 1, // integer
    env = 'live',            // "live" | "test"
  } = body || {};

  const MODE = (String(env).toLowerCase() === 'test') ? 'TEST' : 'LIVE';

  // Sadece *_LIVE / *_TEST isimleri
  const MERCHANT_KEY = process.env[`SIPAY_MERCHANT_KEY_${MODE}`];
  const APP_SECRET   = process.env[`SIPAY_APP_SECRET_${MODE}`];
  const BASE_DEFAULT = (MODE === 'LIVE')
    ? 'https://app.sipay.com.tr/ccpayment'
    : 'https://provisioning.sipay.com.tr/ccpayment';
  const BASE = process.env[`SIPAY_BASE_${MODE}`] || BASE_DEFAULT;

  if (!MERCHANT_KEY || !APP_SECRET) {
    return res.status(500).json({
      ok: false,
      error: 'CONFIG',
      detail: `Missing SIPAY_MERCHANT_KEY_${MODE} or SIPAY_APP_SECRET_${MODE}`
    });
  }

  // total zorunlu ve 0'dan büyük
  const totalNum = Number(total);
  if (!isFinite(totalNum) || totalNum <= 0) {
    return res.status(400).json({ ok: false, error: 'BAD_TOTAL' });
  }

  const invoice_id = genInvoiceId();
  const hash_key = generateHashKey(
    totalNum,
    Number(installments_number || 1),
    String(currency_code || 'TRY'),
    MERCHANT_KEY,
    invoice_id,
    APP_SECRET
  );

  return res.status(200).json({
    ok: true,
    merchant_key: MERCHANT_KEY,
    invoice_id,
    hash_key,
    currency_code: String(currency_code || 'TRY'),
    installments_number: Number(installments_number || 1),
    base: BASE,
  });
};
