// api/sipay/hash-3d.js (Vercel – Node.js serverless)
// CORS + Sipay paySmart3D hash üretimi

const crypto = require('crypto');

function sha1Hex(s){ return crypto.createHash('sha1').update(String(s),'utf8').digest('hex'); }
function sha256Hex(s){ return crypto.createHash('sha256').update(String(s),'utf8').digest('hex'); }
function randHex(len){ return crypto.createHash('sha1').update(crypto.randomBytes(16)).digest('hex').slice(0,len); }

function generateHashKey(totalStr, inst, currency, merchantKey, invoiceId, appSecret){
  // Sipay format: total|installments|currency|merchant_key|invoice_id
  const data = `${totalStr}|${inst}|${currency}|${merchantKey}|${invoiceId}`;

  const iv   = randHex(16);          // 16 char
  const salt = randHex(4);           // 4 char
  const pass = sha1Hex(appSecret);   // sha1(app_secret)
  const keyH = sha256Hex(pass + salt);
  const key  = Buffer.from(keyH, 'hex');
  const ivB  = Buffer.from(iv, 'utf8');

  const cipher = crypto.createCipheriv('aes-256-cbc', key, ivB);
  let enc = cipher.update(data, 'utf8', 'base64');
  enc += cipher.final('base64');

  return `${iv}:${salt}:${enc}`.replace(/\//g,'__');
}

// ---- CORS (agresif) ----
function setCORS(req, res){
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary','Origin');
  res.setHeader('Access-Control-Allow-Methods','POST,GET,OPTIONS');
  // Bazı ortamlar otomatik olarak "accept, content-type" soruyor → hepsini aç
  res.setHeader('Access-Control-Allow-Headers','*');
  res.setHeader('Access-Control-Max-Age','86400');
}

async function readJson(req){
  const raw = await new Promise((resolve, reject)=>{
    let d=''; req.on('data', c=> d+=c);
    req.on('end', ()=> resolve(d)); req.on('error', reject);
  });
  return raw ? JSON.parse(raw) : {};
}

module.exports = async (req, res) => {
  setCORS(req,res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method === 'GET')     return res.status(200).json({ ok:true, route:'/api/sipay/hash-3d', method:'GET' });
  if (req.method !== 'POST'){ res.setHeader('Allow','POST,GET,OPTIONS'); return res.status(405).json({ok:false,error:'METHOD'}); }

  try{
    const body = await readJson(req);

    // === Tek isim: ortam değişkenleri (Production + Preview’larda aynı ad) ===
    const merchantKey = process.env.SIPAY_MERCHANT_KEY;
    const appSecret   = process.env.SIPAY_APP_SECRET;
    const baseLive    = process.env.SIPAY_BASE_LIVE || 'https://app.sipay.com.tr/ccpayment';
    const baseTest    = process.env.SIPAY_BASE     || 'https://provisioning.sipay.com.tr/ccpayment';

    if(!merchantKey || !appSecret){
      return res.status(500).json({ ok:false, error:'CONFIG', detail:'Missing SIPAY_MERCHANT_KEY or SIPAY_APP_SECRET' });
    }

    const env   = String(body.env||'live').toLowerCase();
    const base  = env === 'test' ? baseTest : baseLive;

    const totalNum = Number(body.total);
    if(!isFinite(totalNum) || totalNum<=0) return res.status(400).json({ ok:false, error:'BAD_TOTAL' });
    const totalStr = totalNum.toFixed(2);

    const currency = String(body.currency_code||'TRY').toUpperCase();
    const inst     = parseInt(body.installments_number ?? 1, 10) || 1;

    const invoiceId = (body.invoice_id && String(body.invoice_id).trim())
      ? String(body.invoice_id)
      : `INV-${Date.now()}`;

    const hash_key = generateHashKey(totalStr, inst, currency, merchantKey, invoiceId, appSecret);

    return res.status(200).json({
      ok: true,
      base,
      merchant_key: merchantKey,
      invoice_id: invoiceId,
      hash_key,
      currency_code: currency,
      installments_number: inst,
      total_str: totalStr
    });
  }catch(err){
    return res.status(500).json({ ok:false, error:'SERVER', detail: String(err?.message||err) });
  }
};
