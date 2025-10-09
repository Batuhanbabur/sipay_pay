// File: /api/sipay/hash-3d.js
import crypto from 'crypto';

function cors(res, origin = '*') {
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

const sha1Hex   = (s) => crypto.createHash('sha1').update(String(s),'utf8').digest('hex');
const sha256Hex = (s) => crypto.createHash('sha256').update(String(s),'utf8').digest('hex');

// PHP örneğiyle birebir aynı mantık
function generateHashKey(totalStr, installment, currency, merchant_key, invoice_id, app_secret) {
  const data = `${totalStr}|${installment}|${currency}|${merchant_key}|${invoice_id}`;

  const ivStr = sha1Hex(Math.random()).slice(0,16);            // 16 ascii
  const ivBuf = Buffer.from(ivStr,'utf8');

  const passwordHex = sha1Hex(app_secret);                     // 40 char hex (ascii)
  const saltStr = sha1Hex(Math.random()).slice(0,4);           // 4 ascii
  const saltWithPasswordHex = sha256Hex(passwordHex + saltStr);// 64 char hex (ascii)

  // PHP openssl_encrypt string key'i doğrudan alıyor; biz de ilk 32 ascii karakteri kullanıyoruz (truncate)
  const keyBuf = Buffer.from(saltWithPasswordHex.slice(0,32),'utf8');

  const cipher = crypto.createCipheriv('aes-256-cbc', keyBuf, ivBuf);
  let encrypted = cipher.update(data, 'utf8', 'base64');
  encrypted += cipher.final('base64');

  return `${ivStr}:${saltStr}:${encrypted}`.replace(/\//g,'__');
}

// Tutarı Sipay ile uyumlu TEK formatta üret:
// Tam sayı ise "2649", kuruş varsa "2649.50"
function canonicalTotalStr(n) {
  const cents = Math.round(Number(n) * 100);
  if (!Number.isFinite(cents) || cents <= 0) return null;
  if (cents % 100 === 0) return String(cents / 100);
  const s = (cents / 100).toFixed(2);
  // (ör. 12.30 → 12.30 kalsın; yalnız .00 tam sayılarda zaten yukarıda eleniyor)
  return s;
}

export default async function handler(req,res){
  cors(res,'*');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ok:false,error:'METHOD'});

  const {
    SIPAY_MERCHANT_KEY = '',
    SIPAY_APP_SECRET   = '',
    SIPAY_BASE_LIVE    = 'https://app.sipay.com.tr/ccpayment',
    SIPAY_BASE_TEST    = 'https://provisioning.sipay.com.tr/ccpayment',
  } = process.env;

  if (!SIPAY_MERCHANT_KEY || !SIPAY_APP_SECRET) {
    return res.status(500).json({ ok:false, error:'CONFIG', detail:'Missing SIPAY_MERCHANT_KEY or SIPAY_APP_SECRET' });
  }

  try {
    let body = {};
    try { body = typeof req.body === 'object' ? req.body : JSON.parse(req.body||'{}'); } catch { body = {}; }

    const {
      total,
      currency_code = 'TRY',
      installments_number = 1,
      env = 'live'
    } = body || {};

    const total_str = canonicalTotalStr(total);
    if (!total_str) return res.status(400).json({ ok:false, error:'BAD_TOTAL' });

    const invoice_id = `INV-${Date.now()}`; // benzersiz
    const base = env === 'test' ? SIPAY_BASE_TEST : SIPAY_BASE_LIVE;

    const hash_key = generateHashKey(
      total_str,
      String(installments_number),
      String(currency_code),
      String(SIPAY_MERCHANT_KEY),
      String(invoice_id),
      String(SIPAY_APP_SECRET)
    );

    return res.status(200).json({
      ok: true,
      base,
      merchant_key: SIPAY_MERCHANT_KEY,
      invoice_id,
      hash_key,
      currency_code,
      installments_number,
      total_str // ← **Kanonik** string (ör. "2649" veya "2649.50")
    });
  } catch (e) {
    return res.status(500).json({ ok:false, error:'SERVER', detail:String(e?.message||e) });
  }
}
