const crypto = require("crypto");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://www.do-lab.co");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { email, user_name, user_phone, user_address, cart } = req.body;

  if (!email || !cart?.length) {
    return res.status(400).json({ error: "email ve cart zorunlu" });
  }

  const merchant_id   = process.env.PAYTR_MERCHANT_ID;
  const merchant_key  = process.env.PAYTR_MERCHANT_KEY;
  const merchant_salt = process.env.PAYTR_MERCHANT_SALT;

  console.log("CREDS CHECK:", {
    id:   merchant_id?.slice(0, 4),
    key:  merchant_key?.slice(0, 4) + "..." + merchant_key?.slice(-4),
    salt: merchant_salt?.slice(0, 4) + "..." + merchant_salt?.slice(-4),
  });

  if (!merchant_id || !merchant_key || !merchant_salt) {
    console.error("PayTR credentials eksik");
    return res.status(500).json({ error: "Sunucu yapılandırma hatası" });
  }

  const TEST_MODE = "1"; // Canlıya geçince "0" yap

  const merchant_oid = "DL" + Date.now();

  const payment_amount = cart.reduce((sum, item) => {
    return sum + Math.round(parseFloat(item.price) * 100) * (item.quantity || 1);
  }, 0);

  const user_ip =
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.socket?.remoteAddress ||
    "1.2.3.4";

  const user_basket = Buffer.from(
    JSON.stringify(
      cart.map((item) => [
        String(item.name),
        parseFloat(item.price).toFixed(2),
        parseInt(item.quantity) || 1,
      ])
    )
  ).toString("base64");

  const hash_str =
    merchant_id +
    user_ip +
    merchant_oid +
    email +
    String(payment_amount) +
    user_basket +
    "0" +
    "0" +
    "TL" +
    TEST_MODE;

  console.log("HASH_STR:", hash_str);

  const paytr_token = crypto
    .createHmac("sha256", merchant_key + merchant_salt)
    .update(hash_str)
    .digest("base64");

  console.log("PAYTR_TOKEN:", paytr_token);

  const postData = new URLSearchParams({
    merchant_id,
    user_ip,
    merchant_oid,
    email,
    payment_amount:   String(payment_amount),
    currency:         "TL",
    user_basket,
    no_installment:   "0",
    max_installment:  "0",
    paytr_token,
    user_name:        user_name    || "Müşteri",
    user_address:     user_address || "Belirtilmedi",
    user_phone:       user_phone   || "05000000000",
    merchant_ok_url:  "https://www.do-lab.co/odeme-basarili",
    merchant_fail_url:"https://www.do-lab.co/odeme-basarisiz",
    timeout_limit:    "30",
    debug_on:         "1",
    test_mode:        TEST_MODE,
    lang:             "tr",
  });

  try {
    const paytrRes = await fetch("https://www.paytr.com/odeme/api/get-token", {
      method:  "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body:    postData.toString(),
    });

    const data = await paytrRes.json();
    console.log("PAYTR RESPONSE:", data);

    if (data.status === "success") {
      return res.status(200).json({ token: data.token, merchant_oid });
    } else {
      console.error("PayTR token hatası:", data);
      return res.status(400).json({ error: data.reason || "Token alınamadı" });
    }
  } catch (err) {
    console.error("PayTR bağlantı hatası:", err);
    return res.status(500).json({ error: "Sunucu hatası" });
  }
};
