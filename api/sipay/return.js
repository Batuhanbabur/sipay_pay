// File: /api/sipay/return.js
export default async function handler(req, res) {
  // Sipay POST ile gelir; sağlık/deneme için GET de destekleyelim
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok:false, error:'METHOD' });

  // Vercel ENV'de bunları ayarlamıştık:
  const THANKYOU_URL = process.env.THANKYOU_URL || 'https://do-lab.co/tesekkur_ederiz/';
  const FAIL_URL     = process.env.FAIL_URL     || 'https://do-lab.co/basarisiz/';

  // Sipay gövdesini güvenle al
  let body = {};
  try {
    body = typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');
  } catch {
    body = {};
  }

  // Sipay tipik alanlar (gelmeyenler için fallback)
  const invoice_id       = String(body.invoice_id || body.merchant_oid || '');
  const amount           = String(body.amount     || body.total        || '');
  const status_code      = String(body.status_code ?? body.error_code ?? '');
  const status_desc      = String(body.status_description ?? body.error ?? '');
  const sipay_status     = Number(body.sipay_status ?? 0);
  const payment_status   = Number(body.payment_status ?? 0);
  const transaction_type = String(body.transaction_type || '');

  // Başarı kriteri: sipay_status veya payment_status 1 ise başarılı sayalım
  const isSuccess = (sipay_status === 1 || payment_status === 1 || status_code === '0');

  // Kullanışlı query string oluştur
  const params = new URLSearchParams({
    order: invoice_id,
    amount: amount,
    status_code,
    status_description: status_desc,
    sipay_status: String(sipay_status),
    payment_status: String(payment_status),
    transaction_type,
  }).toString();

  // Yönlendir
  const to = (isSuccess ? THANKYOU_URL : FAIL_URL) + (THANKYOU_URL.includes('?') ? '&' : '?') + params;

  // (İstersen localStorage fallback için bir mini HTML üzerinden redirect de yapabiliriz;
  // ama 302 yeterli.)
  res.status(302).setHeader('Location', to).end();
}
