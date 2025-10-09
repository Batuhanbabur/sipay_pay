// api/sipay/hash-3d.js
const crypto = require("crypto");

// ---- CORS yardımcıları ----
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
function withCors(res) {
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));
}

// ---- Hash üretimi (Sipay PHP örneğiyle birebir) ----
function generateHashKey(total, installment, currency_code, merchant_key, invoice_id, app_secret) {
  // total mutlaka "xx.yy" string olmalı
  const t = Number(total).toFixed(2);
  const data = `${t}|${installment}|${currency_code}|${merchant_key}|${invoice_id}`;

  const iv = crypto.createHash("sha1").update(String(Math.random())).digest("hex").substring(0, 16);
  const password = crypto.createHash("sha1").update(app_secret).digest("hex");
  const salt = crypto.createHash("sha1").update(String(Math.random())).digest("hex").substring(0, 4);
  const saltWithPassword = crypto.createHash("sha256").update(password + salt).digest(); // Buffer (32 byte)

  const cipher = crypto.createCipheriv("aes-256-cbc", saltWithPassword, iv);
  let encrypted = cipher.update(data, "utf8", "base64");
  encrypted += cipher.final("base64");

  const bundle = `${iv}:${salt}:${encrypted}`;
  return bundle.replace(/\//g, "__");
}

module.exports = async (req, res) => {
  withCors(res);

  // OPTIONS (preflight)
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  // GET (sağlık kontrolü)
  if (req.method === "GET") {
    return res.status(200).json({ ok: true, allow: ["OPTIONS", "GET", "POST"] });
  }

  // POST (hash üret)
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "METHOD" });
  }

  // Vercel Node fonksiyonlarında bazen body otomatik parse olur, bazen olmaz → güvenli parse:
  let body = req.body;
  if (!body || typeof body === "string") {
    try { body = JSON.parse(req.body || "{}"); } catch { body = {}; }
  }

  const {
    total,                 // zorunlu — sayısal ya da "xx.yy" olabilir
    currency_code = "TRY",
    installments_number = 1,
    env = "live",          // "live" | "test"
  } = body || {};

  // ---- ENV ve anahtarlar ----
  const LIVE_BASE = process.env.SIPAY_BASE_LIVE || "https://app.sipay.com.tr/ccpayment";
  const TEST_BASE = process.env.SIPAY_BASE_TEST || "https://provisioning.sipay.com.tr/ccpayment";
  const isLive = String(env).toLowerCase() === "live";

  const MERCHANT_KEY =
    isLive
      ? process.env.SIPAY_MERCHANT_KEY
      : (process.env.SIPAY_MERCHANT_KEY_TEST || process.env.SIPAY_MERCHANT_KEY);

  const APP_SECRET =
    isLive
      ? process.env.SIPAY_APP_SECRET
      : (process.env.SIPAY_APP_SECRET_TEST || process.env.SIPAY_APP_SECRET);

  if (!MERCHANT_KEY || !APP_SECRET) {
    return res
      .status(500)
      .json({ ok: false, error: "CONFIG", detail: "Missing SIPAY_MERCHANT_KEY or SIPAY_APP_SECRET" });
  }

  // total zorunlu
  if (total === undefined || total === null || isNaN(Number(total))) {
    return res.status(400).json({ ok: false, error: "BAD_INPUT", detail: "total missing/invalid" });
  }

  const invoice_id = `INV-${Date.now()}`;
  const total_for_hash = Number(total).toFixed(2);

  try {
    const hash_key = generateHashKey(
      total_for_hash,
      Number(installments_number || 1),
      String(currency_code || "TRY"),
      String(MERCHANT_KEY),
      String(invoice_id),
      String(APP_SECRET)
    );

    res.status(200).json({
      ok: true,
      merchant_key: MERCHANT_KEY,
      invoice_id,
      hash_key,
      currency_code: String(currency_code || "TRY"),
      installments_number: Number(installments_number || 1),
      base: isLive ? LIVE_BASE : TEST_BASE,
      total_for_hash, // ← **MÜHİM**: client bu değeri aynen 'total' olarak POST etmeli
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "HASH_FAIL", detail: String(e && e.message) });
  }
};
