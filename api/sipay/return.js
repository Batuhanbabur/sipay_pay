// File: /api/sipay/return.js
// Amaç: Sipay POST dönüşünü al, Google Sheets'e logla, sonra ThankYou / Fail sayfasına yönlendir.

const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxM58aX4b3iHgmF7SA0pA064mot2lRDx6ehvq2A3hqX5vBad2aPOXc1GG3goF4MIE3jZQ/exec";

function cors(res, origin = "*") {
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function toQS(obj) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(obj || {})) {
    if (v !== undefined && v !== null) sp.set(k, String(v));
  }
  return sp.toString();
}

// Body'yi güvenle oku (JSON veya form-urlencoded)
async function readBody(req) {
  // Vercel bazen body'yi obje olarak veriyor
  if (req.body && typeof req.body === "object") return req.body;

  const ctype = String(req.headers["content-type"] || "").toLowerCase();
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8") || "";

  if (ctype.includes("application/json")) {
    try { return JSON.parse(raw || "{}"); } catch { return {}; }
  }
  if (ctype.includes("application/x-www-form-urlencoded")) {
    const p = new URLSearchParams(raw);
    const out = {};
    for (const [k, v] of p) out[k] = v;
    return out;
  }
  // Diğerleri
  try { return JSON.parse(raw || "{}"); } catch { return {}; }
}

// Kısa timeout'lu fetch (log bekletmesin)
async function postJSON(url, payload, timeoutMs = 1500) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    await fetch(url, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify(payload),
      signal: ctrl.signal
    });
  } catch (_) {
    // Log başarısız olsa bile akışı bozma
  } finally {
    clearTimeout(t);
  }
}

export default async function handler(req, res) {
  cors(res, "*");

  // Sipay bazı ortamlarda ön kontrol yapabilir
  if (req.method === "OPTIONS") return res.status(204).end();

  // Sağlık testi için GET'i basitçe göster; asıl akış POST
  if (req.method !== "POST") {
    return res.status(405).json({ ok:false, error:"METHOD" });
  }

  // Ortam URL'leri (yoksa defaultları kullan)
  const THANKYOU_URL = process.env.THANKYOU_URL || "https://do-lab.co/tesekkur_ederiz/";
  const FAIL_URL     = process.env.FAIL_URL     || "https://do-lab.co/basarisiz/";

  let body = await readBody(req);

  // Sipay payload örnek alanlar
  const invoice_id       = String(body.invoice_id || body.merchant_oid || "");
  const amount           = String(body.amount     || body.total        || "");
  const status_code      = String(
    body.status_code ??
    body.error_code ??
    body.response_code ??
    ""
  );
  const status_desc      = String(
    body.status_description ??
    body.error ??
    body.response_message ??
    ""
  );
  const sipay_status     = Number(body.sipay_status ?? 0);
  const payment_status   = Number(body.payment_status ?? 0);
  const transaction_type = String(body.transaction_type || "");
  const card_brand       = String(body.card_brand || body.card_type || "");
  const customer_email   = String(body.email || body.bill_email || "");
  const customer_phone   = String(body.phone || body.bill_phone || "");

  // Başarı kabul kriteri
  const isSuccess = (sipay_status === 1 || payment_status === 1 || status_code === "0");

  // Google Sheets'e LOG — SUCCESS ya da FAIL
  const logPayload = {
    stage: isSuccess ? "SUCCESS" : "FAIL",
    ts: new Date().toISOString(),
    // Sipay'ten gelen ham alanlar
    invoice_id,
    amount,
    status_code,
    status_description: status_desc,
    sipay_status,
    payment_status,
    transaction_type,
    card_brand,
    customer_email,
    customer_phone,
    // Ham body'yi görmek istersen:
    raw: body
  };
  // Arkada, kısa timeout ile gönder (await etsek de kısa timeout var)
  await postJSON(APPS_SCRIPT_URL, logPayload, 1500);

  // Teşekkür ya da Başarısız sayfasına yönlendirme
  const qs = toQS({
    order: invoice_id,
    amount: amount,
    status_code,
    status_description: status_desc,
    sipay_status: String(sipay_status),
    payment_status: String(payment_status),
    transaction_type
  });

  const base = isSuccess ? THANKYOU_URL : FAIL_URL;
  const sep = base.includes("?") ? "&" : "?";
  const to = base + sep + qs;

  // 302 Redirect
  res.status(302).setHeader("Location", to).end();
}
