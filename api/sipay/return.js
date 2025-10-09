// api/sipay/return.js
export default async function handler(req, res) {
  // Hedef sayfalarınız:
  const THANKYOU_URL = process.env.THANKYOU_URL || "https://do-lab.co/tesekkur_ederiz/";
  const CANCEL_URL   = process.env.CANCEL_URL   || "https://do-lab.co/basarisiz/";

  // POST gövdesini güvenliçe al (JSON ya da x-www-form-urlencoded fark etmez)
  let data = {};
  if (req.method === "POST") {
    if (req.body && Object.keys(req.body).length) {
      data = req.body;
    } else {
      const raw = await new Promise((resolve) => {
        let buf = "";
        req.on("data", (c) => (buf += c));
        req.on("end", () => resolve(buf));
      });
      try { data = JSON.parse(raw); }
      catch { data = Object.fromEntries(new URLSearchParams(raw)); }
    }
  } else {
    data = req.query || {};
  }

  // Sipay’in başarı bilgisini yakala
  const s = String(
    data.payment_status ?? data.status ?? data.sipay_status ?? data.md_status ?? ""
  ).toLowerCase();

  const isSuccess =
    s === "1" || s === "success" || s === "completed" || s === "approved";

  // Bilgilendirici query string ekleyerek yönlendir
  const targetBase = isSuccess ? THANKYOU_URL : CANCEL_URL;
  const url = new URL(targetBase);
  ["invoice_id","order_id","amount","currency_code","status_code","status_description","auth_code","error","error_code"]
    .forEach((k) => { if (data[k]) url.searchParams.set(k, data[k]); });

  res.setHeader("Location", url.toString());
  res.status(302).end();
}

export const config = { api: { bodyParser: true } };
