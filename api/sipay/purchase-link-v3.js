// api/sipay/purchase-link-v3.js
const crypto = require('crypto');

function sha1Hex(s){ return crypto.createHash('sha1').update(s).digest('hex'); }
function sha256Hex(s){ return crypto.createHash('sha256').update(s).digest('hex'); }

// Sipay hash_key (paySmart3D örneğine göre)
function generateHashKey({ total, installments, currency_code, merchant_key, invoice_id, app_secret }){
  const data = `${total}|${installments}|${currency_code}|${merchant_key}|${invoice_id}`;
  const iv = sha1Hex(crypto.randomBytes(16)).slice(0,16);     // 16 char
  const password = sha1Hex(app_secret);
  const salt = sha1Hex(crypto.randomBytes(16)).slice(0,4);    // 4 char
  const keyHex = sha256Hex(password + salt);                  // 64 hex → 32 bytes
  const key = Buffer.from(keyHex, 'hex');
  const cipher = crypto.createCipheriv('aes-256-cbc', key, Buffer.from(iv));
  let encrypted = cipher.update(data, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const bundle = `${iv}:${salt}:${encrypted}`.replace(/\//g, '__');
  return bundle;
}

function toMoney2(n){
  const v = Number(n) || 0;
  return v.toFixed(2); // "1299.00"
}
function digitsOnly(s=''){
  return String(s).replace(/\D+/g,'');
}

module.exports = async (req, res) => {
  console.log('[purchase-link-v3] start', new Date().toISOString());

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok:false, error:'METHOD_NOT_ALLOWED' });
  }

  // --- ENV & BASE ---
  const LIVE = process.env.SIPAY_LIVE === '1';
  const SIPAY_BASE = LIVE
    ? 'https://app.sipay.com.tr/ccpayment'
    : 'https://provisioning.sipay.com.tr/ccpayment';

  const MERCHANT_KEY = process.env.SIPAY_MERCHANT_KEY;
  const APP_SECRET   = process.env.SIPAY_APP_SECRET;  // hash için
  const RETURN_URL   = process.env.RETURN_URL;
  const CANCEL_URL   = process.env.CANCEL_URL || RETURN_URL;

  if (!MERCHANT_KEY || !RETURN_URL || !APP_SECRET) {
    return res.status(500).json({
      ok:false, error:'CONFIG',
      detail:'Missing env: SIPAY_MERCHANT_KEY or RETURN_URL or SIPAY_APP_SECRET'
    });
  }

  // --- BODY al (ham JSON’u yakala) ---
  let body = req.body;
  try {
    if (!body || typeof body !== 'object') {
      const raw = await new Promise((resolve, reject)=>{
        let data=''; req.on('data',ch=>data+=ch);
        req.on('end', ()=>resolve(data));
        req.on('error', reject);
      });
      body = raw ? JSON.parse(raw) : {};
    }
  } catch(e){
    console.error('[purchase-link-v3] BAD_JSON', e?.message);
    return res.status(400).json({ ok:false, error:'BAD_JSON', detail:'Invalid JSON body' });
  }

  // --- Zorunlu alanlar ---
  const {
    invoice_id,                    // yoksa biz üretiriz
    currency_code = 'TRY',
    installments_number = 1,
    name, surname,
    bill_email, bill_phone,
    bill_address1, bill_city, bill_state, bill_postcode, bill_country,
    total,                         // opsiyonel (yoksa items toplamı)
    items = []
  } = body;

  if (!name || !surname) return res.status(400).json({ ok:false, error:'VALIDATION', detail:'name & surname required' });
  if (!bill_email || !bill_phone) return res.status(400).json({ ok:false, error:'VALIDATION', detail:'bill_email & bill_phone required' });

  // --- Items normalize ---
  const normItems = Array.isArray(items) ? items.map((it,idx)=>({
    name: String(it?.name || `Item ${idx+1}`),
    price: toMoney2(it?.price),
    quantity: Math.max(1, parseInt(it?.quantity,10) || 1),
    description: String(it?.description || '')
  })) : [];

  const sumFromItems = normItems.reduce((s,it)=> s + Number(it.price)*it.quantity, 0);
  const grandTotal = Number(total != null ? total : sumFromItems);
  const gTotal2 = toMoney2(grandTotal);

  // Sipay bazı kurulumlarda total bekliyor ve items toplamıyla eşit olmalı
  // (Eşitleyip gönderiyoruz)
  const payload = {
    merchant_key: MERCHANT_KEY,
    invoice: JSON.stringify(normItems),
    currency_code,
    max_installment: Number(installments_number)||1,
    name, surname,
    bill_address1: bill_address1 || '',
    bill_address2: '',
    bill_city: bill_city || '',
    bill_postcode: bill_postcode || '',
    bill_state: bill_state || '',
    bill_country: bill_country || '',
    bill_email,
    bill_phone: digitsOnly(bill_phone),
    cancel_url: CANCEL_URL,
    return_url: RETURN_URL,
    total: Number(gTotal2)  // number olarak da gönderiyoruz
  };

  // Hash: paySmart3D ile aynı algoritma (bazı tenantlarda zorunlu)
  const invId = String(invoice_id || `INV-${Date.now()}`);
  const hash_key = generateHashKey({
    total: gTotal2,
    installments: Number(installments_number)||1,
    currency_code,
    merchant_key: MERCHANT_KEY,
    invoice_id: invId,
    app_secret: APP_SECRET
  });
  payload.hash_key = hash_key;

  try {
    console.log('[purchase-link-v3] POST', SIPAY_BASE + '/purchase/link');
    const r = await fetch(`${SIPAY_BASE}/purchase/link`, {
      method: 'POST',
      headers: {
        'Content-Type':'application/json',
        'Accept':'application/json',
        'User-Agent':'do-lab-sipay/1.1 (+vercel)'
      },
      body: JSON.stringify(payload)
    });

    const ctype = r.headers.get('content-type') || '';
    if (!ctype.includes('application/json')) {
      const text = await r.text();
      const snip = text.slice(0,300).replace(/\s+/g,' ');
      console.error('[SIPAY NON-JSON]', r.status, ctype, snip);
      return res.status(502).json({ ok:false, error:'SIPAY_NON_JSON', status:r.status, contentType:ctype, detail: snip });
    }
    const data = await r.json();

    if (!r.ok) {
      console.error('[SIPAY ERROR]', r.status, data);
      return res.status(r.status).json({ ok:false, error:'SIPAY_ERROR', status:r.status, data });
    }

    console.log('[purchase-link-v3] OK', data?.order_id || data?.link);
    return res.status(200).json({ ok:true, ...data, invoice_id: invId });

  } catch (err){
    console.error('[SERVER ERROR]', err);
    return res.status(500).json({ ok:false, error:'SERVER', detail:String(err?.message || err) });
  }
};
