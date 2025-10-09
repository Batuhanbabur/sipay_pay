// Vercel Serverless (Node 18+)
// PaySmart3D için invoice_id + hash_key üretir + CORS/OPTIONS desteği

const crypto = require('crypto');

const ALLOW_ORIGIN = process.env.CORS_ORIGIN || '*'; // İstersen Readymag alan adını yaz: https://your.readymag.site

function setCORS(res){
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
}

function readJson(req){
  return new Promise((resolve,reject)=>{
    let s=''; req.on('data',c=>s+=c);
    req.on('end', ()=>{ try{ resolve(s?JSON.parse(s):{}); }catch(_){ reject(new Error('BAD_JSON')); } });
    req.on('error', reject);
  });
}

function generateHashKey({ total, installment, currency_code, merchant_key, invoice_id, app_secret }){
  const data = `${total}|${installment}|${currency_code}|${merchant_key}|${invoice_id}`;
  const ivStr   = crypto.createHash('sha1').update(String(Math.random())).digest('hex').slice(0,16);
  const saltStr = crypto.createHash('sha1').update(String(Math.random())).digest('hex').slice(0,4);
  const pwdSha1 = crypto.createHash('sha1').update(String(app_secret)).digest('hex');
  const keyHex  = crypto.createHash('sha256').update(pwdSha1 + saltStr).digest('hex');
  const keyBuf  = Buffer.from(keyHex, 'hex');
  const ivBuf   = Buffer.from(ivStr, 'utf8');

  const cipher = crypto.createCipheriv('aes-256-cbc', keyBuf, ivBuf);
  let enc = cipher.update(data, 'utf8', 'base64');
  enc += cipher.final('base64');
  return `${ivStr}:${saltStr}:${enc}`.replace(/\//g,'__');
}

module.exports = async (req, res) => {
  setCORS(res);

  // Preflight
  if (req.method === 'OPTIONS') {
    res.statusCode = 204; return res.end();
  }

  if(req.method !== 'POST'){
    res.setHeader('Allow','POST,OPTIONS');
    return res.status(405).json({ok:false,error:'METHOD_NOT_ALLOWED'});
  }

  const MERCHANT_KEY = process.env.SIPAY_MERCHANT_KEY; // $2y$ ile başlayan Üyeişyeri Anahtarı
  const APP_SECRET   = process.env.SIPAY_APP_SECRET;   // Uygulama Parolası
  if(!MERCHANT_KEY || !APP_SECRET){
    return res.status(500).json({ ok:false, error:'CONFIG', detail:'Missing SIPAY_MERCHANT_KEY or SIPAY_APP_SECRET' });
  }

  let body;
  try{ body = await readJson(req); }
  catch(e){ return res.status(400).json({ ok:false, error:'BAD_JSON', detail:e.message }); }

  const {
    total, currency_code='TRY', installments_number=1, env
  } = body || {};

  const t = Number(total);
  if(!isFinite(t) || t<=0) return res.status(400).json({ ok:false, error:'BAD_TOTAL' });

  const invoice_id  = `INV-${Date.now()}`;
  const hash_key    = generateHashKey({
    total: t, installment: installments_number, currency_code,
    merchant_key: MERCHANT_KEY, invoice_id, app_secret: APP_SECRET
  });

  const base = (env==='test')
    ? 'https://provisioning.sipay.com.tr/ccpayment'
    : 'https://app.sipay.com.tr/ccpayment';

  return res.status(200).json({
    ok: true,
    merchant_key: MERCHANT_KEY,
    invoice_id,
    hash_key,
    currency_code,
    installments_number,
    base
  });
};
