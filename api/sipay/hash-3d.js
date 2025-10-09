// api/sipay/hash-3d.js
import crypto from "crypto";

export const config = { api: { bodyParser: true } };

function genHashKey({ total, installments, currency_code, merchant_key, invoice_id, app_secret }) {
  // Sipay formatı: total|installment|currency|merchant_key|invoice_id
  const data = `${total}|${installments}|${currency_code}|${merchant_key}|${invoice_id}`;

  // PHP örneğine yakın IV ve salt üretimi
  const iv = crypto.createHash("sha1").update(crypto.randomBytes(16)).digest("hex").substring(0, 16); // 16 char
  const password = crypto.createHash("sha1").update(app_secret).digest("hex");
  const salt = crypto.createHash("sha1").update(crypto.randomBytes(16)).digest("hex").substring(0, 4);
  const key = crypto.createHash("sha256").update(password + salt).digest(); // 32 bytes

  const cipher = crypto.createCipheriv("aes-256-cbc", key, Buffer.from(iv, "utf8"));
  let enc = cipher.update(data, "utf8", "base64");
  enc += cipher.final("base64");

  return `${iv}:${salt}:${enc}`.replace(/\//g, "__");
}

export default async function handler(req, res) {
  // Basit CORS (checkout sayfanız farklı origin ise)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") return res.status(405).json({ ok:false, error:"METHOD" });

  try {
    const { total, currency_code, installments_number, env } = req.body || {};
    if (!(total > 0) || !currency_code) {
      return res.status(400).json({ ok:false, error:"BAD_INPUT" });
    }

    const LIVE_BASE = "https://app.sipay.com.tr/ccpayment";
    const TEST_BASE = "https://provisioning.sipay.com.tr/ccpayment";
    const base = (env === "test") ? TEST_BASE : LIVE_BASE;

    // Vercel env’den canlı anahtarlarınızı kullanın
    const merchant_key = process.env.SIPAY_MERCHANT_KEY;   // örn: $2y$10$F4a6xyQQdD...
    const app_secret   = process.env.SIPAY_APP_SECRET;     // örn: cb835b5ba7...
    if (!merchant_key || !app_secret) {
      return res.status(500).json({ ok:false, error:"MISSING_ENV" });
    }

    // Toplamları ve taksiti string/ondalıklı formata sabitleyin
    const totalStr = Number(total).toFixed(2);
    const inst = Number(installments_number || 1);

    // Benzersiz invoice_id
    const invoice_id = `INV-${Date.now()}`;

    const hash_key = genHashKey({
      total: totalStr,
      installments: inst,
      currency_code,
      merchant_key,
      invoice_id,
      app_secret
    });

    return res.json({
      ok: true,
      base,
      invoice_id,
      merchant_key,
      hash_key,
      total: totalStr,
      installments_number: inst,
      currency_code
    });
  } catch (e) {
    return res.status(500).json({ ok:false, error:"SERVER", detail: String(e) });
  }
}
