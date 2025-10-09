// api/sipay/purchase-link.js
// Vercel Serverless (Node 18). Sipay /purchase/link — invoice_id + hash_key destekli.

const https = require('https');
const { URL } = require('url');
const crypto = require('crypto');

/* ---------- read JSON body ---------- */
function readBody(req){
  return new Promise((resolve, reject)=>{
    let data = '';
    req.on('data', c => (data += c));
    req.on('end', ()=>{
      try { resolve(data ? JSON.parse(data) : {}); }
      catch(e){ reject(new Error('BAD_JSON')); }
    });
    req.on('error', reject);
  });
}

/* ---------- helpers ---------- */
const norm = (v, d='') => (v??d).toString().trim();
const onlyDigits = v => (v??'').toString().replace(/[^\d]/g,'');

function makeInvoiceArray(itemsInput=[]){
  const arr = Array.isArray(itemsInput) ? itemsInput : [];
  return arr.map((it,i)=>({
    name: norm(it.name || `Item ${i+1}`),
    price: Number(it.price || 0),
    quantity: parseInt(it.quantity || 1, 10),
    description: norm(it.description || '')
  }));
}
function totalFromInvoice(items=[]){
  return (items||[]).reduce((s,it)=> s + Number(it.price||0)*parseInt(it.quantity||1,10), 0);
}
function clientIp(req){
  const xf = (req.headers['x-forwarded-for']||'').toString().split(',')[0].trim();
  if (xf) return xf;
  const ra = (req.socket && req.socket.remoteAddress) || '';
  return ra.replace('::ffff:','') || '127.0.0.1';
}

