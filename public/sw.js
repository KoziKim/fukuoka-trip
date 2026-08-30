// 후쿠오카 수첩 — 오프라인 캐시 + 자동 업데이트
//
// 캐시 전략을 요청 종류에 따라 나눈다.
//  · HTML(내비게이션): 네트워크 우선. 새 배포가 나오면 바로 반영되고, 오프라인일 때만 캐시를 쓴다.
//    (예전처럼 캐시를 먼저 주면 홈 화면에 추가한 앱이 계속 옛 화면을 보여준다.)
//  · /assets/*: 파일명에 내용 해시가 붙어 있어 내용이 절대 안 바뀌므로 캐시 우선.
//  · 그 외(아이콘·매니페스트): 캐시를 주고 뒤에서 갱신.
const CACHE = 'fukuoka-note-v2'

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', e => {
  const req = e.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)
  const sameOrigin = url.origin === self.location.origin

  // HTML: 네트워크 우선
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const res = await fetch(req)
        if (res && res.ok) (await caches.open(CACHE)).put(req, res.clone())
        return res
      } catch (err) {
        return (await caches.match(req)) || (await caches.match('./index.html')) || Response.error()
      }
    })())
    return
  }

  // 해시가 붙은 정적 파일: 캐시 우선
  if (sameOrigin && url.pathname.includes('/assets/')) {
    e.respondWith((async () => {
      const hit = await caches.match(req)
      if (hit) return hit
      const res = await fetch(req)
      if (res && res.ok) (await caches.open(CACHE)).put(req, res.clone())
      return res
    })())
    return
  }

  // 나머지: 캐시를 주고 뒤에서 갱신
  e.respondWith((async () => {
    const cache = await caches.open(CACHE)
    const hit = await cache.match(req)
    const net = fetch(req).then(res => {
      if (res && res.ok) cache.put(req, res.clone())
      return res
    }).catch(() => hit)
    return hit || net
  })())
})

// 페이지가 "지금 바로 새 버전으로 바꿔라"라고 요청할 때
self.addEventListener('message', e => {
  if (e.data === 'skipWaiting') self.skipWaiting()
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
