// Serverless function (Vercel). Frontend buraya POST eder; biz Sipay’den link alırız.
const crypto = require("crypto");

const LIVE = process.env.SIPAY_LIVE === "1";
const BASE = LIVE
  ? "https://app.sipay.com.tr/ccpayment"
  : "https://provisioning.sipay.com.tr/ccpayment";

function generateHashKey({ total, installments_number, currency_code, merchant_key, invoice_id, app_secret }){
  const data = `${total}|${installments_number}|${currency_code}|${merchant_key}|${invoice_id}`;
  const iv = crypto.createHash("sha1").update(String(Math.random())).digest("hex").substring(0,16);
  const password = crypto.createHash("sha1").update(app_secret).digest("hex");
  const salt = crypto.createHash("sha1").update(String(Math.random())).digest("hex").substring(0,4);
  const key = crypto.createHash("sha256").update(password + salt).digest();
  const cipher = crypto.createCipheriv("aes-256-cbc", key, Buffer.from(iv));
  let enc = cipher.update(data, "utf8", "base64");
  enc += cipher.final("base64");
  return `${iv}:${salt}:${enc}`.replace(/\//g, "__");
}

module.exports = async (req, res) => {
  // Basit CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  try{
    const {
      invoice_id,
      currency_code = "TRY",
      installments_number = 1,
      name, surname,
      bill_email, bill_phone,
      bill_address1 = "", bill_address2 = "", bill_city = "", bill_state = "", bill_postcode = "", bill_country = "Türkiye",
      items
    } = req.body || {};

    if(!process.env.SIPAY_MERCHANT_KEY || !process.env.SIPAY_APP_SECRET){
      return res.status(500).json({ error: "SERVER_KEYS_MISSING" });
    }
    if(!invoice_id) return res.status(400).json({ error: "invoice_id required" });
    if(!Array.isArray(items) || !items.length) return res.status(400).json({ error: "items[] required" });

    const norm = items.map(i=>({
      name: String(i.name||"Item"),
      price: Number(i.price)||0,
      quantity: Number(i.quantity ?? i.qty ?? 1),
      description: String(i.description || i.name || "Item")
    }));
    const total = norm.reduce((s,i)=> s + i.price*i.quantity, 0);

    const hash_key = generateHashKey({
      total,
      installments_number,
      currency_code,
      merchant_key: process.env.SIPAY_MERCHANT_KEY,
      invoice_id,
      app_secret: process.env.SIPAY_APP_SECRET
    });

    const body = {
      merchant_key: process.env.SIPAY_MERCHANT_KEY,
      invoice: JSON.stringify(norm),
      currency_code,
      max_installment: installments_number,
      name, surname,
      hash_key,
      bill_address1, bill_address2, bill_city, bill_postcode, bill_state, bill_country,
      bill_email, bill_phone,
      transaction_type: "Auth",
      sale_web_hook_key: process.env.SALE_WEB_HOOK_KEY || undefined,
      order_type: 0,
      return_url: process.env.RETURN_URL,
      cancel_url: process.env.CANCEL_URL
    };

    const r = await fetch(`${BASE}/purchase/link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await r.json();

    if (data && (data.status === true || data.status_code === "100") && data.link){
      return res.status(200).json({ link: data.link, order_id: data.order_id || null });
    } else {
      return res.status(400).json({ error: "SIPAY_ERROR", detail: data });
    }
  }catch(err){
    return res.status(500).json({ error: "SERVER", detail: String(err) });
  }
};
