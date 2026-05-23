// api/paytr/callback.js
// PayTR ödeme sonucunu alır, hash doğrular,
// Sheets'i günceller ve Brevo ile bildirim gönderir.

const crypto = require("crypto");

export default async function handler(req, res) {
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

  // ── Hash doğrulama ────────────────────────────────────────────
  const hash_str      = merchant_oid + merchant_salt + status + total_amount;
  const expected_hash = crypto
    .createHmac("sha256", merchant_key)
    .update(hash_str)
    .digest("base64");

  if (expected_hash !== hash) {
    console.error("PayTR HASH_MISMATCH:", { merchant_oid });
    return res.status(400).send("HASH_MISMATCH");
  }

  const isSuccess = status === "success";
  const now = new Date().toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" });

  console.log(isSuccess
    ? `✅ Ödeme başarılı | ${merchant_oid} | ₺${(total_amount/100).toFixed(2)} | ${payment_type}`
    : `❌ Ödeme başarısız | ${merchant_oid} | Kod: ${failed_reason_code} | ${failed_reason_msg}`
  );

  // ── 1. Google Sheets — satırı güncelle ───────────────────────
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
      }).catch(err => console.error("Sheets güncelleme hatası:", err))
    : Promise.resolve();

  // ── 2. Brevo — ödeme sonuç bildirimi ─────────────────────────
  const notifyHtml = isSuccess
    ? `<div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto">
        <div style="background:#000;padding:16px 20px">
          <h2 style="color:#fff;margin:0;font-size:16px">✅ Ödeme Onaylandı — DO-LAB</h2>
        </div>
        <div style="padding:20px;border:1px solid #eee">
          <p><b>Sipariş No:</b> ${merchant_oid}</p>
          <p><b>Tutar:</b> ₺${(total_amount/100).toFixed(2)} ${currency||"TL"}</p>
          <p><b>Ödeme Tipi:</b> ${payment_type||"-"}</p>
          <p><b>Zaman:</b> ${now}</p>
          ${test_mode==="1" ? '<p style="color:#c00"><b>⚠️ TEST MOD</b></p>' : ""}
        </div>
      </div>`
    : `<div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto">
        <div style="background:#b00020;padding:16px 20px">
          <h2 style="color:#fff;margin:0;font-size:16px">❌ Ödeme Başarısız — DO-LAB</h2>
        </div>
        <div style="padding:20px;border:1px solid #eee">
          <p><b>Sipariş No:</b> ${merchant_oid}</p>
          <p><b>Hata Kodu:</b> ${failed_reason_code}</p>
          <p><b>Açıklama:</b> ${failed_reason_msg}</p>
          <p><b>Zaman:</b> ${now}</p>
        </div>
      </div>`;

  const brevoPromise = (BREVO_API_KEY && NOTIFY_EMAIL && FROM_EMAIL)
    ? fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key":      BREVO_API_KEY,
        },
        body: JSON.stringify({
          sender:      { name: "DO-LAB Orders", email: FROM_EMAIL },
          to:          [{ email: NOTIFY_EMAIL }],
          subject:     isSuccess
            ? `✅ Ödeme geldi: ${merchant_oid} — ₺${(total_amount/100).toFixed(2)}`
            : `❌ Ödeme başarısız: ${merchant_oid}`,
          htmlContent: notifyHtml,
        }),
      }).catch(err => console.error("Brevo callback hatası:", err))
    : Promise.resolve();

  await Promise.allSettled([sheetsPromise, brevoPromise]);

  // PayTR'ye mutlaka "OK" dön
  res.setHeader("Content-Type", "text/plain");
  return res.status(200).send("OK");
}
