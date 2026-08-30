// 여행을 친구들과 공유하기 위한 Supabase 레이어.
// 설정이 없으면 active=false로 남고, 앱은 기존처럼 이 기기에만 저장한다.
import { SUPABASE_URL, SUPABASE_ANON_KEY, VAPID_PUBLIC_KEY, cloudConfigured, pushConfigured } from './config.js'

const SESSION_KEY = 'fukuoka-trip-session'

export const cloud = {
  configured: cloudConfigured,
  active: false,          // 여행에 참가한 상태인가
  trip: null,             // { id, code, name }
  me: null,               // { memberId, name }
  members: [],
  error: '',
}

let sb = null
let onChange = () => {}
let channel = null

/** 공유 기능을 실제로 쓸 때만 Supabase SDK를 내려받는다 (첫 로딩을 가볍게) */
export async function initCloud(handler) {
  onChange = handler || (() => {})
  if (!cloudConfigured) return null
  const { createClient } = await import('@supabase/supabase-js')
  sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true },
  })
  return sb
}

function saveSession() {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ trip: cloud.trip, me: cloud.me }))
  } catch (e) { /* 프라이빗 모드 */ }
}
function loadSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null') } catch (e) { return null }
}
export function clearSession() {
  try { localStorage.removeItem(SESSION_KEY) } catch (e) { /* ignore */ }
  cloud.active = false; cloud.trip = null; cloud.me = null; cloud.members = []
  unsubscribe()
}

/** 익명 계정 확보 — 사용자에겐 보이지 않는다 */
async function ensureAuth() {
  const { data } = await sb.auth.getSession()
  if (data.session) return data.session
  const { data: anon, error } = await sb.auth.signInAnonymously()
  if (error) throw error
  return anon.session
}

/** 저장된 세션으로 자동 복귀. 참가 이력이 없으면 false */
export async function resumeTrip() {
  if (!sb) return false
  const s = loadSession()
  if (!s?.trip?.id || !s?.me?.name) return false
  try {
    await ensureAuth()
    // 같은 기기라도 익명 계정이 새로 발급됐을 수 있어 참가를 한 번 더 확인한다
    return await joinTrip(s.trip.code, s.me.name)
  } catch (e) {
    cloud.error = String(e.message || e)
    return false
  }
}

/** 내가 속한 여행 목록. RLS 가 내 여행만 보여주므로 그대로 쓰면 된다 */
export async function listTrips() {
  if (!sb) return []
  const { data: auth } = await sb.auth.getUser()
  if (!auth?.user) return []
  const { data, error } = await sb
    .from('members')
    .select('id, name, created_at, trip:trips(id, code, name)')
    .eq('user_id', auth.user.id)
    .order('created_at')
  if (error) throw error
  return (data || []).filter(r => r.trip).map(r => ({
    tripId: r.trip.id, code: r.trip.code, name: r.trip.name,
    memberId: r.id, myName: r.name,
  }))
}

/** 다른 여행으로 갈아탄다 */
export function switchTrip(t) {
  cloud.trip = { id: t.tripId, code: t.code, name: t.name }
  cloud.me = { memberId: t.memberId, name: t.myName }
  cloud.active = true
  cloud.error = ''
  saveSession()
  subscribe()
}

/**
 * 지금 여행을 통째로 복사해 새 여행을 만든다. 실수로 지웠을 때를 대비한 백업용.
 * 일정과 코멘트까지 옮기며, 코멘트는 작성자 이름만 남기고 계정 연결은 끊는다.
 */
