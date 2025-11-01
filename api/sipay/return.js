// File: /api/sipay/return.js
// Amaç: Sipay POST dönüşünü al, BAŞARILI ise Orders'a gönder; sonra ThankYou / Fail'e yönlendir.

const APPS_SCRIPT_ORDERS_URL = process.env.APPS_SCRIPT_ORDERS_URL
  || "https://script.google.com/macros/s/___YENI_ORDERS_URL___/exec"; // ← yeni deploy URL'si
const APPS_SCRIPT_SECRET = process.env.APPS_SCRIPT_SECRET || "";       // ← Apps Script'te Script Properties'deki SECRET ile aynı olmalı

// (İsteğe bağlı) Başarısızları ayrı loglamak istersen aktif et
const APPS_SCRIPT_LOGS_URL = process.env.APPS_SCRIPT_LOGS_URL || "";   // boşsa göndermez

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

async function readBody(req) {
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
  try { return JSON.parse(raw || "{}"); } catch { return {}; }
}

async function postJSON(url, payload, timeoutMs = 1500) {
  if (!url) return;
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
    // log başarısız olsa bile akışı bozma
  } finally {
    clearTimeout(t);
  }
}

export default async function handler(req, res) {
  cors(res, "*");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    return res.status(405).json({ ok:false, error:"METHOD" });
  }

  const THANKYOU_URL = process.env.THANKYOU_URL || "https://do-lab.co/tesekkur_ederiz/";
  const FAIL_URL     = process.env.FAIL_URL     || "https://do-lab.co/basarisiz/";

  const body = await readBody(req);

  // Sipay alanları → normalize
  const invoice_id       = String(body.invoice_id || body.merchant_oid || "");
  const amount           = String(body.amount     || body.total        || "");
  const status_code_raw  = String(
    body.status_code ??
    body.response_code ??
    body.error_code ??
    ""
  );
  const status_desc      = String(
    body.status_description ??
    body.response_message ??
    body.error ??
    ""
  );
  const sipay_status     = Number(body.sipay_status ?? 0);
  const payment_status   = Number(body.payment_status ?? 0);
  const transaction_type = String(body.transaction_type || "");
  const card_brand       = String(body.card_brand || body.card_type || "");
  const customer_email   = String(body.email || body.bill_email || "");
  const customer_phone   = String(body.phone || body.bill_phone || "");

  // Başarı kuralları: Sipay dökümanına göre bunlar SUCCESS sinyali
  const isSuccess = (
    (sipay_status === 1) ||
    (payment_status === 1) ||
    (status_code_raw === "0")
  );

  // ---- Sheets'e GÖNDERME STRATEJİSİ ----
  // 1) SADECE BAŞARILI ÖDEMEDE Orders'a gönder
  if (isSuccess && invoice_id) {
    // Apps Script'in beklediği alanlar (senin güvenli sürüme uyumlu)
    const ordersPayload = {
      secret: APPS_SCRIPT_SECRET || undefined, // Apps Script SECRET doğrulaması için
      timestamp: new Date().toISOString(),
      invoice_id,
      amount,
      status_code: "PAID",                 // normalize: paid
      status_description: status_desc || "paid",
      name: String(body.firstName || body.name || ""),
      surname: String(body.lastName || body.surname || ""),
      email: customer_email,
      phone: customer_phone,
      city: String(body.bill_city || body.city || ""),
      country: String(body.bill_country || body.country || "TR"),
      items_json: "" // (Checkout’tan taşıyorsan buraya JSON koyarsın; yoksa boş)
    };
    await postJSON(APPS_SCRIPT_ORDERS_URL, ordersPayload, 2000);
  } else {
    // 2) Başarısız/eksik durum: Orders'a ASLA gönderme
    // (İsteğe bağlı) ayrı bir Logs sayfasına minimal log yolla
    if (APPS_SCRIPT_LOGS_URL) {
      const logPayload = {
        secret: APPS_SCRIPT_SECRET || undefined,
        stage: "FAIL",
        ts: new Date().toISOString(),
        invoice_id,
        amount,
        status_code: status_code_raw,
        status_description: status_desc,
        sipay_status,
        payment_status,
        transaction_type,
        card_brand
      };
      await postJSON(APPS_SCRIPT_LOGS_URL, logPayload, 1200);
    }
  }

  // ---- Redirect ----
  const qs = toQS({
    order: invoice_id,
    amount,
    status_code: isSuccess ? "PAID" : status_code_raw,
    status_description: status_desc,
    sipay_status: String(sipay_status),
    payment_status: String(payment_status),
    transaction_type
  });
  const base = isSuccess ? THANKYOU_URL : FAIL_URL;
  const sep = base.includes("?") ? "&" : "?";
  res.status(302).setHeader("Location", base + sep + qs).end();
}
