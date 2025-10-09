// File: /api/sipay/return.js
export default async function handler(req, res) {
  // CORS (zarar vermez)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  // Readymag’te göstereceğin sayfalar
  const THANKYOU_URL = 'https://do-lab.co/tesekkur_ederiz/';
  const FAIL_URL     = 'https://do-lab.co/basarisiz/';

  // Vercel Node runtime’da req.body genelde parse’lı gelir
  const b = (req.body && typeof req.body === 'object') ? req.body : {};

  // Sipay’in gönderdiği ana alanları toparla
  const posted = {
    invoice_id:          b.invoice_id ?? '',
    total:               b.total ?? '',
    currency_code:       b.currency_code ?? '',
    installments_number: b.installments_number ?? '',
    status_code:         b.status_code ?? b.error_code ?? '',
    status_description:  b.status_description ?? b.error ?? '',
    amount:              b.amount ?? '',            // bazı yanıtlar 'amount' kullanıyor
    sipay_status:        b.sipay_status ?? '',
    payment_status:      b.payment_status ?? '',
    transaction_type:    b.transaction_type ?? '',
  };

  // Başarılı mı?
  const isOK = String(posted.sipay_status) === '1' || String(posted.payment_status) === '1';

  // Teşhis için ek bilgiler
  const qs = new URLSearchParams();
  for (const [k,v] of Object.entries(posted)) qs.set(k, String(v));
  qs.set('posted_total_type', typeof posted.total); // "string" mi?
  qs.set('dbg', '1');

  return res.redirect(302, `${isOK ? THANKYOU_URL : FAIL_URL}?${qs.toString()}`);
}