function postJSON(url, bodyObj, headers={}){
  return new Promise((resolve, reject)=>{
    const body = JSON.stringify(bodyObj||{});
    const u = new URL(url);
    const opts = {
      method: 'POST',
      hostname: u.hostname,
      path: u.pathname + (u.search||''),
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...headers
      }
    };
    const req = https.request(opts, res=>{
      let out=''; res.on('data',d=>(out+=d));
      res.on('end', ()=>{
        let json=null; try{ json = JSON.parse(out); }catch{}
        resolve({ status: res.statusCode, json, raw: out });
      });
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

/* ---------- Sipay token (opsiyonel) ---------- */
async function tryGetToken(base, appId, appSecret){
  if(!appId || !appSecret) return null;
  try{
    const { status, json, raw } = await postJSON(`${base}/api/token`, { app_id: appId, app_secret: appSecret });
    if(status !== 200 || !json) return null;
    const s = JSON.stringify(json);
    const m = s.match(/"token"\s*:\s*"([^"]+)"/i);
    return m ? m[1] : null;
  }catch{ return null; }
}

/* ---------- Sipay hash (PHP örneğiyle birebir) ---------- */
/*
  generateHashKey(total, installment, currency_code, merchant_key, invoice_id, app_secret)
  data = `${total}|${installment}|${currency_code}|${merchant_key}|${invoice_id}`
  iv  = substr(sha1(mt_rand()), 0, 16)  // 16 char (ASCII), PHP OpenSSL bu stringi IV olarak kabul ediyor
  pwd = sha1(app_secret)                // hex (40)
  salt = substr(sha1(mt_rand()), 0, 4)  // 4 char
  key = sha256(pwd + salt)              // hex (64) -> 32 bytes
  enc = openssl_encrypt(data, 'aes-256-cbc', key, 0, iv) // base64
  bundle = `${iv}:${salt}:${enc}` , '/' -> '__'
*/
function generateHashKey({ total, installment, currency_code, merchant_key, invoice_id, app_secret }){
  const data = `${total}|${installment}|${currency_code}|${merchant_key}|${invoice_id}`;

  const ivStr   = crypto.createHash('sha1').update(String(Math.random())).digest('hex').slice(0,16);
  const saltStr = crypto.createHash('sha1').update(String(Math.random())).digest('hex').slice(0,4);

  const pwdSha1 = crypto.createHash('sha1').update(String(app_secret)).digest('hex');          // 40 hex
  const keyHex  = crypto.createHash('sha256').update(pwdSha1 + saltStr).digest('hex');         // 64 hex
  const keyBuf  = Buffer.from(keyHex, 'hex');                                                  // 32 bytes (AES-256)
  const ivBuf   = Buffer.from(ivStr, 'utf8');                                                  // PHP gibi raw ascii

  const cipher = crypto.createCipheriv('aes-256-cbc', keyBuf, ivBuf);
  let enc = cipher.update(data, 'utf8', 'base64');
  enc += cipher.final('base64');

  const bundle = `${ivStr}:${saltStr}:${enc}`.replace(/\//g,'__');
  return bundle;
}

/* ---------- handler ---------- */
module.exports = async (req, res) => {
  if(req.method !== 'POST'){
    res.setHeader('Allow','POST');
    return res.status(405).json({ ok:false, error:'METHOD_NOT_ALLOWED' });
  }

  const MERCHANT_KEY = process.env.SIPAY_MERCHANT_KEY;
  const APP_ID       = process.env.SIPAY_APP_ID;
  const APP_SECRET   = process.env.SIPAY_APP_SECRET;

  if(!MERCHANT_KEY) return res.status(500).json({ ok:false, error:'CONFIG', detail:'Missing SIPAY_MERCHANT_KEY' });
  if(!APP_SECRET)   return res.status(500).json({ ok:false, error:'CONFIG', detail:'Missing SIPAY_APP_SECRET' });

  let body;
  try { body = await readBody(req); }
  catch(e){ return res.status(400).json({ ok:false, error:'BAD_JSON', detail:e.message }); }

  const {
    env, // "test" -> provisioning
    name, surname,
    bill_email, bill_phone,
    bill_address1, bill_address2,
    bill_city, bill_state, bill_postcode, bill_country,
    currency_code = 'TRY',
    max_installment = 1,
    items = []
  } = body || {};

  if(!name || !surname)  return res.status(400).json({ ok:false, error:'REQ_NAME_SURNAME' });
  if(!bill_email)        return res.status(400).json({ ok:false, error:'REQ_EMAIL' });
  if(!bill_phone)        return res.status(400).json({ ok:false, error:'REQ_PHONE' });
  if(!Array.isArray(items) || items.length===0)
    return res.status(400).json({ ok:false, error:'REQ_ITEMS' });

  const base = (env==='test')
    ? 'https://provisioning.sipay.com.tr/ccpayment'
    : 'https://app.sipay.com.tr/ccpayment';

  const invoiceArr = makeInvoiceArray(items);
  const total = totalFromInvoice(invoiceArr);
  if(!isFinite(total) || total<=0) return res.status(400).json({ ok:false, error:'BAD_TOTAL' });

  // Sipay tarafında bazı canlı konfiglerde hash ve invoice_id bekleniyor:
  const invoice_id = `INV-${Date.now()}`;
  const installment = 1; // link için tek çekim; istersen body’den parametre alıp değiştirebilirsin
  const hash_key = generateHashKey({
    total, installment, currency_code, merchant_key: MERCHANT_KEY, invoice_id, app_secret: APP_SECRET
  });

  // Token (bazı ortamlarda gerekli; varsa ekleyelim)
  const token = await tryGetToken(base, process.env.SIPAY_APP_ID, process.env.SIPAY_APP_SECRET);
  const authHdr = token ? { Authorization: `Bearer ${token}` } : {};

  // Nihai payload (invoice string olmalı)
  const payload = {
    merchant_key: MERCHANT_KEY,
    invoice: JSON.stringify(invoiceArr),
    currency_code,
    name: norm(name),
    surname: norm(surname),
    bill_email: norm(bill_email),
    bill_phone: onlyDigits(bill_phone),
    bill_address1: norm(bill_address1||''),
    bill_address2: norm(bill_address2||''),
    bill_city: norm(bill_city||''),
    bill_state: norm(bill_state||''),
    bill_postcode: norm(bill_postcode||''),
    bill_country: norm(bill_country||'TR'),
    max_installment: parseInt(max_installment,10) || 1,
    ip: clientIp(req),
    // Eklediklerimiz:
    invoice_id,
    hash_key
  };

  try{
    const { status, json, raw } = await postJSON(`${base}/purchase/link`, payload, authHdr);

    if(status===200 && json && json.status===true && json.link){
      return res.status(200).json({ ok:true, link: json.link, order_id: json.order_id || null, invoice_id });
    }

    return res.status(502).json({
      ok:false, error:'SIPAY_ERROR', status,
      sipay: json || (typeof raw==='string' ? raw.slice(0,600) : null),
      sent: { // küçük bir maske ile debug (gizli alan yok)
        currency_code, max_installment: payload.max_installment, invoice_id, total
      }
    });
  }catch(err){
    return res.status(500).json({ ok:false, error:'SERVER', detail: err.message });
  }
};
