import { NextResponse } from 'next/server'

const BOT_UA = /bot|googlebot|bingbot|yandex|baiduspider|slurp|baidu|facebookexternalhit|twitterbot|rogerbot|linkedinbot/i

export async function middleware(request) {
  const ua = request.headers.get('user-agent') || ''
  const url = request.nextUrl.clone()

  // Skip obvious assets / api / _next
  const path = url.pathname
  if (
    path.startsWith('/_next') ||
    path.startsWith('/api') ||
    path.startsWith('/static') ||
    path.includes('.png') ||
    path.includes('.jpg') ||
    path.includes('.svg')
  ) {
    return NextResponse.next()
  }

  // If bot -> request prerender snapshot
  if (BOT_UA.test(ua) || url.searchParams.has('_escaped_fragment_')) {
    const prerenderToken = process.env.PRERENDER_TOKEN
    if (!prerenderToken) {
      // Fail-safe: token yoksa normal yanıt ver
      return NextResponse.next()
    }

    // Build prerender service URL (encode the full original URL)
    const original = url.href
    const prerenderUrl = `https://service.prerender.io/${encodeURIComponent(original)}`

    try {
      const prerenderResp = await fetch(prerenderUrl, {
        headers: {
          'X-Prerender-Token': prerenderToken,
          'User-Agent': ua,
          'Accept': 'text/html'
        },
        // optional: set a reasonable timeout via AbortController if you want
      })

      // Eğer prerender başarılıysa response döndür
      if (prerenderResp.ok) {
        const body = await prerenderResp.text()
        const headers = new Headers(prerenderResp.headers)
        // Güvenli header'ları kopyala ve cache kontrol ekle
        headers.set('cache-control', 's-maxage=3600, stale-while-revalidate=86400')
        // İçeriği NextResponse ile döndür
        return new Response(body, {
          status: prerenderResp.status,
          headers
        })
      } else {
        // Hata durumunda fallback
        return NextResponse.next()
      }
    } catch (err) {
      // Hata: fallback olarak normal sayfayı döndür
      return NextResponse.next()
    }
  }

  // Normal kullanıcı isteği
  return NextResponse.next()
}
