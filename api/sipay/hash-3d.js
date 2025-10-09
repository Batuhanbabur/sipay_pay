// api/sipay/hash-3d.js
// Vercel Serverless Function — Sipay paySmart3D hash üretimi (PHP örneğiyle %100 uyumlu)

const crypto = require("crypto");

function sha1Hex(s) { return crypto.createHash("sha1").update(String(s), "utf8").digest("hex"); }
function sha256Hex(s){ return crypto.createHash("sha256").update(String(s), "utf8").digest("hex"); }

// PHP'deki algoritmayı birebir uygular:
// data = total|installments|currency|merchant_key|invoice_id
// iv = substr(sha1(mt_rand()), 0, 16)  (UTF-8 16 byte)
// salt = substr(sha1(mt_rand()), 0, 4)
// key = sha256( sha1(app_secret) + salt )  → ASCII hex (64 byte), AES-256 için ilk 32 bayt alınır
function generateHashKey({ total, installments, currency, merchant_key, invoice_id, app_secret }) {
  const data = `${total}|${installments}|${currency}|${merchant_key}|${invoice_id}`;

  const ivStr   = sha1Hex(Math.random()).substring(0, 16);  // 16-char UTF-8
  const saltStr = sha1Hex(Math.random()).substring(0, 4);   // 4-char
  const password = sha1Hex(app_secret);                      // 40-char hex
  const saltWithPassword = sha256Hex(password + saltStr);    // 64-char hex

  // PHP'de fazla uzun key truncate edilir → Node'da da ilk 32 baytı al
  const keyBuf = Buffer.from(saltWithPassword, "utf8").subarray(0, 32);
  const ivBuf  = Buffer.from(ivStr, "utf8"); // 16 byte

  const cipher = crypto.createCipheriv("aes-256-cbc", keyBuf, ivBuf);
  let encrypted = cipher.update(data, "utf8", "base64");
  encrypted += cipher.final("base64");

  // PHP'deki str_replace('/', '__', $bundle)
  return `${ivStr}:${saltStr}:${encrypted}`.replace(/\//g, "__");
}

// Ortam seçimi
function pickEnv(envFlag) {
  const live = (envFlag || "").toLowerCase() === "live";
  return {
    base: process.env[live ? "SIPAY_LIVE_BASE" : "SIPAY_TEST_BASE"] || (live
      ? "https://app.sipay.com.tr/ccpayment"
      : "https://provisioning.sipay.com.tr/ccpayment"),
    merchant_key: process.env[live ? "SIPAY_LIVE_MERCHANT_KEY" : "SIPAY_TEST_MERCHANT_KEY"],
    app_secret:   process.env[live ? "SIPAY_LIVE_APP_SECRET"   : "SIPAY_TEST_APP_SECRET"  ],
    live
  };
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok:false, error:"METHOD_NOT_ALLOWED" });
  }

  try {
    // Vercel Node API'de body hazır gelir; yoksa JSON okuyalım
    const body = req.body && Object.keys(req.body).length ? req.body
               : await new Promise((resolve, reject) => {
                   let data=""; req.on("data", c=> data+=c);
                   req.on("end", ()=>{ try{ resolve(JSON.parse(data||"{}")); }catch(e){ reject(e); }});
                 });

    const {
      total,                // 649.00 (string veya number)
      currency_code,        // "TRY"
      installments_number,  // 1
      env                   // "live" | "test"
    } = body || {};

    // Zorunlu kontroller
    if (!total || !currency_code || !installments_number) {
      return res.status(400).json({ ok:false, error:"BAD_REQUEST", detail:"missing fields" });
    }

    const envCfg = pickEnv(env);
    if (!envCfg.merchant_key || !envCfg.app_secret) {
      return res.status(500).json({ ok:false, error:"CONFIG", detail:"Missing env keys" });
    }

    // Sipay total kıyaslamasında string "xx.yy" bekleniyor → kanonik hale getir
    const totalFixed = (Math.round(Number(total)*100)/100).toFixed(2);
    const invoice_id = `INV-${Date.now()}`;

    const hash_key = generateHashKey({
      total: totalFixed,
      installments: Number(installments_number),
      currency: String(currency_code).toUpperCase(),
      merchant_key: envCfg.merchant_key,
      invoice_id,
      app_secret: envCfg.app_secret
    });

    return res.status(200).json({
      ok: true,
      base: envCfg.base,
      merchant_key: envCfg.merchant_key,
      invoice_id,
      hash_key,
      // debug amaçlı (prod’da sorun olursa bakarsın)
      canonical: { total: totalFixed, installments: Number(installments_number), currency: String(currency_code).toUpperCase() }
    });
  } catch (err) {
    return res.status(500).json({ ok:false, error:"SERVER", detail: String(err && err.message || err) });
  }
};