export async function duplicateTrip(newName) {
  if (!cloud.active) throw new Error('먼저 여행에 들어가 주세요.')
  const src = cloud.trip.id

  const [trip, items, comments] = await Promise.all([
    sb.from('trips').select('state').eq('id', src).single(),
    sb.from('plan_items').select('id, day, at, place_id, name, memo').eq('trip_id', src).order('day').order('at').order('created_at'),
    sb.from('comments').select('item_id, author, body').eq('trip_id', src).order('created_at'),
  ])
  if (trip.error) throw trip.error

  const made = await sb.rpc('create_trip', { p_name: newName, p_member: cloud.me.name })
  if (made.error) throw made.error
  const row = Array.isArray(made.data) ? made.data[0] : made.data
  const dst = row.trip_id

  if (trip.data?.state) {
    const { error } = await sb.from('trips').update({ state: trip.data.state }).eq('id', dst)
    if (error) throw error
  }

  const srcItems = items.data || []
  if (srcItems.length) {
    const { data: newItems, error } = await sb.from('plan_items').insert(
      srcItems.map(i => ({
        trip_id: dst, day: i.day, at: i.at, place_id: i.place_id, name: i.name, memo: i.memo,
        created_by: row.member_id,
      })),
    ).select('id')
    if (error) throw error
    // 넣은 순서대로 돌아오므로 옛 id ↔ 새 id 를 짝지을 수 있다
    const idMap = {}
    srcItems.forEach((it, n) => { if (newItems[n]) idMap[it.id] = newItems[n].id })

    const srcComments = (comments.data || []).filter(c => idMap[c.item_id])
    if (srcComments.length) {
      const { error: cErr } = await sb.from('comments').insert(
        srcComments.map(c => ({
          trip_id: dst, item_id: idMap[c.item_id], member_id: null,
          author: c.author, body: c.body,
        })),
      )
      if (cErr) throw cErr
    }
  }
  return { tripId: dst, code: row.trip_code, name: newName, memberId: row.member_id, myName: cloud.me.name }
}

export async function renameTrip(name) {
  const { error } = await sb.from('trips').update({ name }).eq('id', cloud.trip.id)
  if (error) throw error
  cloud.trip.name = name
}

export async function createTrip(tripName, memberName) {
  await ensureAuth()
  const { data, error } = await sb.rpc('create_trip', { p_name: tripName, p_member: memberName })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  return afterJoin(row, memberName, tripName)
}

export async function joinTrip(code, memberName) {
  await ensureAuth()
  const { data, error } = await sb.rpc('join_trip', { p_code: code, p_member: memberName })
  if (error) {
    if (String(error.message).includes('TRIP_NOT_FOUND')) throw new Error('초대코드를 찾을 수 없어요.')
    throw error
  }
  const row = Array.isArray(data) ? data[0] : data
  return afterJoin(row, memberName)
}

async function afterJoin(row, memberName, tripName) {
  cloud.trip = { id: row.trip_id, code: row.trip_code, name: tripName || '' }
  cloud.me = { memberId: row.member_id, name: memberName }
  cloud.active = true
  cloud.error = ''
  saveSession()
  subscribe()
  return true
}

/* ─────────── 읽기 ─────────── */

export async function fetchAll() {
  if (!cloud.active) return null
  const t = cloud.trip.id
  const [trip, items, comments, members, activity] = await Promise.all([
    sb.from('trips').select('id, code, name, state').eq('id', t).single(),
    sb.from('plan_items').select('*').eq('trip_id', t).order('day').order('at'),
    sb.from('comments').select('*').eq('trip_id', t).order('created_at'),
    sb.from('members').select('id, name').eq('trip_id', t),
    sb.from('activity').select('*').eq('trip_id', t).order('created_at', { ascending: false }).limit(30),
  ])
  if (trip.error) throw trip.error
  cloud.trip.name = trip.data.name
  cloud.members = members.data || []
  return {
    state: trip.data.state || {},
    items: items.data || [],
    comments: comments.data || [],
    activity: activity.data || [],
  }
}

/* ─────────── 쓰기 ─────────── */

/** 숙소·즐겨찾기·꿀팁·체크리스트 등 공유 상태. 잦은 저장을 묶어 보낸다 */
let stateTimer = null, pendingState = null, lastStateWriteAt = 0
/**
 * 서버로 올려보내는 상태의 진행 상황.
 *  pending     아직 안 올라간 변경이 있다
 *  lastWriteAt 마지막으로 올린 시각. 이보다 먼저 시작된 읽기는 내 변경 이전의 값이다.
 */
export const stateWriteInfo = () => ({ pending: pendingState !== null, lastWriteAt: lastStateWriteAt })
export function pushState(state) {
  if (!cloud.active) return
  pendingState = state
  clearTimeout(stateTimer)
  stateTimer = setTimeout(async () => {
    const body = pendingState; pendingState = null
    const { error } = await sb.from('trips')
      .update({ state: body, updated_at: new Date().toISOString() })
      .eq('id', cloud.trip.id)
    if (error) cloud.error = error.message
    else lastStateWriteAt = Date.now()
  }, 700)
}

