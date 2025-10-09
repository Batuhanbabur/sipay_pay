// api/sipay/purchase-link.js
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    // Sağlık kontrolü vs. için GET'i 405 döndürmek normal
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  // ENV
  const LIVE = process.env.SIPAY_LIVE === '1';
  const SIPAY_BASE = LIVE
    ? 'https://app.sipay.com.tr/ccpayment'
    : 'https://provisioning.sipay.com.tr/ccpayment';

  const MERCHANT_KEY = process.env.SIPAY_MERCHANT_KEY;
  const RETURN_URL   = process.env.RETURN_URL;     // örn: https://<proje>.vercel.app/api/sipay/return
  const CANCEL_URL   = process.env.CANCEL_URL || RETURN_URL;
  if (!MERCHANT_KEY || !RETURN_URL) {
    return res.status(500).json({
      ok: false,
      error: 'CONFIG',
      detail: 'Missing MERCHANT_KEY or RETURN_URL env',
    });
  }

  // İstek gövdesi
  let body;
  try {
    body = await req.json();
  } catch (e) {
    return res.status(400).json({ ok: false, error: 'BAD_JSON', detail: String(e.message) });
  }

  // Zorunlu alanlar
  const {
    invoice_id,
    currency_code = 'TRY',
    installments_number = 1,
    name,
    surname,
    total,            // opsiyonel: göndermezseniz items toplamı kullanılır
    bill_email,
    bill_phone,
    bill_address1,
    bill_city,
    bill_state,
    bill_postcode,
    bill_country,
    items = [],
    // isterseniz metadata vs. ekleyebilirsiniz
  } = body || {};

  if (!invoice_id) {
    return res.status(400).json({ ok: false, error: 'VALIDATION', detail: 'invoice_id required' });
  }
  if (!name || !surname) {
    return res.status(400).json({ ok: false, error: 'VALIDATION', detail: 'name & surname required' });
  }
  if (!bill_email || !bill_phone) {
    return res.status(400).json({ ok: false, error: 'VALIDATION', detail: 'bill_email & bill_phone required' });
  }

  // Toplamı hesapla (gönderilmemişse)
  const sumFromItems = Array.isArray(items)
    ? items.reduce((s, it) => s + (Number(it.price) || 0) * (Number(it.quantity) || 0), 0)
    : 0;
  const grandTotal = Number(total != null ? total : sumFromItems);

  // Sipay purchase/link payload
  const payload = {
    merchant_key: MERCHANT_KEY,
    invoice: JSON.stringify(items || []), // Sipay bu alanı string-JSON istiyor
    currency_code,
    max_installment: Number(installments_number) || 1,

    name,
    surname,

    // Sipay docs: hash_key opsiyonel görünüyor; istersek ekleriz.
    // hash_key: generateHashKey(grandTotal, installments_number, currency_code, MERCHANT_KEY, invoice_id, APP_SECRET),

    bill_address1: bill_address1 || '',
    bill_address2: '',
    bill_city: bill_city || '',
    bill_postcode: bill_postcode || '',
    bill_state: bill_state || '',
    bill_country: bill_country || '',
    bill_email,
    bill_phone,

    // 3D akışından dönecek URL'ler
    cancel_url: CANCEL_URL,
    return_url: RETURN_URL,

    // Açıkça istemeyenler için göndermiyoruz:
    // transaction_type, sale_web_hook_key, order_type, vb.

    // Güvenli toplam bilgisi (endpoint gerektirmiyor ama anlamlı)
    // Bazı kurulumlarda total zorunlu tutulabiliyor:
    total: grandTotal,
  };

  try {
    const url = `${SIPAY_BASE}/purchase/link`;
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        // Bazı WAF/Proxy’ler user-agent olmayan istekleri sevmez:
        'User-Agent': 'do-lab-sipay/1.0 (+vercel)',
      },
      body: JSON.stringify(payload),
    });

    const ctype = r.headers.get('content-type') || '';
    // JSON bekliyoruz; değilse text olarak oku ve hatayı anlamlandır
    if (!ctype.includes('application/json')) {
      const text = await r.text();
      const snippet = text.slice(0, 300).replace(/\s+/g, ' ');
      // Logu görmek için Vercel Logs’a bakabilirsin
      console.error('[SIPAY NON-JSON]', r.status, r.statusText, ctype, snippet);
      return res.status(502).json({
        ok: false,
        error: 'SIPAY_NON_JSON',
        status: r.status,
        contentType: ctype,
        detail: `Sipay returned non-JSON (${r.status} ${r.statusText}). Body starts with: ${snippet}`,
      });
    }

    const data = await r.json();

    if (!r.ok) {
      console.error('[SIPAY ERROR]', r.status, data);
      return res.status(r.status).json({
        ok: false,
        error: 'SIPAY_ERROR',
        status: r.status,
        data,
      });
    }

    // Başarılı cevap örneği:
    // { status: true, status_code: "100", link: "https://...", order_id: "VP..." }
    if (data && (data.link || data.order_id || data.status)) {
      return res.status(200).json({
        ok: true,
        ...data,
      });
    }

    // Beklenmeyen ama JSON olan cevap
    return res.status(200).json({
      ok: true,
      raw: data,
      note: 'Unexpected JSON shape from Sipay',
    });

  } catch (err) {
    console.error('[SERVER ERROR]', err);
    return res.status(500).json({
      ok: false,
      error: 'SERVER',
      detail: String(err && err.message ? err.message : err),
    });
  }
}
