// api/sipay/hash-3d.js  (Vercel Serverless Function - Node.js)
// CORS + paySmart3D hash üretimi (Sipay örneğiyle birebir)

const crypto = require('crypto');

function sha1Hex(str){ return crypto.createHash('sha1').update(String(str), 'utf8').digest('hex'); }
function sha256Hex(str){ return crypto.createHash('sha256').update(String(str), 'utf8').digest('hex'); }
function randSha1Prefix(len){ return crypto.createHash('sha1').update(crypto.randomBytes(16)).digest('hex').slice(0, len); }

function generateHashKey(totalStr, installments, currencyCode, merchantKey, invoiceId, appSecret){
  // Sipay’in istediği data dizilimi
  const data = `${totalStr}|${installments}|${currencyCode}|${merchantKey}|${invoiceId}`;

  const iv    = randSha1Prefix(16);         // 16 char
  const salt  = randSha1Prefix(4);          // 4 char
  const pass  = sha1Hex(appSecret);         // sha1(app_secret) hex
  const keyHex= sha256Hex(pass + salt);     // sha256(pass+salt) hex -> 32 bytes
  const key   = Buffer.from(keyHex, 'hex');
  const ivBuf = Buffer.from(iv, 'utf8');    // 16-byte IV

  const cipher = crypto.createCipheriv('aes-256-cbc', key, ivBuf);
  let enc = cipher.update(data, 'utf8', 'base64');
  enc += cipher.final('base64');

  // Yalnızca "/" → "__" dönüşümü
  return `${iv}:${salt}:${enc}`.replace(/\//g, '__');
}

// ===== CORS =====
const ORIGIN_WHITELIST = new Set([
  'https://do-lab.co',
  'https://www.do-lab.co',
  'https://readymag.com',
  'https://my.readymag.com',
  'http://localhost:3000',
  'http://localhost'
]);
function setCORS(req, res){
  const origin = req.headers.origin;
  if (origin && ORIGIN_WHITELIST.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    // istersen '*' bırakabilirsin; ama whitelist daha güvenli
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

async function readJson(req){
  const raw = await new Promise((resolve, reject)=>{
    let d=''; req.on('data', c=> d+=c);
    req.on('end', ()=> resolve(d)); req.on('error', reject);
  });
  return raw ? JSON.parse(raw) : {};
}

module.exports = async (req, res) => {
  setCORS(req, res);

  // Preflight
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  // Basit GET: route doğrulama/test (Network tab’dan header’ları görmek için)
  if (req.method === 'GET') {
    return res.status(200).json({ ok:true, route:'/api/sipay/hash-3d', method:'GET' });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST,OPTIONS,GET');
    return res.status(405).json({ ok:false, error:'METHOD' });
  }

  try{
    const body = await readJson(req);

    // ENV seçimi
    const envFlag = (body.env || 'live').toLowerCase();
    const base = (envFlag === 'test')
      ? (process.env.SIPAY_BASE || 'https://provisioning.sipay.com.tr/ccpayment')
      : (process.env.SIPAY_BASE_LIVE || 'https://app.sipay.com.tr/ccpayment');

    // Tutarlı isimler (senin dediğin gibi tek isim kullanıyoruz):
    const merchantKey = process.env.SIPAY_MERCHANT_KEY;
    const appSecret   = process.env.SIPAY_APP_SECRET;

    if(!merchantKey || !appSecret){
      return res.status(500).json({ ok:false, error:'CONFIG', detail:'Missing SIPAY_MERCHANT_KEY or SIPAY_APP_SECRET' });
    }

    const totalNum = Number(body.total);
    if(!isFinite(totalNum) || totalNum <= 0){
      return res.status(400).json({ ok:false, error:'BAD_TOTAL' });
    }
    const totalStr = totalNum.toFixed(2);

    const currency = String(body.currency_code || 'TRY').toUpperCase();
    const inst     = parseInt(body.installments_number ?? 1, 10) || 1;

    const invoiceId = body.invoice_id && String(body.invoice_id).trim()
      ? String(body.invoice_id)
      : `INV-${Date.now()}`;

    // HASH üret
    const hashKey = generateHashKey(totalStr, inst, currency, merchantKey, invoiceId, appSecret);

    // Başarı
    return res.status(200).json({
      ok: true,
      base,
      merchant_key: merchantKey,
      invoice_id: invoiceId,
      hash_key: hashKey,
      currency_code: currency,
      installments_number: inst,
      total_str: totalStr
    });
  }catch(err){
    // Her hata durumunda da CORS header’ları zaten set edildi
    return res.status(500).json({ ok:false, error:'SERVER', detail: String(err && err.message || err) });
  }
};
