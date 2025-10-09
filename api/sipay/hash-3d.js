// /api/sipay/hash-3d.js
// Vercel Serverless Function (Node.js / CommonJS)
// PHP örneği ile birebir uyumlu hash_key üretir.

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
    // Vercel, JSON gönderildiğinde req.body objesi dolu gelir; yine de fallback ekleyelim
    const body = typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');

    const {
      total,                 // "2649.00" ya da 2649
      currency_code = 'TRY', // "TRY"
      installments_number = '1', // "1"
      env = 'live'           // "live" | "test"
    } = body;

    // --- ENV değişkenleri (Vercel → Settings → Environment Variables) ---
    // SIPAY_MERCHANT_KEY  = Üyeişyeri Anahtarı (ör: $2y$10$F4a6x...)
    // SIPAY_APP_SECRET    = Uygulama Parolası  (ör: cb835b5b...)
    const merchant_key = process.env.SIPAY_MERCHANT_KEY;
    const app_secret   = process.env.SIPAY_APP_SECRET;

    if (!merchant_key || !app_secret) {
      return res.status(500).json({ ok:false, error:'ENV_MISSING', need:['SIPAY_MERCHANT_KEY','SIPAY_APP_SECRET'] });
    }

    // Base URL
    const base = env === 'test'
      ? (process.env.SIPAY_BASE_TEST || 'https://provisioning.sipay.com.tr/ccpayment')
      : (process.env.SIPAY_BASE_LIVE || 'https://app.sipay.com.tr/ccpayment');

    // Değerleri SİPAY’in beklediği string formatına sabitle
    const totalStr = Number(String(total).replace(',','.')).toFixed(2); // "2649.00"
    const currStr  = String(currency_code).toUpperCase();               // "TRY"
    const instStr  = String(installments_number);                        // "1"
    const invoice_id = `INV-${Date.now()}`;                              // benzersiz

    // PHP örneği: $data = $total . '|' . $installment . '|' . $currency_code . '|' . $merchant_key . '|' . $invoice_id;
    const data = `${totalStr}|${instStr}|${currStr}|${merchant_key}|${invoice_id}`;

    // ========= PHP ile %100 UYUMLU KRİPTO =========
    // PHP:
    // $iv    = substr(sha1(mt_rand()), 0, 16);
    // $pwd   = sha1($app_secret);
    // $salt  = substr(sha1(mt_rand()), 0, 4);
    // $key   = hash('sha256', $pwd . $salt); // hex string
    //
    // openssl_encrypt($data, 'aes-256-cbc', $key, null, $iv)
    // DİKKAT: PHP burada 'hex'i "hex decode" etmiyor; doğrudan UTF-8 string baytları olarak kullanıyor!

    const iv = crypto.createHash('sha1').update(Math.random().toString()).digest('hex').slice(0, 16); // 16 KARAKTER
    const passwordSha1 = crypto.createHash('sha1').update(app_secret).digest('hex');                  // hex string
    const salt = crypto.createHash('sha1').update(Math.random().toString()).digest('hex').slice(0, 4);// 4 KARAKTER
    const saltWithPassword = crypto.createHash('sha256').update(passwordSha1 + salt).digest('hex');   // hex string

    // EN ÖNEMLİ NOKTA: PHP ile aynı davranış için anahtarı ve IV'yi UTF-8 baytları olarak veriyoruz (HEX DEĞİL!)
    const cipher = crypto.createCipheriv(
      'aes-256-cbc',
      Buffer.from(saltWithPassword, 'utf8'), // <-- UTF-8 bytes (hex decode DEĞİL)
      Buffer.from(iv, 'utf8')                // <-- 16 byte, UTF-8
    );
    let enc = cipher.update(data, 'utf8', 'base64');
    enc += cipher.final('base64');

    // PHP: str_replace('/', '__', "$iv:$salt:$encrypted")
    const hash_key = `${iv}:${salt}:${enc}`.replace(/\//g, '__');

    return res.status(200).json({
      ok: true,
      base,
      merchant_key,
      invoice_id,
      hash_key,
      currency_code: currStr,
      installments_number: Number(instStr),
      total_str: totalStr
    });
  } catch (err) {
    return res.status(500).json({ ok:false, error:'SERVER', detail: String(err && err.message || err) });
  }
};
