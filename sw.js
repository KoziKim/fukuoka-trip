// 후쿠오카 수첩 — 오프라인용 서비스워커 (stale-while-revalidate)
const CACHE = 'fukuoka-note-v1'

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return
  e.respondWith(
    caches.open(CACHE).then(async cache => {
      const cached = await cache.match(e.request)
      const network = fetch(e.request)
        .then(res => {
          if (res && res.ok) cache.put(e.request, res.clone())
          return res
        })
        .catch(() => cached)
      return cached || network
    })
  )
})
