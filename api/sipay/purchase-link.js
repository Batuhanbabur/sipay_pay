// pages/api/sipay/purchase-link.js

export const config = { api: { bodyParser: true } }; // JSON body otomatik parse

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  // ENV
  const LIVE = process.env.SIPAY_LIVE === '1';
  const SIPAY_BASE = LIVE
    ? 'https://app.sipay.com.tr/ccpayment'
    : 'https://provisioning.sipay.com.tr/ccpayment';

  const MERCHANT_KEY = process.env.SIPAY_MERCHANT_KEY;
  const RETURN_URL   = process.env.RETURN_URL;           // örn: https://<proje>.vercel.app/api/sipay/return
  const CANCEL_URL   = process.env.CANCEL_URL || RETURN_URL;

  if (!MERCHANT_KEY || !RETURN_URL) {
    return res.status(500).json({
      ok: false,
      error: 'CONFIG',
      detail: 'Missing MERCHANT_KEY or RETURN_URL env',
    });
  }

  // Body'yi güvenli şekilde al
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); }
    catch (e) {
      return res.status(400).json({ ok: false, error: 'BAD_JSON', detail: 'Invalid JSON string' });
    }
  }
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ ok: false, error: 'BAD_JSON', detail: 'Empty or invalid JSON body' });
  }

  const {
    invoice_id,
    currency_code = 'TRY',
    installments_number = 1,
    name,
    surname,
    total,                 // opsiyonel; yoksa items toplamı
    bill_email,
    bill_phone,
    bill_address1,
    bill_city,
    bill_state,
    bill_postcode,
    bill_country,
    items = [],
  } = body;

  if (!invoice_id)  return res.status(400).json({ ok:false, error:'VALIDATION', detail:'invoice_id required' });
  if (!name || !surname) return res.status(400).json({ ok:false, error:'VALIDATION', detail:'name & surname required' });
  if (!bill_email || !bill_phone) return res.status(400).json({ ok:false, error:'VALIDATION', detail:'bill_email & bill_phone required' });

  const sumFromItems = Array.isArray(items)
    ? items.reduce((s, it) => s + (Number(it.price)||0) * (Number(it.quantity)||0), 0)
    : 0;
  const grandTotal = Number(total != null ? total : sumFromItems);

  const payload = {
    merchant_key: MERCHANT_KEY,
    invoice: JSON.stringify(items || []), // Sipay string-JSON istiyor
    currency_code,
    max_installment: Number(installments_number) || 1,
    name,
    surname,
    bill_address1: bill_address1 || '',
    bill_address2: '',
    bill_city: bill_city || '',
    bill_postcode: bill_postcode || '',
    bill_state: bill_state || '',
    bill_country: bill_country || '',
    bill_email,
    bill_phone,
    cancel_url: CANCEL_URL,
    return_url: RETURN_URL,
    total: grandTotal,
  };

  try {
    const r = await fetch(`${SIPAY_BASE}/purchase/link`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'do-lab-sipay/1.0 (+vercel)',
      },
      body: JSON.stringify(payload),
    });

    const ctype = r.headers.get('content-type') || '';
    if (!ctype.includes('application/json')) {
      const text = await r.text();
      const snippet = text.slice(0, 300).replace(/\s+/g, ' ');
      console.error('[SIPAY NON-JSON]', r.status, r.statusText, ctype, snippet);
      return res.status(502).json({
        ok: false,
        error: 'SIPAY_NON_JSON',
        status: r.status,
        contentType: ctype,
        detail: `Non-JSON response. Starts with: ${snippet}`,
      });
    }

    const data = await r.json();
    if (!r.ok) {
      console.error('[SIPAY ERROR]', r.status, data);
      return res.status(r.status).json({ ok:false, error:'SIPAY_ERROR', status:r.status, data });
    }

    // Beklenen alanlar: { status:true, link:"...", order_id:"..." }
    if (data && (data.link || data.order_id || data.status)) {
      return res.status(200).json({ ok:true, ...data });
    }

    return res.status(200).json({ ok:true, raw:data, note:'Unexpected JSON shape' });

  } catch (err) {
    console.error('[SERVER ERROR]', err);
    return res.status(500).json({ ok:false, error:'SERVER', detail:String(err?.message || err) });
  }
}
