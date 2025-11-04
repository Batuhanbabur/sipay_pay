export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).end()
  }

  const token = process.env.PRERENDER_TOKEN
  if (!token) return res.status(500).json({ error: 'No PRERENDER_TOKEN' })

  // Body: { urls: ["https://www.do-lab.co/shop/sku1","..."] }
  const body = req.body
  if (!body || !Array.isArray(body.urls)) {
    return res.status(400).json({ error: 'Expected JSON { urls: [...] }' })
  }

  try {
    const r = await fetch('https://service.prerender.io/recache', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Prerender-Token': token
      },
      body: JSON.stringify({ urls: body.urls })
    })

    const text = await r.text()
    if (!r.ok) {
      return res.status(r.status).send(text)
    }
    return res.status(200).json({ ok: true, detail: text })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
