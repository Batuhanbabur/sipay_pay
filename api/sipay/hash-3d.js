// api/sipay/hash-3d.js
// Vercel Serverless — Sipay AES-256-CBC hash (PHP ile birebir) + CORS/OPTIONS

const crypto = require("crypto");

// --- CORS yardımcıları ---
function setCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", "*"); // istersen do-lab.co ile kısıtla
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}
function send(res, code, obj) {
  setCORS(res);
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
}

// --- JSON gövdeyi oku ---
async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const raw = await new Promise((resolve, reject) => {
    let b = "";
    req.on("data", (ch) => (b += ch));
    req.on("end", () => resolve(b));
    req.on("error", reject);
  });
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}

// --- PHP ile birebir hash üretimi ---
// data = total|installment|currency|merchant_key|invoice_id
// iv = substr(sha1(mt_rand()), 0, 16)           -> UTF-8 string (16 byte)
// password = sha1(app_secret)                   -> HEX string
// salt = substr(sha1(mt_rand()), 0, 4)          -> HEX string (4 char)
// key = sha256(password . salt)                 -> HEX string, PHP'de düz metin verilir
// openssl_encrypt(..., 'aes-256-cbc', key[:32], 0, iv)
function generateHashKey(totalStr, installment, currency, merchantKey, invoiceId, appSecret) {
  const data = `${totalStr}|${installment}|${currency}|${merchantKey}|${invoiceId}`;

  const ivHex = crypto.createHash("sha1").update(crypto.randomBytes(16)).digest("hex").slice(0, 16);
  const ivBuf = Buffer.from(ivHex, "utf8"); // PHP'de de düz metin

  const passwordHex = crypto.createHash("sha1").update(String(appSecret)).digest("hex"); // 40 char hex
  const saltHex = crypto.createHash("sha1").update(crypto.randomBytes(16)).digest("hex").slice(0, 4); // 4 char hex
  const saltWithPasswordHex = crypto.createHash("sha256").update(passwordHex + saltHex).digest("hex"); // 64 char hex

  // EN KRİTİK FARK: HEX'i binary'e çevirmiyoruz. İlk 32 karakterini UTF-8 düz metin olarak kullanıyoruz.
  const keyBuf = Buffer.from(saltWithPasswordHex.slice(0, 32), "utf8"); // 32 byte (ASCII)

  const cipher = crypto.createCipheriv("aes-256-cbc", keyBuf, ivBuf);
  let enc = cipher.update(data, "utf8", "base64");
  enc += cipher.final("base64");

  const bundle = `${ivHex}:${saltHex}:${enc}`.replace(/\//g, "__");
  return bundle;
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") {
    setCORS(res);
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== "POST") {
    return send(res, 405, { ok: false, error: "METHOD_NOT_ALLOWED", allow: "POST, OPTIONS" });
  }

  const body = await readJson(req);

  const env = String(body.env || "live").toLowerCase(); // "live" | "test"
  const currency_code = String(body.currency_code || "TRY");
  const installments_number = Number(body.installments_number || 1);

  const totalNum = Number(body.total);
  if (!isFinite(totalNum) || totalNum <= 0) {
    return send(res, 400, { ok: false, error: "BAD_TOTAL" });
  }
  const totalStr = totalNum.toFixed(2); // "649.00"

  const IS_LIVE = env === "live";
  const APP_SECRET = IS_LIVE ? process.env.SIPAY_APP_SECRET_LIVE : process.env.SIPAY_APP_SECRET_TEST;
  const MERCHANT_KEY = IS_LIVE ? process.env.SIPAY_MERCHANT_KEY_LIVE : process.env.SIPAY_MERCHANT_KEY_TEST;
  const BASE = IS_LIVE
    ? (process.env.SIPAY_BASE_LIVE || "https://app.sipay.com.tr/ccpayment")
    : (process.env.SIPAY_BASE_TEST || "https://provisioning.sipay.com.tr/ccpayment");

  if (!APP_SECRET || !MERCHANT_KEY) {
    return send(res, 500, { ok: false, error: "ENV_MISSING" });
  }

  const invoice_id = `INV-${Date.now()}`;

  let hash_key;
  try {
    hash_key = generateHashKey(
      totalStr,
      installments_number,
      currency_code,
      MERCHANT_KEY.trim(),
      invoice_id,
      APP_SECRET.trim()
    );
  } catch (e) {
    return send(res, 500, { ok: false, error: "HASH_ERROR", detail: String(e && e.message) });
  }

  return send(res, 200, {
    ok: true,
    merchant_key: MERCHANT_KEY,
    invoice_id,
    hash_key,
    currency_code,
    installments_number,
    base: BASE,
    total: totalStr // ← formda aynen bunu gönder
  });
};
