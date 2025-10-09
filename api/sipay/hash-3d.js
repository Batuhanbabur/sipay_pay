// api/sipay/hash-3d.js
// Node.js (Vercel Serverless) — Sipay AES-256-CBC hash üretimi + CORS/OPTIONS

const crypto = require("crypto");

// ------- CORS yardımcıları -------
function setCORS(res) {
  // Gerekirse sadece 'https://do-lab.co' da yazabilirsin
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function end(res, code, obj) {
  setCORS(res);
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
}

// ------- Request body'yi güvenle oku -------
async function readJson(req) {
  // Vercel bazen req.body'yi otomatik parse edebiliyor; varsa direkt kullan
  if (req.body && typeof req.body === "object") return req.body;

  const raw = await new Promise((resolve, reject) => {
    let b = "";
    req.on("data", (ch) => (b += ch));
    req.on("end", () => resolve(b));
    req.on("error", reject);
  });
  try {
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

// ------- Sipay hash üretimi -------
// PHP'deki örneğe birebir: 
// data = total|installment|currency|merchant_key|invoice_id
// iv = substr(sha1(mt_rand()), 0, 16)
// password = sha1(app_secret)
// salt = substr(sha1(mt_rand()), 0, 4)
// key = sha256(password + salt)
// enc = openssl_encrypt(data, 'aes-256-cbc', key, 0, iv)
// return str_replace('/', '__', iv + ':' + salt + ':' + enc)
function generateHashKey(total, installment, currency, merchantKey, invoiceId, appSecret) {
  // total string olmalı (ör: "649.00")
  const data = `${total}|${installment}|${currency}|${merchantKey}|${invoiceId}`;

  const iv = crypto.createHash("sha1").update(crypto.randomBytes(16)).digest("hex").slice(0, 16);
  const password = crypto.createHash("sha1").update(String(appSecret)).digest("hex");
  const salt = crypto.createHash("sha1").update(crypto.randomBytes(16)).digest("hex").slice(0, 4);
  const saltWithPassword = crypto.createHash("sha256").update(password + salt).digest("hex");

  const key = Buffer.from(saltWithPassword, "hex");    // 32 bytes
  const ivBuf = Buffer.from(iv, "utf8");               // 16 bytes

  const cipher = crypto.createCipheriv("aes-256-cbc", key, ivBuf);
  let encrypted = cipher.update(data, "utf8", "base64");
  encrypted += cipher.final("base64");

  const bundle = `${iv}:${salt}:${encrypted}`.replace(/\//g, "__");
  return bundle;
}

module.exports = async (req, res) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    setCORS(res);
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== "POST") {
    return end(res, 405, { ok: false, error: "METHOD_NOT_ALLOWED", allow: "POST, OPTIONS" });
  }

  const body = await readJson(req);

  // İstekten gelenler
  const env = String(body.env || "live").toLowerCase(); // "live" | "test"
  const currency_code = String(body.currency_code || "TRY");
  const installments_number = Number(body.installments_number || 1);

  // total'i 2 ondalığa çevir
  const totalNum = Number(body.total);
  if (!isFinite(totalNum) || totalNum <= 0) {
    return end(res, 400, { ok: false, error: "BAD_TOTAL" });
  }
  const totalStr = totalNum.toFixed(2); // "649.00"

  // ENV değişkenlerini seç
  const IS_LIVE = env === "live";
  const APP_ID = IS_LIVE ? process.env.SIPAY_APP_ID_LIVE : process.env.SIPAY_APP_ID_TEST;
  const APP_SECRET = IS_LIVE ? process.env.SIPAY_APP_SECRET_LIVE : process.env.SIPAY_APP_SECRET_TEST;
  const MERCHANT_KEY = IS_LIVE ? process.env.SIPAY_MERCHANT_KEY_LIVE : process.env.SIPAY_MERCHANT_KEY_TEST;
  const BASE = IS_LIVE
    ? (process.env.SIPAY_BASE_LIVE || "https://app.sipay.com.tr/ccpayment")
    : (process.env.SIPAY_BASE_TEST || "https://provisioning.sipay.com.tr/ccpayment");

  // Zorunlu env kontrolü
  if (!APP_SECRET || !MERCHANT_KEY) {
    return end(res, 500, { ok: false, error: "ENV_MISSING" });
  }

  // invoice_id
  const invoice_id = `INV-${Date.now()}`;

  // hash üret
  let hash_key;
  try {
    hash_key = generateHashKey(totalStr, installments_number, currency_code, MERCHANT_KEY.trim(), invoice_id, APP_SECRET.trim());
  } catch (e) {
    return end(res, 500, { ok: false, error: "HASH_ERROR", detail: String(e && e.message) });
  }

  return end(res, 200, {
    ok: true,
    merchant_key: MERCHANT_KEY,
    invoice_id,
    hash_key,
    currency_code,
    installments_number,
    base: BASE
  });
};
