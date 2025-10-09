// File: /api/sipay/hash-3d.js
import crypto from 'crypto';

function cors(res, origin = '*') {
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sha1Hex(s)  { return crypto.createHash('sha1').update(String(s), 'utf8').digest('hex'); }
function sha256Hex(s){ return crypto.createHash('sha256').update(String(s), 'utf8').digest('hex'); }

// PHP örneğini birebir taklit eden hash üretimi.
// DİKKAT: PHP, hex çıktıları "ascii string" olarak verip OpenSSL'e gönderiyor.
// Node tarafında da 32 BYTELIK key gerektirdiği için ilk 32 ascii karakteri alıp kullanıyoruz.
function generateHashKey(totalStr, installment, currency, merchant_key, invoice_id, app_secret) {
  const data = `${totalStr}|${installment}|${currency}|${merchant_key}|${invoice_id}`;

  // PHP: $iv = substr(sha1(mt_rand()), 0, 16);  --> 16 ASCII karakter
  const ivStr   = sha1Hex(Math.random()).slice(0, 16);
  const ivBuf   = Buffer.from(ivStr, 'utf8');

  // PHP: $password = sha1($app_secret);  (hex string, 40 char)
  const passwordHex = sha1Hex(app_secret);

  // PHP: $salt = substr(sha1(mt_rand()), 0, 4); --> 4 ASCII karakter
  const saltStr = sha1Hex(Math.random()).slice(0, 4);

  // PHP: $saltWithPassword = hash('sha256', $password . $salt); // 64 char hex STRING
  const saltWithPasswordHex = sha256Hex(passwordHex + saltStr);

  // PHP openssl_encrypt string key'i kabul ediyor; Node 32 byte istiyor.
  // Bu yüzden ilk 32 ASCII KARAKTERİ alıp 32 byte'lık key yapıyoruz (PHP'nin truncate davranışı).
  const keyBuf = Buffer.from(saltWithPasswordHex.slice(0, 32), 'utf8');

  const cipher = crypto.createCipheriv('aes-256-cbc', keyBuf, ivBuf);
  let encrypted = cipher.update(data, 'utf8', 'base64');
  encrypted += cipher.final('base64');

  // PHP: $msg = "$iv:$salt:$encrypted"; sonra str_replace('/', '__', $msg)
  const bundle = `${ivStr}:${saltStr}:${encrypted}`.replace(/\//g, '__');
  return bundle;
}

export default async function handler(req, res) {
  cors(res, '*');
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ ok:false, error:'METHOD' });
  }

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
    try { body = await (req.body && typeof req.body === 'object' ? req.body : JSON.parse(req.body||'{}')); } catch(_){ body = {}; }

    const {
      total,
      currency_code = 'TRY',
      installments_number = 1,
      env = 'live'
    } = body || {};

    // total -> tam 2 ondalık string; hash ve POST’ta bu KULLANILACAK
    const totalNum = Number(total);
    if (!isFinite(totalNum) || totalNum <= 0) {
      return res.status(400).json({ ok:false, error:'BAD_TOTAL' });
    }
    const totalStr = totalNum.toFixed(2);  // "2649.00" gibi

    // benzersiz invoice id
    const invoice_id = `INV-${Date.now()}-${Math.floor(Math.random()*1000)}`;

    const base = env === 'test' ? SIPAY_BASE_TEST : SIPAY_BASE_LIVE;

    // Hash üret
    const hash_key = generateHashKey(
      totalStr,
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
      total_str: totalStr
    });
  } catch (err) {
    return res.status(500).json({ ok:false, error:'SERVER', detail: String(err && err.message || err) });
  }
}
