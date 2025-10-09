// Sipay başarılı dönüş → hash kontrol (opsiyonel) → Teşekkürler sayfasına yönlendir
const crypto = require("crypto");

function validateHashKey(hashKey, app_secret){
  try{
    const prepared = String(hashKey||"").replace(/__/g, "/");
    const [iv, salt, encrypted] = prepared.split(":");
    if(!iv || !salt || !encrypted) return { ok:false };
    const password = crypto.createHash("sha1").update(app_secret).digest("hex");
    const key = crypto.createHash("sha256").update(password + salt).digest();
    const decipher = crypto.createDecipheriv("aes-256-cbc", key, Buffer.from(iv));
    let dec = decipher.update(encrypted, "base64", "utf8");
    dec += decipher.final("utf8");  // "status|total|invoiceId|orderId|currencyCode"
    const [status, total, invoice_id, order_id, currency_code] = dec.split("|");
    return { ok:true, status, total:Number(total||0), invoice_id, order_id, currency_code };
  }catch{ return { ok:false }; }
}

module.exports = async (req, res) => {
  const { invoice_id="", order_no="", order_id="", status_code="", payment_status="", hash_key="" } = req.query || {};
  const v = validateHashKey(hash_key, process.env.SIPAY_APP_SECRET);
  const thankUrl = new URL(process.env.THANK_YOU_URL);
  thankUrl.searchParams.set("invoice_id", invoice_id);
  thankUrl.searchParams.set("order_id", order_no || order_id || "");
  thankUrl.searchParams.set("status_code", status_code);
  thankUrl.searchParams.set("payment_status", payment_status);
  thankUrl.searchParams.set("hash_ok", v.ok ? "1" : "0");
  if(v.ok){ thankUrl.searchParams.set("amount", String(v.total||0)); }
  res.writeHead(302, { Location: thankUrl.toString() });
  res.end();
};
