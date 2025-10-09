// File: /api/sipay/hash-3d.js
import crypto from 'crypto';

function cors(res, origin = '*') {
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

const sha1Hex   = (s) => crypto.createHash('sha1').update(String(s), 'utf8').digest('hex');
const sha256Hex = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');

/**
 * PHP eşleniği:
 * $iv  = substr(sha1(mt_rand()), 0, 16);
 * $salt = substr(sha1(mt_rand()), 0, 4);
 * $password = sha1($app_secret);
 * $saltWithPassword = hash('sha256', $password.$salt); // 64 hex
 * $key = hex2bin($saltWithPassword); // 32 raw byte  <-- kritik nokta
 * $enc = openssl_encrypt("$total|$inst|$cur|$mkey|$inv", 'AES-256-CBC', $key, 0, $iv);
 * $hash_key = str_replace('/', '__', "$iv:$salt:$enc");
 */
function generateHashKey(totalStr, installments, currency, merchant_key, invoice_id, app_secret) {
  const data = `${totalStr}|${installments}|${currency}|${merchant_key}|${invoice_id}`;

  // IV ve salt (PHP’deki gibi sha1(mt_rand()) türevi)
  const ivStr   = sha1Hex(crypto.randomBytes(16)).slice(0, 16); // 16 ascii char
  const saltStr = sha1Hex(crypto.randomBytes(16)).slice(0, 4);  // 4 ascii char

  // Şifre -> sha1 hex
  const passwordHex = sha1Hex(app_secret);

  // Saltlı şifre -> sha256 hex (64)
  const saltWithPasswordHex = sha256Hex(passwordHex + saltStr);

  // *** KRİTİK ***: Hex'i ASCII olarak kullanmak yerine IKILIK (raw) 32 bayta çevir
  const keyBuf = Buffer.from(saltWithPasswordHex, 'hex'); // 32 bytes
  const ivBuf  = Buffer.from(ivStr, 'utf8');              // 16 bytes

  const cipher = crypto.createCipheriv('aes-256-cbc', keyBuf, ivBuf);
  let encrypted = cipher.update(data, 'utf8', 'base64');
  encrypted += cipher.final('base64');

  return `${ivStr}:${saltStr}:${encrypted}`.replace(/\//g, '__');
}

export default async function handler(req, res) {
  cors(res, '*');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')   return res.status(405).json({ ok:false, error:'METHOD' });

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
    try {
      body = typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');
    } catch { body = {}; }

    const {
      total,
      currency_code = 'TRY',
      installments_number = 1,
      env = 'live',
    } = body || {};

    const totalNum = Number(total);
    if (!isFinite(totalNum) || totalNum <= 0) {
      return res.status(400).json({ ok:false, error:'BAD_TOTAL' });
    }
    const totalStr = totalNum.toFixed(2); // "649.00"

    // PHP örneklerindeki gibi sade bir invoice id
    const invoice_id = `INV-${Date.now()}`;

    const base = env === 'test' ? SIPAY_BASE_TEST : SIPAY_BASE_LIVE;

    const hash_key = generateHashKey(
      totalStr,
      String(installments_number),
      String(currency_code),
      String(SIPAY_MERCHANT_KEY),
      String(invoice_id),
      String(SIPAY_APP_SECRET),
    );

    return res.status(200).json({
      ok: true,
      base,
      merchant_key: SIPAY_MERCHANT_KEY,
      invoice_id,
      hash_key,
      currency_code,
      installments_number,
      total_str: totalStr,
    });
  } catch (err) {
    return res.status(500).json({ ok:false, error:'SERVER', detail: String(err?.message || err) });
  }
}
