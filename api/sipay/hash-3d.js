// /api/sipay/hash-3d.js
// Vercel Serverless Function (Node.js / CommonJS)
// Sipay'in PHP örneğiyle birebir hash_key üretir (anahtarı 32 ASCII bayta kırpar).

const crypto = require('crypto');

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok:false, error:'METHOD_NOT_ALLOWED' });
  }

  try {
    const body = typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');

    const {
      total,                       // 2649 veya "2649.00"
      currency_code = 'TRY',       // "TRY"
      installments_number = 1,     // 1
      env = 'live'                 // "live" | "test"
    } = body;

    // --- ENV: Vercel → Settings → Environment Variables ---
    const merchant_key = process.env.SIPAY_MERCHANT_KEY; // Üyeişyeri Anahtarı
    const app_secret   = process.env.SIPAY_APP_SECRET;   // Uygulama Parolası

    if (!merchant_key || !app_secret) {
      return res.status(500).json({
        ok:false, error:'ENV_MISSING',
        need:['SIPAY_MERCHANT_KEY','SIPAY_APP_SECRET']
      });
    }

    const base = env === 'test'
      ? (process.env.SIPAY_BASE_TEST || 'https://provisioning.sipay.com.tr/ccpayment')
      : (process.env.SIPAY_BASE_LIVE || 'https://app.sipay.com.tr/ccpayment');

    // Sipay'in kullandığı string formatlar
    const totalStr = Number(String(total).replace(',','.')).toFixed(2); // "2649.00"
    const currStr  = String(currency_code).toUpperCase();               // "TRY"
    const instStr  = String(installments_number);                       // "1"
    const invoice_id = `INV-${Date.now()}`;

    // PHP: $data = $total.'|'.$installment.'|'.$currency_code.'|'.$merchant_key.'|'.$invoice_id;
    const data = `${totalStr}|${instStr}|${currStr}|${merchant_key}|${invoice_id}`;

    // ===== PHP ile birebir kripto =====
    // PHP:
    // $iv   = substr(sha1(mt_rand()), 0, 16);
    // $pwd  = sha1($app_secret);               // 40 char hex
    // $salt = substr(sha1(mt_rand()), 0, 4);
    // $keyHex = hash('sha256', $pwd.$salt);     // 64 char hex
    // openssl_encrypt($data,'aes-256-cbc',$keyHex,0,$iv)
    // Not: PHP burada keyHex'i "hex decode" ETMİYOR; 64 karakterlik ASCII string veriyor,
    // OpenSSL 32 byte gerektiği için İLK **32 BYTE**'ı kullanıyor (ASCII → 1 char = 1 byte).
    // Biz de aynısını yapıyoruz: 64 karakterin ilk 32 karakterini alıyoruz.

    const iv = crypto.createHash('sha1')
      .update(Math.random().toString())
      .digest('hex')
      .slice(0, 16); // 16 char → 16 byte IV

    const passwordSha1 = crypto.createHash('sha1')
      .update(app_secret)
      .digest('hex'); // 40 char hex (ASCII)

    const salt = crypto.createHash('sha1')
      .update(Math.random().toString())
      .digest('hex')
      .slice(0, 4);   // 4 char

    const keyHex = crypto.createHash('sha256')
      .update(passwordSha1 + salt)
      .digest('hex'); // 64 char hex (ASCII)

    // KRİTİK: ilk 32 karakteri (32 BYTE) al → AES-256 anahtarı
    const key = Buffer.from(keyHex.slice(0, 32), 'utf8'); // 32 byte
    const ivBuf = Buffer.from(iv, 'utf8');                // 16 byte

    const cipher = crypto.createCipheriv('aes-256-cbc', key, ivBuf);
    let encrypted = cipher.update(data, 'utf8', 'base64');
    encrypted += cipher.final('base64');

    // PHP: str_replace('/', '__', "$iv:$salt:$encrypted")
    const hash_key = `${iv}:${salt}:${encrypted}`.replace(/\//g, '__');

    return res.status(200).json({
      ok: true,
      base,
      merchant_key,
      invoice_id,
      hash_key,
      currency_code: currStr,
      installments_number: Number(instStr),
      total_str: totalStr,
      // küçük bir kontrol için (isteğe bağlı)
      _debug: { key_len: key.length, iv_len: ivBuf.length }
    });
  } catch (err) {
    return res.status(500).json({ ok:false, error:'SERVER', detail: String(err && err.message || err) });
  }
};
