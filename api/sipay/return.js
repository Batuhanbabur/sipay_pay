// File: /api/sipay/return.js
export const config = { api: { bodyParser: false } };

import { StringDecoder } from 'string_decoder';
import querystring from 'querystring';

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL; // <- Vercel Env'e ekle
const APPS_SCRIPT_BEARER = process.env.APPS_SCRIPT_BEARER || ''; // opsiyonel

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const decoder = new StringDecoder('utf8');
    let data = '';
    req.on('data', chunk => { data += decoder.write(chunk); });
    req.on('end',  () => { data += decoder.end(); resolve(data); });
    req.on('error', reject);
  });
}

async function postToSheet(payload){
  if (!APPS_SCRIPT_URL) return;
  const headers = { 'Content-Type': 'application/json' };
  if (APPS_SCRIPT_BEARER) headers['Authorization'] = `Bearer ${APPS_SCRIPT_BEARER}`;
  try {
    await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });
  } catch (err) {
    console.error('Sheets error:', err);
  }
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).send('Method Not Allowed');
    }

    const raw = await readRawBody(req);
    const contentType = (req.headers['content-type'] || '').toLowerCase();

    let body = {};
    if (contentType.includes('application/json')) {
      try { body = JSON.parse(raw || '{}'); } catch { body = {}; }
    } else {
      body = querystring.parse(raw || '');
    }

    // Sipay ortak alanlar
    const invoice_id        = String(body.invoice_id || '');
    const amount            = String(body.amount || body.total || '');
    const status_code       = String(body.status_code || body.sipay_status || '');
    const status_description= String(body.status_description || body.error || '');
    const sipay_status      = String(body.sipay_status || '');
    const payment_status    = String(body.payment_status || '');
    const transaction_type  = String(body.transaction_type || '');

    // Müşteri / fatura (bizim formdan geliyordu)
    const name    = String(body.name || body.bill_name || '');
    const surname = String(body.surname || '');
    const email   = String(body.bill_email || '');
    const phone   = String(body.bill_phone || '');
    const city    = String(body.bill_city || '');
    const country = String(body.bill_country || '');
    const items_json = String(body.items || '');

    // Başarı kriteri: Sipay çoğunlukla status_code === '0'
    const success = (status_code === '0');

    // Sheets’e GÖNDER (başarılı/başarısız fark etmeksizin)
    await postToSheet({
      success,
      invoice_id,
      amount,
      status_code,
      status_description,
      sipay_status,
      payment_status,
      transaction_type,
      name, surname, email, phone, city, country,
      items_json,
      source: 'vercel-return'
    });

    // Kullanıcı yönlendirmesi
    if (success) {
      const thankUrl = `https://do-lab.co/tesekkur_ederiz/?invoice_id=${encodeURIComponent(invoice_id)}&amount=${encodeURIComponent(amount)}`;
      res.writeHead(302, { Location: thankUrl });
    } else {
      const failUrl = `https://do-lab.co/basarisiz/?invoice_id=${encodeURIComponent(invoice_id)}&amount=${encodeURIComponent(amount)}&status_code=${encodeURIComponent(status_code)}&status_description=${encodeURIComponent(status_description)}&sipay_status=${encodeURIComponent(sipay_status)}&payment_status=${encodeURIComponent(payment_status)}&transaction_type=${encodeURIComponent(transaction_type)}`;
      res.writeHead(302, { Location: failUrl });
    }
    return res.end();
  } catch (err) {
    console.error('return handler error:', err);
    return res.status(500).send('Server Error');
  }
}
