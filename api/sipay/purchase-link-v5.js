// api/sipay/purchase-link-v5.js
// Vercel Node.js (CommonJS) — Sipay purchase/link + optional Bearer Token
const crypto = require('crypto');

function sha1Hex(s){ return crypto.createHash('sha1').update(s).digest('hex'); }
function sha256Hex(s){ return crypto.createHash('sha256').update(s).digest('hex'); }
function toMoney2(n){ const v = Number(n)||0; return v.toFixed(2); }
function digitsOnly(s=''){ return String(s).replace(/\D+/g,''); }

// Sipay dokümanındaki paySmart3D hash algoritmasına göre üretim
function generateHashKey({ total, installments, currency_code, merchant_key, invoice_id, app_secret }){
  const data = `${total}|${installments}|${currency_code}|${merchant_key}|${invoice_id}`;
  const iv  = sha1Hex(crypto.randomBytes(16)).slice(0,16);
  const pwd = sha1Hex(app_secret);
  const salt = sha1Hex(crypto.randomBytes(6)).slice(0,4);
  const keyHex = sha256Hex(pwd + salt);
  const key = Buffer.from(keyHex, 'hex');
  const cipher = crypto.createCipheriv('aes-256-cbc', key, Buffer.from(iv));
  let encrypted = cipher.update(data, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  return `${iv}:${salt}:${encrypted}`.replace(/\//g,'__');
}

async function readJsonBody(req){
  if (req.body && typeof req.body === 'object') return req.body;
  const raw = await new Promise((resolve, reject)=>{
    let data=''; req.on('data',ch=>data+=ch);
    req.on('end', ()=>resolve(data));
    req.on('error', reject);
  });
  return raw ? JSON.parse(raw) : {};
}

async function getToken(BASE, app_id, app_secret){
  if(!app_id || !app_secret) return null;
  try{
    const r = await fetch(`${BASE}/api/token`, {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'Accept':'application/json' },
      body: JSON.stringify({ app_id, app_secret })
    });
    const ctype = r.headers.get('content-type')||'';
    if(!ctype.includes('application/json')) return null;
    const js = await r.json();
    // Bazı tenant'larda token 'data.token' ya da 'token' alanında gelir.
    const token = js?.data?.token || js?.token || null;
    return token;
  }catch(_){ return null; }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow','POST');
    return res.status(405).json({ ok:false, error:'METHOD_NOT_ALLOWED' });
  }

  // ENV
  const LIVE = process.env.SIPAY_LIVE === '1';
  const BASE = LIVE ? 'https://app.sipay.com.tr/ccpayment'
                    : 'https://provisioning.sipay.com.tr/ccpayment';

  const MERCHANT_KEY = process.env.SIPAY_MERCHANT_KEY;   // Üyeişyeri Anahtarı
  const APP_ID       = process.env.SIPAY_APP_ID;         // Uygulama Anahtarı
  const APP_SECRET   = process.env.SIPAY_APP_SECRET;     // Uygulama Parolası
  const RETURN_URL   = process.env.RETURN_URL;
  const CANCEL_URL   = process.env.CANCEL_URL || RETURN_URL;

  if (!MERCHANT_KEY || !APP_SECRET || !RETURN_URL) {
    return res.status(500).json({ ok:false, error:'CONFIG',
      detail:'Missing env: SIPAY_MERCHANT_KEY or SIPAY_APP_SECRET or RETURN_URL' });
  }

  // Body
  let body;
  try { body = await readJsonBody(req); }
  catch(e){ return res.status(400).json({ ok:false, error:'BAD_JSON', detail:String(e.message||e) }); }

  // Payload
  const {
    invoice_id,
    currency_code = 'TRY',
    installments_number = 1,
    name, surname,
    bill_email, bill_phone,
    bill_address1, bill_city, bill_state, bill_postcode, bill_country,
    total,                   // opsiyonel
    items = [],
    debug = {}
  } = body;

  if (!name || !surname)     return res.status(400).json({ ok:false, error:'VALIDATION', detail:'name & surname required' });
  if (!bill_email || !bill_phone) return res.status(400).json({ ok:false, error:'VALIDATION', detail:'bill_email & bill_phone required' });

  const normItems = Array.isArray(items) ? items.map((it,idx)=>({
    name: String(it?.name || `Item ${idx+1}`),
    price: toMoney2(it?.price),
    quantity: Math.max(1, parseInt(it?.quantity,10) || 1),
    description: String(it?.description || '')
  })) : [];

  const sumFromItems = normItems.reduce((s,it)=> s + Number(it.price)*it.quantity, 0);
  const grand = Number(total != null ? total : sumFromItems);
  const grand2 = toMoney2(grand);
  const invId = String(invoice_id || `INV-${Date.now()}`);

  const basePayload = {
    merchant_key: MERCHANT_KEY,
    invoice: JSON.stringify(normItems),
    currency_code,
    max_installment: Number(installments_number)||1,
    name, surname,
    bill_address1: bill_address1 || '',
    bill_address2: '',
    bill_city:     bill_city || '',
    bill_postcode: bill_postcode || '',
    bill_state:    bill_state || '',
    bill_country:  bill_country || '',
    bill_email,
    bill_phone: digitsOnly(bill_phone),
    cancel_url: CANCEL_URL,
    return_url: RETURN_URL
  };

  // Opsiyonel token al
  const token = await getToken(BASE, APP_ID, APP_SECRET);

  const tried = [];
  async function tryCall(label, payload, useAuth){
    const headers = { 'Content-Type':'application/json', 'Accept':'application/json' };
    if (useAuth && token) headers['Authorization'] = `Bearer ${token}`;
    const r = await fetch(`${BASE}/purchase/link`, { method:'POST', headers, body: JSON.stringify(payload) });
    const ctype = r.headers.get('content-type') || '';
    if (!ctype.includes('application/json')) {
      const text = await r.text();
      tried.push({ step: label, status: r.status, nonJson: text.slice(0,200) });
      if (r.ok) return { ok:true, data:{ link: null, preview:text.slice(0,300) } };
      return { ok:false };
    }
    const data = await r.json();
    tried.push({ step: label, status: r.status, data });
    if (r.ok && (data?.link || data?.status === true)) return { ok:true, data };
    return { ok:false };
  }

  // Hash
  const hash = generateHashKey({
    total: grand2,
    installments: Number(installments_number)||1,
    currency_code, merchant_key: MERCHANT_KEY,
    invoice_id: invId, app_secret: APP_SECRET
  });

  // Deneme matrisimiz
  const attempts = [
    { label:'A_AUTH_HASH_noTOTAL',  payload:{ ...basePayload, hash_key: hash }, useAuth:true },
    { label:'B_AUTH_HASH_withTOTAL',payload:{ ...basePayload, total: Number(grand2), hash_key: hash }, useAuth:true },
    { label:'C_AUTH_noHASH_noTOTAL',payload:{ ...basePayload }, useAuth:true },
    { label:'D_noAUTH_HASH_noTOTAL',payload:{ ...basePayload, hash_key: hash }, useAuth:false },
    { label:'E_noAUTH_HASH_withTOTAL',payload:{ ...basePayload, total: Number(grand2), hash_key: hash }, useAuth:false },
    { label:'F_noAUTH_noHASH_noTOTAL',payload:{ ...basePayload }, useAuth:false },
  ];

  for (const a of attempts) {
    try{
      const resp = await tryCall(a.label, a.payload, a.useAuth);
      if (resp.ok) {
        const data = resp.data;
        return res.status(200).json({
          ok:true,
          link: data.link,
          order_id: data.order_id,
          status_code: data.status_code || data.code,
          step: a.label,
          invoice_id: invId
        });
      }
    }catch(e){
      tried.push({ step:a.label, error:String(e.message||e) });
    }
  }

  return res.status(502).json({
    ok:false,
    error:'SIPAY_ERROR',
    tried,
    info:{ base: BASE, invoice_id: invId, totals_from_items: grand2, live: LIVE, has_token: !!token }
  });
};
