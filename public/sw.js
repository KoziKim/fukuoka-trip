// 후쿠오카 수첩 — 오프라인 캐시 + 자동 업데이트
//
// 캐시 전략을 요청 종류에 따라 나눈다.
//  · HTML(내비게이션): 네트워크 우선. 새 배포가 나오면 바로 반영되고, 오프라인일 때만 캐시를 쓴다.
//    (예전처럼 캐시를 먼저 주면 홈 화면에 추가한 앱이 계속 옛 화면을 보여준다.)
//  · /assets/*: 파일명에 내용 해시가 붙어 있어 내용이 절대 안 바뀌므로 캐시 우선.
//  · 그 외(아이콘·매니페스트): 캐시를 주고 뒤에서 갱신.
const CACHE = 'fukuoka-note-v3'

// 우리 사이트가 아닌 곳 중 캐시해도 되는 것 (폰트뿐). 나머지 외부 요청은 손대지 않는다.
const CACHEABLE_HOSTS = /(^|\.)jsdelivr\.net$|(^|\.)googleapis\.com$|(^|\.)gstatic\.com$/

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

  // 외부 요청은 폰트만 캐시하고 나머지는 건드리지 않는다.
  // 특히 Supabase API 응답을 캐시하면, 저장한 뒤 다시 읽을 때 옛 값이 돌아와
  // 방금 한 변경이 되돌아간 것처럼 보인다.
  if (!sameOrigin) {
    if (!CACHEABLE_HOSTS.test(url.hostname)) return
    e.respondWith((async () => {
      const cache = await caches.open(CACHE)
      const hit = await cache.match(req)
      if (hit) return hit
      const res = await fetch(req)
      if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone())
      return res
    })())
    return
  }

  // 버전 확인 파일은 절대 캐시하지 않는다. 캐시하면 새 버전을 영영 못 알아챈다.
  if (sameOrigin && url.pathname.endsWith('/version.json')) {
    e.respondWith(fetch(req, { cache: 'no-store' }).catch(() => new Response('{}', {
      headers: { 'Content-Type': 'application/json' },
    })))
    return
  }

  // HTML: 항상 새로 받는다.
  // GitHub Pages 는 index.html 에도 Cache-Control: max-age=600 을 붙이고 이 헤더는 바꿀 수 없다.
  // cache:'reload' 로 브라우저 HTTP 캐시까지 건너뛰어야 배포 직후 새 번들을 가리키는 HTML이 온다.
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const res = await fetch(req, { cache: 'reload' })
        if (res && res.ok) (await caches.open(CACHE)).put(req, res.clone())
        return res
      } catch (err) {
        // 오프라인일 때만 캐시로 대체한다 (여행 중 지하철 등)
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
