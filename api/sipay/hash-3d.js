// api/sipay/hash-3d.js
// Vercel Serverless (Node/Edge değil), CommonJS
'use strict';
const crypto = require('crypto');

/* ---------- CORS ---------- */
const ALLOW_ORIGINS = ['*']; // Güvenlik için: '*'
function setCORS(req, res) {
  const origin = req.headers.origin || '';
  let allow = '*';
  res.setHeader('Access-Control-Allow-Origin', allow);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST,GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Access-Control-Max-Age', '86400');
}

/* ---------- Yardımcılar ---------- */
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

function pickSecrets(isLive) {
  const env = process.env;
  const merchant_key = isLive
    ? (env.SIPAY_MERCHANT_KEY || env.SIPAY_MERCHANT_KEY_LIVE)
    : (env.SIPAY_MERCHANT_KEY_TEST || env.SIPAY_MERCHANT_KEY);
  const app_secret = isLive
    ? (env.SIPAY_APP_SECRET || env.SIPAY_APP_SECRET_LIVE)
    : (env.SIPAY_APP_SECRET_TEST || env.SIPAY_APP_SECRET);
  return { merchant_key, app_secret };
}

function makeHash({ total, installments_number, currency_code, merchant_key, invoice_id, app_secret }) {
  // PHP örneği ile aynı algoritma
  const data = `${two(total)}|${installments_number}|${currency_code}|${merchant_key}|${invoice_id}`;
  const iv = crypto.createHash('sha1').update(String(Math.random())).digest('hex').substring(0, 16);
  const password = crypto.createHash('sha1').update(app_secret).digest('hex');
  const salt = crypto.createHash('sha1').update(String(Math.random())).digest('hex').substring(0, 4);
  const saltWithPassword = crypto.createHash('sha256').update(password + salt).digest();
  const cipher = crypto.createCipheriv('aes-256-cbc', saltWithPassword, Buffer.from(iv, 'utf8'));
  const enc = Buffer.concat([cipher.update(Buffer.from(data, 'utf8')), cipher.final()]).toString('base64');
  return `${iv}:${salt}:${enc}`.replace(/\//g, '__');
}

/* ---------- Handler ---------- */
module.exports = async (req, res) => {
  setCORS(req, res);

  // Preflight
  if (req.method === 'OPTIONS') return res.status(204).end();

  // Sağlık kontrolü (GET ile bakılabilir)
  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, route: '/api/sipay/hash-3d', method: 'GET' });
  }

  // Sadece POST gerçek iş yapar
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST,GET,OPTIONS');
    return res.status(405).json({ ok: false, error: 'METHOD' });
  }

  // Gövde
  let body;
  try { body = await readJSON(req); }
  catch (e) { return res.status(400).json({ ok: false, error: 'BAD_JSON', detail: e.message }); }

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
    return res.status(500).json({ ok: false, error: 'CONFIG', detail: 'Missing SIPAY_MERCHANT_KEY/SIPAY_APP_SECRET' });
  }

  // Her çağrıda tekil invoice
  const invoice_id = `INV-${Date.now()}`;

  let hash_key;
  try {
    hash_key = makeHash({ total, installments_number, currency_code, merchant_key, invoice_id, app_secret });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'HASH', detail: e.message });
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
