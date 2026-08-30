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

export async function createTrip(tripName, memberName) {
  await ensureAuth()
  const { data, error } = await sb.rpc('create_trip', { p_name: tripName, p_member: memberName })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  return afterJoin(row, memberName)
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

async function afterJoin(row, memberName) {
  cloud.trip = { id: row.trip_id, code: row.trip_code, name: '' }
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
  const [trip, items, comments, members] = await Promise.all([
    sb.from('trips').select('id, code, name, state').eq('id', t).single(),
    sb.from('plan_items').select('*').eq('trip_id', t).order('day').order('at'),
    sb.from('comments').select('*').eq('trip_id', t).order('created_at'),
    sb.from('members').select('id, name').eq('trip_id', t),
  ])
  if (trip.error) throw trip.error
  cloud.trip.name = trip.data.name
  cloud.members = members.data || []
  return {
    state: trip.data.state || {},
    items: items.data || [],
    comments: comments.data || [],
  }
}

/* ─────────── 쓰기 ─────────── */

/** 숙소·즐겨찾기·꿀팁·체크리스트 등 공유 상태. 잦은 저장을 묶어 보낸다 */
let stateTimer = null, pendingState = null
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
    .on('postgres_changes', { event: '*', schema: 'public', table: 'plan_items', filter }, () => onChange('items'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'comments', filter }, p => onChange('comments', p))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'members', filter }, () => onChange('members'))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'trips', filter: `id=eq.${cloud.trip.id}` }, () => onChange('state'))
    .subscribe()
}
function unsubscribe() {
  if (channel && sb) { sb.removeChannel(channel); channel = null }
}

/* ─────────── 푸시 알림 ─────────── */

export const pushSupported = () =>
  pushConfigured && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

export async function pushStatus() {
  if (!pushSupported()) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  return sub ? 'on' : 'off'
}

export async function enablePush() {
  if (!pushSupported()) throw new Error('이 브라우저는 푸시 알림을 지원하지 않아요.')
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
