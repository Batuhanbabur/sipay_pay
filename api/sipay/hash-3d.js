// api/sipay/hash-3d.js
const crypto = require('crypto');

function sha1Hex(str){ return crypto.createHash('sha1').update(String(str), 'utf8').digest('hex'); }
function sha256Hex(str){ return crypto.createHash('sha256').update(String(str), 'utf8').digest('hex'); }
function randSha1Prefix(len){ return crypto.createHash('sha1').update(crypto.randomBytes(16)).digest('hex').slice(0, len); }

// PHP doksuyla birebir aynı algoritma
function generateHashKey(totalStr, installments, currencyCode, merchantKey, invoiceId, appSecret){
  const data = `${totalStr}|${installments}|${currencyCode}|${merchantKey}|${invoiceId}`;

  const iv    = randSha1Prefix(16);                    // 16 karakter
  const salt  = randSha1Prefix(4);                     // 4 karakter
  const pass  = sha1Hex(appSecret);                    // sha1(app_secret) -> hex
  const keyHex= sha256Hex(pass + salt);                // sha256(pass + salt) -> hex(64)
  const key   = Buffer.from(keyHex, 'hex');            // 32 byte
  const ivBuf = Buffer.from(iv, 'utf8');               // 16 byte

  const cipher = crypto.createCipheriv('aes-256-cbc', key, ivBuf);
  let enc = cipher.update(data, 'utf8', 'base64');
  enc += cipher.final('base64');

  const bundle = `${iv}:${salt}:${enc}`.replace(/\//g, '__'); // sadece "/" -> "__"
  return bundle;
}

async function readJson(req){
  const raw = await new Promise((resolve, reject)=>{
    let d=''; req.on('data', c=> d+=c);
    req.on('end', ()=> resolve(d)); req.on('error', reject);
  });
  return raw ? JSON.parse(raw) : {};
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok:false, error:'METHOD' });
  }

  try{
    const body = await readJson(req);

    const envFlag  = (body.env || 'live').toLowerCase();
    const base     = (envFlag === 'test')
      ? (process.env.SIPAY_BASE || 'https://provisioning.sipay.com.tr/ccpayment')
      : (process.env.SIPAY_BASE_LIVE || 'https://app.sipay.com.tr/ccpayment');

    // ENV VARS (canlı isimler)
    const merchantKey = process.env.SIPAY_MERCHANT_KEY || process.env.SIPAY_MERCHANT_KEY_LIVE;
    const appSecret   = process.env.SIPAY_APP_SECRET   || process.env.SIPAY_APP_SECRET_LIVE;

    if(!merchantKey || !appSecret){
      return res.status(500).json({ ok:false, error:'CONFIG', detail:'Missing SIPAY_MERCHANT_KEY or SIPAY_APP_SECRET' });
    }

    // total -> kesin "xx.yy" string
    const totalNum = Number(body.total);
    if(!isFinite(totalNum) || totalNum <= 0){
      return res.status(400).json({ ok:false, error:'BAD_TOTAL' });
    }
    const totalStr = totalNum.toFixed(2);

    const currency  = String(body.currency_code || 'TRY').toUpperCase();
    const inst      = parseInt(body.installments_number ?? 1, 10) || 1;

    // benzersiz invoice_id
    const invoiceId = body.invoice_id && String(body.invoice_id).trim()
      ? String(body.invoice_id)
      : `INV-${Date.now()}`;

    const hashKey = generateHashKey(totalStr, inst, currency, merchantKey, invoiceId, appSecret);

    return res.status(200).json({
      ok: true,
      base,
      merchant_key: merchantKey,
      invoice_id: invoiceId,
      hash_key: hashKey,
      currency_code: currency,
      installments_number: inst,
      total_str: totalStr,             // ← checkout bunu aynen kullanacak
    });
  }catch(err){
    return res.status(500).json({ ok:false, error:'SERVER', detail: String(err && err.message || err) });
  }
};