export async function addItem(item) {
  const { data, error } = await sb.from('plan_items').insert({
    trip_id: cloud.trip.id, day: item.day, at: item.time || null,
    place_id: item.placeId || null, name: item.name || null, memo: item.memo || null,
    created_by: cloud.me.memberId,
  }).select().single()
  if (error) throw error
  return data
}
export async function updateItem(id, patch) {
  const { error } = await sb.from('plan_items').update(patch).eq('id', id)
  if (error) throw error
}
export async function removeItem(id) {
  const { error } = await sb.from('plan_items').delete().eq('id', id)
  if (error) throw error
}
export async function addComment(itemId, body) {
  const { data, error } = await sb.from('comments').insert({
    trip_id: cloud.trip.id, item_id: itemId, member_id: cloud.me.memberId,
    author: cloud.me.name, body,
  }).select().single()
  if (error) throw error
  return data
}
export async function removeComment(id) {
  const { error } = await sb.from('comments').delete().eq('id', id)
  if (error) throw error
}

/* ─────────── 실시간 ─────────── */

function subscribe() {
  unsubscribe()
  const filter = `trip_id=eq.${cloud.trip.id}`
  channel = sb.channel(`trip-${cloud.trip.id}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'plan_items', filter }, p => onChange('plan_items', p))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'comments', filter }, p => onChange('comments', p))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'members', filter }, () => onChange('members'))
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'activity', filter }, () => onChange('activity'))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'trips', filter: `id=eq.${cloud.trip.id}` }, () => onChange('state'))
    .subscribe()
}
function unsubscribe() {
  if (channel && sb) { sb.removeChannel(channel); channel = null }
}

/* ─────────── 푸시 알림 ─────────── */

/** 브라우저가 웹 푸시를 지원하는가. iOS는 홈 화면에 추가해야만 PushManager가 생긴다 */
export const pushBrowserOk = () =>
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
export const pushSupported = () => pushConfigured && pushBrowserOk()

export const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true

/** 알림을 실제로 보내주는 서버 함수가 배포돼 있는지. 없으면 켜도 알림이 오지 않는다 */
let backendReady = null
export async function pushBackendReady() {
  if (backendReady !== null) return backendReady
  if (!cloudConfigured) return (backendReady = false)
  try {
    // 헤더 없는 단순 GET 이라 프리플라이트가 붙지 않는다. 배포돼 있으면 200 {ok:true}
    const r = await fetch(`${SUPABASE_URL}/functions/v1/notify`)
    backendReady = r.status === 200
  } catch (e) {
    backendReady = false   // CORS 차단이나 네트워크 오류
  }
  return backendReady
}

/**
 * 'unconfigured' 서버 푸시 키가 아직 등록되지 않음 (브라우저 문제가 아님)
 * 'no-backend' 키는 있으나 알림 발송 함수가 아직 배포되지 않음
 * 'ios-needs-install' 아이폰인데 홈 화면 앱으로 열지 않음
 * 'unsupported' | 'denied' | 'on' | 'off'
 */
export async function pushStatus() {
  if (!pushConfigured) return 'unconfigured'
  if (!pushBrowserOk()) return isIOS() && !isStandalone() ? 'ios-needs-install' : 'unsupported'
  if (!(await pushBackendReady())) return 'no-backend'
  if (Notification.permission === 'denied') return 'denied'
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  return sub ? 'on' : 'off'
}

export async function enablePush() {
  if (!pushConfigured) throw new Error('푸시 알림 서버 설정이 아직 준비되지 않았어요.')
  if (!pushBrowserOk()) {
    throw new Error(isIOS() && !isStandalone()
      ? '아이폰은 사파리 공유 버튼 → 홈 화면에 추가 후, 그 앱에서 열어야 알림을 켤 수 있어요.'
      : '이 브라우저는 푸시 알림을 지원하지 않아요.')
  }
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('알림 권한이 필요해요. 브라우저 설정에서 허용해 주세요.')

  const reg = await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    })
  }
  const j = sub.toJSON()
  const { error } = await sb.from('push_subs').upsert({
    trip_id: cloud.trip.id, member_id: cloud.me.memberId,
    endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth,
  }, { onConflict: 'endpoint' })
  if (error) throw error
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  if (!sub) return
  const endpoint = sub.endpoint
  await sub.unsubscribe()
  if (cloud.active) await sb.from('push_subs').delete().eq('endpoint', endpoint)
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
}
