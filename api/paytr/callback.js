const crypto = require("crypto");

// Upstash Redis — sipariş verisini çek
async function kvGet(key) {
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const res = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await res.json();
  if (!json.result) return null;
  try { return JSON.parse(json.result); } catch(_) { return null; }
}

// Brevo ile mail gönder
async function sendBrevo({ to, toName, subject, html }) {
  const BREVO_API_KEY = process.env.BREVO_API_KEY;
  const FROM_EMAIL    = process.env.FROM_EMAIL;
  if (!BREVO_API_KEY || !FROM_EMAIL) return;
  await fetch("https://api.brevo.com/v3/smtp/email", {
    method:  "POST",
    headers: { "Content-Type": "application/json", "api-key": BREVO_API_KEY },
    body: JSON.stringify({
      sender:      { name: "DO-LAB", email: FROM_EMAIL },
      to:          [{ email: to, name: toName || to }],
      subject,
      htmlContent: html,
    }),
  });
}

// Müşteri onay maili HTML
function buildCustomerEmail({ order, cart, payment_amount, payment_type, user_name, user_address, user_phone }) {
  const fmt = n => "₺" + (Number(n) / 100).toFixed(2).replace(".", ",");

  const cartRows = (cart || []).map(it => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;font-size:14px">${it.name}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;text-align:center;font-size:14px">${it.quantity || 1}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;text-align:right;font-size:14px">₺${parseFloat(it.price).toFixed(2).replace(".",",")}</td>
    </tr>`).join("");

  const paymentTypeLabel = payment_type === "eft" ? "EFT / Havale" : "Kredi / Banka Kartı";

  return `<!DOCTYPE html>
<html lang="tr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:'Helvetica Neue',Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 16px">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">

        <!-- Header -->
        <tr>
          <td style="background:#000;padding:28px 32px;text-align:center">
            <div style="font-size:24px;font-weight:800;color:#fff;letter-spacing:-.5px">DO-LAB</div>
            <div style="font-size:13px;color:rgba(255,255,255,.6);margin-top:4px">do-lab.co</div>
          </td>
        </tr>

        <!-- Teşekkür -->
        <tr>
          <td style="padding:32px 32px 0;text-align:center">
            <div style="font-size:40px;margin-bottom:12px">✅</div>
            <h1 style="margin:0 0 8px;font-size:22px;font-weight:800;color:#111">Siparişiniz Onaylandı!</h1>
            <p style="margin:0;font-size:15px;color:#666">Merhaba ${user_name || "Değerli Müşterimiz"}, siparişiniz alındı ve hazırlanmaya başlandı.</p>
          </td>
        </tr>

        <!-- Sipariş No -->
        <tr>
          <td style="padding:24px 32px">
            <div style="background:#f8f8f8;border-radius:12px;padding:16px 20px;display:flex;justify-content:space-between;align-items:center">
              <div>
                <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#999;margin-bottom:4px">Sipariş No</div>
                <div style="font-size:18px;font-weight:800;color:#111;font-family:monospace">${order}</div>
              </div>
              <div style="text-align:right">
                <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#999;margin-bottom:4px">Ödeme</div>
                <div style="font-size:13px;font-weight:600;color:#111">${paymentTypeLabel}</div>
              </div>
            </div>
          </td>
        </tr>

        <!-- Ürünler -->
        <tr>
          <td style="padding:0 32px 24px">
            <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#999;margin-bottom:12px">Sipariş Detayı</div>
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #f0f0f0;border-radius:12px;overflow:hidden">
              <thead>
                <tr style="background:#fafafa">
                  <th style="padding:10px 12px;text-align:left;font-size:12px;color:#999;font-weight:600">Ürün</th>
                  <th style="padding:10px 12px;text-align:center;font-size:12px;color:#999;font-weight:600">Adet</th>
                  <th style="padding:10px 12px;text-align:right;font-size:12px;color:#999;font-weight:600">Fiyat</th>
                </tr>
              </thead>
              <tbody>${cartRows}</tbody>
              <tfoot>
                <tr style="background:#000">
                  <td colspan="2" style="padding:12px 12px;font-size:14px;font-weight:700;color:#fff">Toplam</td>
                  <td style="padding:12px 12px;text-align:right;font-size:16px;font-weight:800;color:#fff">${fmt(payment_amount)}</td>
                </tr>
              </tfoot>
            </table>
          </td>
        </tr>

        <!-- Teslimat -->
        <tr>
          <td style="padding:0 32px 24px">
            <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#999;margin-bottom:12px">Teslimat Bilgileri</div>
            <div style="background:#f8f8f8;border-radius:12px;padding:16px 20px;font-size:14px;color:#333;line-height:1.6">
              <div style="font-weight:700;margin-bottom:4px">${user_name || ""}</div>
              <div>${user_address || ""}</div>
              ${user_phone ? `<div style="margin-top:4px;color:#666">Tel: ${user_phone}</div>` : ""}
            </div>
          </td>
        </tr>

        <!-- Soru -->
        <tr>
          <td style="padding:0 32px 32px;text-align:center">
            <p style="margin:0 0 16px;font-size:14px;color:#666">Siparişinizle ilgili sorularınız için bize ulaşın.</p>
            <a href="mailto:info@do-lab.co" style="display:inline-block;background:#000;color:#fff;text-decoration:none;padding:12px 24px;border-radius:10px;font-size:14px;font-weight:700">info@do-lab.co</a>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f8f8f8;padding:20px 32px;text-align:center;border-top:1px solid #f0f0f0">
            <p style="margin:0;font-size:12px;color:#aaa">© 2025 DO-LAB · <a href="https://do-lab.co" style="color:#aaa;text-decoration:none">do-lab.co</a></p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  const merchant_key   = process.env.PAYTR_MERCHANT_KEY;
  const merchant_salt  = process.env.PAYTR_MERCHANT_SALT;
  const SHEETS_WEBHOOK = process.env.SHEETS_WEBHOOK_URL;
  const BREVO_API_KEY  = process.env.BREVO_API_KEY;
  const NOTIFY_EMAIL   = process.env.NOTIFY_EMAIL;
  const FROM_EMAIL     = process.env.FROM_EMAIL;

  const {
    merchant_oid, status, total_amount, hash,
    failed_reason_code, failed_reason_msg,
    test_mode, payment_type, currency,
  } = req.body;

  // Hash doğrulama
  const hash_str      = merchant_oid + merchant_salt + status + total_amount;
  const expected_hash = crypto.createHmac("sha256", merchant_key).update(hash_str).digest("base64");

  if (expected_hash !== hash) {
    console.error("PayTR HASH_MISMATCH:", { merchant_oid });
    return res.status(400).send("HASH_MISMATCH");
  }

  const isSuccess = status === "success";
  const now = new Date().toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" });

  // KV'den sipariş verisini çek
  const orderData = await kvGet(`order:${merchant_oid}`).catch(() => null);

  // 1. Sheets güncelle
  const sheetsPromise = SHEETS_WEBHOOK
    ? fetch(SHEETS_WEBHOOK, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action:         "update",
          merchant_oid,
          status:         isSuccess ? "Ödendi" : `Başarısız (${failed_reason_code})`,
          total_amount:   (total_amount / 100).toFixed(2),
          payment_type:   payment_type || "",
          currency:       currency || "TL",
          timestamp_paid: isSuccess ? now : "",
        }),
      }).catch(err => console.error("Sheets hatası:", err))
    : Promise.resolve();

  // 2. Müşteriye onay maili (sadece başarılı ödemelerde)
  const customerEmailPromise = (isSuccess && orderData?.email && BREVO_API_KEY)
    ? sendBrevo({
        to:      orderData.email,
        toName:  orderData.user_name || "",
        subject: `✅ Siparişiniz Alındı — ${merchant_oid}`,
        html:    buildCustomerEmail({
          order:          merchant_oid,
          cart:           orderData.cart || [],
          payment_amount: total_amount,
          payment_type,
          user_name:      orderData.user_name,
          user_address:   orderData.user_address,
          user_phone:     orderData.user_phone,
        }),
      }).catch(err => console.error("Müşteri maili hatası:", err))
    : Promise.resolve();

  // 3. Sana bildirim maili
  const notifyHtml = isSuccess
    ? `<div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto">
        <div style="background:#000;padding:16px 20px"><h2 style="color:#fff;margin:0;font-size:16px">✅ Ödeme Onaylandı — DO-LAB</h2></div>
        <div style="padding:20px;border:1px solid #eee">
          <p><b>Sipariş No:</b> ${merchant_oid}</p>
          <p><b>Müşteri:</b> ${orderData?.user_name || "—"}</p>
          <p><b>E-posta:</b> ${orderData?.email || "—"}</p>
          <p><b>Tutar:</b> ₺${(total_amount/100).toFixed(2)} ${currency||"TL"}</p>
          <p><b>Ödeme Tipi:</b> ${payment_type||"-"}</p>
          <p><b>Zaman:</b> ${now}</p>
          ${test_mode==="1" ? '<p style="color:#c00"><b>⚠️ TEST MOD</b></p>' : ""}
        </div>
      </div>`
    : `<div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto">
        <div style="background:#b00020;padding:16px 20px"><h2 style="color:#fff;margin:0;font-size:16px">❌ Ödeme Başarısız — DO-LAB</h2></div>
        <div style="padding:20px;border:1px solid #eee">
          <p><b>Sipariş No:</b> ${merchant_oid}</p>
          <p><b>Müşteri:</b> ${orderData?.user_name || "—"}</p>
          <p><b>Hata Kodu:</b> ${failed_reason_code}</p>
          <p><b>Açıklama:</b> ${failed_reason_msg}</p>
          <p><b>Zaman:</b> ${now}</p>
        </div>
      </div>`;

  const notifyPromise = (BREVO_API_KEY && NOTIFY_EMAIL && FROM_EMAIL)
    ? sendBrevo({
        to:      NOTIFY_EMAIL,
        subject: isSuccess
          ? `✅ Ödeme geldi: ${merchant_oid} — ₺${(total_amount/100).toFixed(2)}`
          : `❌ Ödeme başarısız: ${merchant_oid}`,
        html: notifyHtml,
      }).catch(err => console.error("Bildirim maili hatası:", err))
    : Promise.resolve();

  await Promise.allSettled([sheetsPromise, customerEmailPromise, notifyPromise]);

  res.setHeader("Content-Type", "text/plain");
  return res.status(200).send("OK");
};
