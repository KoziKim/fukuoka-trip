// 코멘트가 달리면 같은 여행의 다른 멤버들에게 웹 푸시를 보낸다.
// DB 트리거가 호출하며, JWT 대신 공유 비밀 헤더로 호출자를 확인한다.
// 배포:  supabase functions deploy notify --no-verify-jwt
// 시크릿: supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... \
//           VAPID_SUBJECT=mailto:... NOTIFY_HOOK_SECRET=...
import { createClient } from 'jsr:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY')!
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY')!
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:trip@example.com'
const APP_URL = Deno.env.get('APP_URL') ?? 'https://kozikim.github.io/fukuoka-trip/'
const HOOK_SECRET = Deno.env.get('NOTIFY_HOOK_SECRET') ?? ''

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE)

const db = createClient(SUPABASE_URL, SERVICE_KEY)

Deno.serve(async (req) => {
  try {
    // --no-verify-jwt 로 열려 있으므로, DB 트리거가 보내는 비밀 헤더로 호출자를 확인한다
    if (HOOK_SECRET && req.headers.get('x-hook-secret') !== HOOK_SECRET) {
      return json({ error: 'forbidden' }, 403)
    }
    const { comment_id } = await req.json()
    if (!comment_id) return json({ error: 'comment_id required' }, 400)

    const { data: comment, error } = await db
      .from('comments')
      .select('id, trip_id, item_id, member_id, author, body')
      .eq('id', comment_id)
      .single()
    if (error || !comment) return json({ error: 'comment not found' }, 404)

    // 어떤 일정에 달린 코멘트인지 제목에 넣어준다
    const { data: item } = await db
      .from('plan_items')
      .select('at, name, place_id')
      .eq('id', comment.item_id)
      .single()
    const where = item?.name || item?.place_id || '일정'
    const title = `${comment.author}님의 코멘트`
    const body = `${item?.at ? item.at + ' ' : ''}${where} · ${comment.body}`

    // 본인 기기는 빼고 같은 여행의 모든 구독 대상에게 보낸다
    const { data: subs } = await db
      .from('push_subs')
      .select('id, endpoint, p256dh, auth, member_id')
      .eq('trip_id', comment.trip_id)
      .neq('member_id', comment.member_id)

    if (!subs?.length) return json({ sent: 0 })

    const payload = JSON.stringify({ title, body, url: APP_URL, tag: `comment-${comment.item_id}` })
    const stale: string[] = []

    const results = await Promise.allSettled(
      subs.map((s) =>
        webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
        ).catch((e: { statusCode?: number }) => {
          // 404/410 = 구독이 만료됨. 지워서 다음부터 시도하지 않는다.
          if (e?.statusCode === 404 || e?.statusCode === 410) stale.push(s.id)
          throw e
        }),
      ),
    )

    if (stale.length) await db.from('push_subs').delete().in('id', stale)

    return json({
      sent: results.filter((r) => r.status === 'fulfilled').length,
      failed: results.filter((r) => r.status === 'rejected').length,
      pruned: stale.length,
    })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
