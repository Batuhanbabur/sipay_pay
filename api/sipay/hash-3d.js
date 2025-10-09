// api/sipay/hash-3d.js
import crypto from "crypto";

/** Sipay'in beklediği total string normalizasyonu: 1449.00->"1449", 1449.50->"1449.5", 1449.90->"1449.9" */
function sipayNumStr(n) {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  let s = v.toFixed(2);
  s = s.replace(/\.00$/,"").replace(/(\.\d)0$/,"$1");
  return s;
}

/** PHP ile birebir uyumlu AES-256-CBC şifreleme (key ve iv ASCII!) */
function generateHashKey({ totalStr, installment, currency_code, merchant_key, invoice_id, app_secret }) {
  const data = `${totalStr}|${installment}|${currency_code}|${merchant_key}|${invoice_id}`;

  // PHP'deki gibi iv ve salt (ASCII hex karakterler)
  const iv   = crypto.createHash("sha1").update(crypto.randomBytes(16)).digest("hex").slice(0,16); // 16 char
  const salt = crypto.createHash("sha1").update(crypto.randomBytes(16)).digest("hex").slice(0,4);  // 4 char

  // password = sha1(app_secret) -> hex (ASCII)
  const passwordHex = crypto.createHash("sha1").update(String(app_secret)).digest("hex");
  // saltWithPassword = sha256(passwordHex + salt) -> hex (ASCII, 64 char)
  const saltWithPasswordHex = crypto.createHash("sha256").update(passwordHex + salt).digest("hex");

  // *** Kritik fark: PHP openssl_encrypt'e bu HEX string doğrudan veriliyor (ASCII),
  // Node'da da ASCII'nin ilk 32 baytı anahtar olarak kullanılmalı.
  const keyBytes = Buffer.from(saltWithPasswordHex, "utf8").subarray(0, 32); // 32 bytes
  const ivBytes  = Buffer.from(iv, "utf8");                                   // 16 bytes

  const cipher = crypto.createCipheriv("aes-256-cbc", keyBytes, ivBytes);
  let encrypted = cipher.update(data, "utf8", "base64");
  encrypted += cipher.final("base64");

  const bundle = `${iv}:${salt}:${encrypted.replace(/\//g, "__")}`;
  return bundle;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  }

  try {
    const { total, currency_code = "TRY", installments_number = 1, env = "live", invoice_id: forcedInvoice } =
      typeof req.body === "string" ? JSON.parse(req.body||"{}") : (req.body || {});

    // Ortak normalizasyon
    const totalStr = sipayNumStr(total);

    // ENV seçimi
    const isLive = String(env).toLowerCase() === "live";
    const base = isLive ? "https://app.sipay.com.tr/ccpayment" : "https://provisioning.sipay.com.tr/ccpayment";

    // ENV bazlı anahtarlar (Vercel Environment Variables)
    const merchant_key = isLive
      ? process.env.SIPAY_MERCHANT_KEY_LIVE
      : process.env.SIPAY_MERCHANT_KEY_TEST;

    const app_secret = isLive
      ? process.env.SIPAY_APP_SECRET_LIVE
      : process.env.SIPAY_APP_SECRET_TEST;

    if (!merchant_key || !app_secret) {
      return res.status(500).json({ ok: false, error: "MISSING_ENV", detail: "merchant_key or app_secret missing" });
    }

    // invoice id
    const invoice_id = forcedInvoice || `INV-${Date.now()}`;

    // Hash üret
    const hash_key = generateHashKey({
      totalStr,
      installment: Number(installments_number) || 1,
      currency_code,
      merchant_key,
      invoice_id,
      app_secret
    });

    return res.status(200).json({
      ok: true,
      base,
      merchant_key,
      invoice_id,
      hash_key,
      currency_code,
      installments_number: Number(installments_number) || 1,
      // debug amaçlı geri döndürüyoruz (gizli değil):
      total_normalized: totalStr
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "SERVER", detail: String(err && err.message || err) });
  }
}
