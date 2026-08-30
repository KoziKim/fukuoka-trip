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

// 친구가 코멘트를 남기면 서버가 보내주는 푸시
self.addEventListener('push', e => {
  let d = {}
  try { d = e.data ? e.data.json() : {} } catch (err) { d = { body: e.data && e.data.text() } }
  e.waitUntil(self.registration.showNotification(d.title || '후쿠오카 수첩', {
    body: d.body || '',
    icon: './icon.svg',
    badge: './icon.svg',
    tag: d.tag || 'fukuoka',
    data: { url: d.url || './' },
  }))
})

// 알림을 누르면 이미 열려 있는 탭으로 이동, 없으면 새로 연다
self.addEventListener('notificationclick', e => {
  e.notification.close()
  const url = (e.notification.data && e.notification.data.url) || './'
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) if ('focus' in c) return c.focus()
      return self.clients.openWindow(url)
    })
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
