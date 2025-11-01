// File: /api/sipay/return.js
// Amaç: Sipay POST dönüşünü al; sadece BAŞARILI ödemede imzalı (HMAC) payload'ı
// Google Apps Script Orders endpoint'ine gönder; sonra ThankYou/Fail'e yönlendir.

import crypto from "crypto";

// ---------- Ortam değişkenleri (Vercel Settings → Environment Variables) ----------
const APPS_SCRIPT_ORDERS_URL = process.env.APPS_SCRIPT_ORDERS_URL || ""; // GAS Web App yeni URL
const APPS_SCRIPT_SECRET     = process.env.APPS_SCRIPT_SECRET     || ""; // Script properties: SECRET
const APPS_SCRIPT_HMAC_KEY   = process.env.APPS_SCRIPT_HMAC_KEY   || ""; // Script properties: HMAC_KEY

const THANKYOU_URL = process.env.THANKYOU_URL || "https://do-lab.co/tesekkur_ederiz/";
const FAIL_URL     = process.env.FAIL_URL     || "https://do-lab.co/basarisiz/";

// ---------- Yardımcılar ----------
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

function hmacSig(dataStr, key){
  return crypto.createHmac("sha256", key).update(dataStr).digest("hex");
}

// ---------- Handler ----------
export default async function handler(req, res) {
  cors(res, "*");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST")   return res.status(405).json({ ok:false, error:"METHOD" });

  const body = await readBody(req);

  // Sipay → alanları normalize et
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
  const bill_city        = String(body.bill_city || body.city || "");
  const bill_country     = String(body.bill_country || body.country || "TR");

  // Başarı kuralları (Sipay entegrasyonlarında tipik kabul koşulları)
  const isSuccess = (sipay_status === 1) || (payment_status === 1) || (status_code_raw === "0");

  // ---------- SADECE BAŞARILI İSE Orders'a GÖNDER ----------
  if (isSuccess && invoice_id && customer_email && APPS_SCRIPT_ORDERS_URL && APPS_SCRIPT_SECRET && APPS_SCRIPT_HMAC_KEY) {
    try {
      const payload = {
        secret: APPS_SCRIPT_SECRET,                    // SECRET doğrulaması
        timestamp: new Date().toISOString(),
        invoice_id,
        amount,
        status_code: "PAID",                           // normalize
        status_description: status_desc || "paid",
        name: String(body.firstName || body.name || ""),
        surname: String(body.lastName  || body.surname || ""),
        email: customer_email,
        phone: customer_phone,
        city: bill_city,
        country: bill_country,
        items_json: ""                                 // gerekiyorsa doldurun
      };

      // HMAC imzası: invoice_id|amount|status_code|email
      const dataStr = [payload.invoice_id, payload.amount, payload.status_code, payload.email].join("|");
      payload.sig = hmacSig(dataStr, APPS_SCRIPT_HMAC_KEY);

      await fetch(APPS_SCRIPT_ORDERS_URL, {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify(payload)
      });
    } catch (_) {
      // Orders'a log başarısız olsa bile yönlendirmeyi bozma
    }
  }
  // Başarısız/iptal durumlarda ASLA Orders'a göndermiyoruz.

  // ---------- Redirect ----------
  const qs = toQS({
    order: invoice_id,
    amount,
    status_code: isSuccess ? "PAID" : status_code_raw,
    status_description: status_desc,
    sipay_status: String(sipay_status),
    payment_status: String(payment_status),
    transaction_type,
    card_brand
  });
  const base = isSuccess ? THANKYOU_URL : FAIL_URL;
  const sep = base.includes("?") ? "&" : "?";

  res.status(302).setHeader("Location", base + sep + qs).end();
}
