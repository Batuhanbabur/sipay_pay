// api/sipay/purchase-link.js
/**
 * Vercel Serverless (Node) – Sipay Purchase Link
 * - POST only
 * - Body: {
 *     name, surname,
 *     bill_email, bill_phone,
 *     bill_address1, bill_city, bill_state, bill_postcode, bill_country,
 *     currency_code: "TRY",
 *     max_installment, // optional (sayı)
 *     items: [{ name, price, quantity, description }]
 *     env: "live" | "test" // optional, test = provisioning
 *   }
 * ÇIKTI: { ok:true, link, order_id }
 *
 * Gerekli ENV:
 * - SIPAY_MERCHANT_KEY   -> Üyeişyeri Anahtarı (merchant_key)
 */
const https = require('https');

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => (data += c));
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch (e) { reject(new Error('BAD_JSON')); }
    });
    req.on('error', reject);
  });
}

function normStr(v, d='') { return (v ?? d).toString().trim(); }
function to2(n){ return Number(n||0).toFixed(2); }

function makeInvoiceArray(itemsInput=[]) {
  const arr = Array.isArray(itemsInput) ? itemsInput : [];
  return arr.map((it, idx) => ({
    name: normStr(it.name || `Item ${idx+1}`),
    price: Number(it.price || 0),           // sayı göndersek de Sipay kabul ediyor
    quantity: parseInt(it.quantity || 1, 10),
    description: normStr(it.description || '')
  }));
}

function fetchJSON(url, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const u = new URL(url);
    const opts = {
      method: 'POST',
      hostname: u.hostname,
      path: u.pathname + (u.search || ''),
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = https.request(opts, res => {
      let out = '';
      res.on('data', d => (out += d));
      res.on('end', () => {
        // Bazı durumlarda Sipay JSON yerine HTML döndürebiliyor; korumalı parse
        try {
          const json = JSON.parse(out);
          resolve({ status: res.statusCode, json, raw: out });
        } catch {
          resolve({ status: res.statusCode, json: null, raw: out });
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok:false, error:'METHOD_NOT_ALLOWED' });
  }

  let body;
  try { body = await readBody(req); }
  catch (e) { 
    return res.status(400).json({ ok:false, error:'BAD_JSON', detail:e.message });
  }

  const MERCHANT_KEY = process.env.SIPAY_MERCHANT_KEY;
  if (!MERCHANT_KEY) {
    return res.status(500).json({ ok:false, error:'CONFIG', detail:'Missing SIPAY_MERCHANT_KEY' });
  }

  // Girişleri toparla
  const {
    name, surname,
    bill_email, bill_phone,
    bill_address1, bill_address2, bill_city, bill_state, bill_postcode, bill_country,
    currency_code = 'TRY',
    max_installment,         // optional
    items = [],
    env                      // optional "test" => provisioning
  } = body;

  // Basit doğrulamalar
  if (!name || !surname)  return res.status(400).json({ ok:false, error:'REQ_NAME_SURNAME' });
  if (!bill_email)         return res.status(400).json({ ok:false, error:'REQ_EMAIL' });
  if (!bill_phone)         return res.status(400).json({ ok:false, error:'REQ_PHONE' });
  if (!Array.isArray(items) || items.length === 0)
    return res.status(400).json({ ok:false, error:'REQ_ITEMS' });

  // Sipay purchase/link tam olarak şunları bekliyor:
  // - merchant_key (ENV’den)
  // - invoice: JSON-string (array of items)
  // - currency_code
  // - name, surname
  // - (zorunlu işaretli) bill_email, bill_phone
  // - (opsiyonel) bill_address1, bill_city, bill_state, bill_postcode, bill_country
  // - (opsiyonel) max_installment
  // NOT: hash_key burada zorunlu değil; omuz vererek başlıyoruz.

  const invoiceArray = makeInvoiceArray(items);
  const payload = {
    merchant_key: MERCHANT_KEY,
    invoice: JSON.stringify(invoiceArray),
    currency_code,
    name: normStr(name),
    surname: normStr(surname),
    bill_email: normStr(bill_email),
    bill_phone: normStr(bill_phone)
  };

  if (bill_address1) payload.bill_address1 = normStr(bill_address1);
  if (bill_address2) payload.bill_address2 = normStr(bill_address2);
  if (bill_city)     payload.bill_city     = normStr(bill_city);
  if (bill_state)    payload.bill_state    = normStr(bill_state);
  if (bill_postcode) payload.bill_postcode = normStr(bill_postcode);
  if (bill_country)  payload.bill_country  = normStr(bill_country);
  if (max_installment) payload.max_installment = parseInt(max_installment,10) || 1;

  const base = (env === 'test')
    ? 'https://provisioning.sipay.com.tr/ccpayment'
    : 'https://app.sipay.com.tr/ccpayment';

  try {
    const { status, json, raw } = await fetchJSON(`${base}/purchase/link`, payload);

    // Beklenen başarı cevabı: { status:true, link:"...", order_id:"..." }
    if (status === 200 && json && json.status === true && json.link) {
      return res.status(200).json({ ok:true, link: json.link, order_id: json.order_id || null });
    }

    // Sipay tarafı HTML veya farklı gövde döndürürse:
    return res.status(502).json({
      ok:false,
      error:'SIPAY_ERROR',
      status,
      sipay: json || raw
    });
  } catch (err) {
    return res.status(500).json({ ok:false, error:'SERVER', detail: err.message });
  }
};
