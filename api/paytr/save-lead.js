module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://www.do-lab.co");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const SHEETS_WEBHOOK = process.env.SHEETS_WEBHOOK_URL;
  const BREVO_API_KEY  = process.env.BREVO_API_KEY;
  const NOTIFY_EMAIL   = process.env.NOTIFY_EMAIL;
  const FROM_EMAIL     = process.env.FROM_EMAIL;

  const {
    merchant_oid, firstName, lastName, email, phone,
    addr1, district, city, country, postcode,
    invType, inv_full_name, inv_tcno,
    inv_company, inv_tax_office, inv_tax_no,
    inv_addr1, inv_district, inv_city, inv_country, inv_postcode,
    sameAddr, cart, totalAmount,
  } = req.body;

  if (!merchant_oid || !email) {
    return res.status(400).json({ error: "merchant_oid ve email zorunlu" });
  }

  const now = new Date().toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" });

  const sheetsPromise = SHEETS_WEBHOOK
    ? fetch(SHEETS_WEBHOOK, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          merchant_oid, timestamp: now, status: "Terk Edildi",
          firstName, lastName, email, phone,
          addr1, district, city, country, postcode,
          invType, inv_full_name, inv_tcno,
          inv_company, inv_tax_office, inv_tax_no,
          inv_addr1:    sameAddr ? addr1    : inv_addr1,
          inv_district: sameAddr ? district : inv_district,
          inv_city:     sameAddr ? city     : inv_city,
          totalAmount, cart: JSON.stringify(cart || []),
        }),
      }).catch(err => console.error("Sheets hata:", err))
    : Promise.resolve();

  const cartRows = (cart || []).map(it => `
    <tr>
      <td style="padding:6px 10px;border-bottom:1px solid #eee">${it.name}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:center">${it.quantity}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">₺${parseFloat(it.price).toFixed(2)}</td>
    </tr>`).join("");

  const invoiceInfo = invType === "kurumsal"
    ? `<b>Şirket:</b> ${inv_company}<br><b>Vergi Dairesi:</b> ${inv_tax_office}<br><b>Vergi No:</b> ${inv_tax_no}`
    : `<b>Ad Soyad:</b> ${inv_full_name}<br><b>TC No:</b> ${inv_tcno}`;

  const invAddress = sameAddr
    ? `${addr1}, ${district}, ${city} (gönderimle aynı)`
    : `${inv_addr1}, ${inv_district}, ${inv_city}`;

  const emailHtml = `
  <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#111">
    <div style="background:#000;padding:20px 24px">
      <h2 style="color:#fff;margin:0;font-size:18px">🛒 Yeni Checkout Girişi — DO-LAB</h2>
    </div>
    <div style="padding:24px;background:#fff;border:1px solid #eee">
      <p style="margin:0 0 4px"><b>Sipariş No:</b> ${merchant_oid}</p>
      <p style="margin:0 0 16px;color:#888;font-size:13px">${now}</p>
      <h3 style="margin:0 0 8px;font-size:15px;border-bottom:1px solid #eee;padding-bottom:6px">Müşteri</h3>
      <p style="margin:0 0 4px">${firstName} ${lastName}</p>
      <p style="margin:0 0 4px">${email}</p>
      <p style="margin:0 0 16px">${phone}</p>
      <h3 style="margin:0 0 8px;font-size:15px;border-bottom:1px solid #eee;padding-bottom:6px">Gönderim Adresi</h3>
      <p style="margin:0 0 16px">${addr1}, ${district}, ${city} ${postcode || ""} ${country}</p>
      <h3 style="margin:0 0 8px;font-size:15px;border-bottom:1px solid #eee;padding-bottom:6px">
        Fatura — ${invType === "kurumsal" ? "Kurumsal" : "Bireysel"}
      </h3>
      <p style="margin:0 0 4px">${invoiceInfo}</p>
      <p style="margin:0 0 16px"><b>Fatura Adresi:</b> ${invAddress}</p>
      <h3 style="margin:0 0 8px;font-size:15px;border-bottom:1px solid #eee;padding-bottom:6px">Sepet</h3>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <thead><tr style="background:#f5f5f5">
          <th style="padding:6px 10px;text-align:left">Ürün</th>
          <th style="padding:6px 10px;text-align:center">Adet</th>
          <th style="padding:6px 10px;text-align:right">Fiyat</th>
        </tr></thead>
        <tbody>${cartRows}</tbody>
      </table>
      <p style="text-align:right;font-weight:700;font-size:16px;margin-top:10px">
        Toplam: ₺${parseFloat(totalAmount || 0).toFixed(2)}
      </p>
      <div style="margin-top:20px;padding:12px;background:#fff8e1;border-radius:8px;font-size:13px;color:#7a5800">
        ⏳ Bu bildirim ödeme tamamlanmadan gönderildi. PayTR callback bekleniyor.
      </div>
    </div>
  </div>`;

  const brevoPromise = (BREVO_API_KEY && NOTIFY_EMAIL && FROM_EMAIL)
    ? fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "Content-Type": "application/json", "api-key": BREVO_API_KEY },
        body: JSON.stringify({
          sender:      { name: "DO-LAB Orders", email: FROM_EMAIL },
          to:          [{ email: NOTIFY_EMAIL }],
          subject:     `🛒 Checkout: ${firstName} ${lastName} — ₺${parseFloat(totalAmount||0).toFixed(2)}`,
          htmlContent: emailHtml,
        }),
      }).catch(err => console.error("Brevo hata:", err))
    : Promise.resolve();

  await Promise.allSettled([sheetsPromise, brevoPromise]);
  return res.status(200).json({ ok: true });
}
