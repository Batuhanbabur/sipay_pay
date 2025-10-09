// api/sipay/return.js
export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  const THANKYOU_URL = process.env.THANKYOU_URL || "https://do-lab.co/tesekkur_ederiz/";
  const CANCEL_URL   = process.env.CANCEL_URL   || "https://do-lab.co/basarisiz/";

  // Ham body'yi al (Sipay bazen x-www-form-urlencoded, bazen JSON gönderir)
  let body = {};
  if (req.method === "POST") {
    const raw = await new Promise((resolve) => {
      let buf = ""; req.on("data", c => buf += c); req.on("end", () => resolve(buf));
    });
    try { body = JSON.parse(raw); } 
    catch {
      body = Object.fromEntries(new URLSearchParams(raw)); // form-urlencoded
    }
  } else {
    body = req.query || {};
  }

  // Başarı tespiti
  const s = String(
    body.payment_status ?? body.status ?? body.sipay_status ?? body.md_status ?? ""
  ).toLowerCase();
  const success = (s === "1" || s === "success" || s === "completed" || s === "approved");

  // Kullanışlı alanları query'e ekle
  const tgt = new URL(success ? THANKYOU_URL : CANCEL_URL);
  const whitelist = [
    "invoice_id","order_id","amount","currency_code",
    "status_code","status_description","auth_code","error","error_code",
    "md_status","sipay_status","payment_status","transaction_type"
  ];
  whitelist.forEach(k => { if (body[k]) tgt.searchParams.set(k, String(body[k])); });

  // Debug için hata mesajı yoksa, generic mesaj
  if (!success && !body.error && !body.status_description) {
    tgt.searchParams.set("debug", "Sipay cancel döndü (alanlar boş olabilir)");
  }

  res.statusCode = 302;
  res.setHeader("Location", tgt.toString());
  res.end();
}
