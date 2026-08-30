import './styles.css'
import { CATS, AIRPORT, ICN, PRESET_FOODS, PRESET_SPOTS, HOTEL_PRESETS, TIPS, TIP_SOURCES, PRESET_CHECKS } from './data.js'
import { hav, routes, routeChips, bestSummary } from './transit.js'
import {
  cloud, initCloud, resumeTrip, createTrip, joinTrip, clearSession, fetchAll, pushState,
  addItem, updateItem, removeItem, addComment, removeComment,
  pushSupported, pushStatus, enablePush, disablePush, isStandalone, stateWriteInfo,
  listTrips, switchTrip, renameTrip, duplicateTrip,
} from './cloud.js'

/* ───────── 저장소 ───────── */
const KEY = 'fukuoka-note-v1'
const defaultState = () => ({
  hotel: null, customFoods: [], foodMeta: {}, hiddenFoods: [],
  tripStart: '', days: [{ id: 'd1', items: [] }],
  customTips: [], removedTips: [],
  checks: {}, customChecks: [], removedChecks: [],
  expenses: [],      // 공동 지출 — 여행 참여자 모두에게 공유된다
  myExpenses: [],    // 개인 지출 — 이 기기에만 남는다 (공유 대상 아님)
  rate: 860,
  rateMigrated: true,
})
let S = defaultState()
try { const raw = localStorage.getItem(KEY); if (raw) S = Object.assign(defaultState(), JSON.parse(raw)) } catch (e) { /* 프라이빗 모드 등 */ }
// 기본 환율을 950에서 860으로 바꿨다. 예전 기본값을 그대로 쓰던 사람은 한 번만 같이 옮겨준다.
if (!S.rateMigrated) {
  if (S.rate === 950) S.rate = 860
  S.rateMigrated = true
}
/* 공유 상태로 올릴 항목 — 일정(plan_items)과 코멘트는 별도 테이블이라 여기 넣지 않는다 */
const SHARED_KEYS = ['hotel', 'customFoods', 'foodMeta', 'hiddenFoods', 'customTips', 'removedTips',
  'checks', 'customChecks', 'removedChecks', 'expenses', 'rate', 'tripStart', 'dayCount']
function sharedState() {
  const o = {}
  for (const k of SHARED_KEYS) o[k] = k === 'dayCount' ? S.days.length : S[k]
  return o
}
/* 마지막으로 이 기기에서 저장한 시각. 진행 중이던 서버 응답이 이 값을 덮지 않게 하는 데 쓴다 */
let localEditAt = 0
function save() {
  localEditAt = Date.now()
  try { localStorage.setItem(KEY, JSON.stringify(S)) } catch (e) { /* ignore */ }
  if (cloud.active) pushState(sharedState())
}
const uid = () => 'x' + Math.random().toString(36).slice(2, 9)
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const gmap = name => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name + ' 福岡')}`
const $ = id => document.getElementById(id)

function allFoods() { return PRESET_FOODS.filter(f => !S.hiddenFoods.includes(f.id)).concat(S.customFoods) }
function allPlaces() {
  const places = [{ ...ICN, kind: '공항' }, { ...AIRPORT, kind: '공항' }]
  // 확정 숙소 두 곳은 일정에 바로 넣을 수 있게 장소로도 제공한다 (묵는 날이 나뉘므로)
  const stays = HOTEL_PRESETS.filter(h => h.hotelName)
  for (const h of stays) {
    places.push({ id: h.id, name: '🏨 ' + h.hotelName, area: h.area, lat: h.lat, lng: h.lng, kind: '숙소' })
  }
  // 직접 입력한 숙소가 프리셋과 다를 때만 따로 넣는다
  if (S.hotel && S.hotel.lat && !stays.some(h => h.hotelName === S.hotel.name)) {
    places.push({ id: 'hotel', name: '🏨 ' + (S.hotel.name || '우리 숙소'), lat: S.hotel.lat, lng: S.hotel.lng, kind: '숙소' })
  }
  for (const f of allFoods()) places.push({ ...f, kind: '맛집' })
  for (const s of PRESET_SPOTS) places.push({ ...s, kind: '명소' })
  return places
}
function findPlace(id) { return allPlaces().find(p => p.id === id) }

/* ───────── 테마 (기본 라이트, 토글로 다크) ───────── */
const themeBtn = $('themeBtn')
function paintTheme() {
  const dark = document.documentElement.dataset.theme === 'dark'
  themeBtn.textContent = dark ? '☀️' : '🌙'
  themeBtn.setAttribute('aria-label', dark ? '라이트 모드 켜기' : '다크 모드 켜기')
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.content = dark ? '#131A23' : '#2F4E7E'
}
themeBtn.addEventListener('click', () => {
  const dark = document.documentElement.dataset.theme === 'dark'
  if (dark) delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = 'dark'
  try { localStorage.setItem('fukuoka-theme', dark ? 'light' : 'dark') } catch (e) { /* ignore */ }
  paintTheme()
})
paintTheme()

/* ───────── AI 별점 ───────── */
const starBar = r => `<span class="stars" style="--pct:${(r / 5) * 100}%"><span class="track">★★★★★</span><span class="fill">★★★★★</span></span>`
/** 맛집 카드용 — 누르면 산출 근거가 열린다 */
const ratingBtn = p => p.rating
  ? `<button class="ratebtn" data-rev="${p.id}" aria-label="${esc(p.name)} 별점 근거 보기">${starBar(p.rating)}<b>${p.rating.toFixed(1)}</b><span class="ic">ⓘ</span></button>`
  : ''
/** 목록용 — 자리를 적게 쓰는 형태 */
const ratingMini = p => p.rating
  ? `<span class="rate-mini">${starBar(p.rating)}<b>${p.rating.toFixed(1)}</b></span>` : ''

const revDialog = $('revDialog')
function openReview(id) {
  const p = findPlace(id)
  if (!p || !p.rating) return
  $('rv-title').textContent = p.name
  $('rv-stars').innerHTML = `${starBar(p.rating)}<b>${p.rating.toFixed(1)}</b>`
  const r = p.review || {}
  $('rv-body').innerHTML =
    (r.sum ? `<p class="rvsum">${esc(r.sum)}</p>` : '') +
    (r.good ? `<div class="rvrow good"><span class="k">장점</span><span>${esc(r.good)}</span></div>` : '') +
    (r.bad ? `<div class="rvrow bad"><span class="k">단점</span><span>${esc(r.bad)}</span></div>` : '') +
    (r.note ? `<div class="rvrow"><span class="k">참고</span><span>${esc(r.note)}</span></div>` : '')
  revDialog.showModal()
}
$('rv-close').addEventListener('click', () => revDialog.close())
document.addEventListener('click', e => {
  const b = e.target.closest('button[data-rev]')
  if (b) openReview(b.dataset.rev)
})

/* ───────── 탭 ───────── */
/* 하단 탭은 3개(맛집·일정·메뉴)만 두고, 나머지는 메뉴 안에서 한 단계 들어간다 */
const MAIN_TABS = ['food', 'plan', 'exp', 'more']
let backTo = 'more' // 하위 화면에서 '뒤로' 눌렀을 때 돌아갈 곳

function switchTab(name) {
  document.querySelectorAll('section.pane').forEach(x => x.classList.toggle('on', x.id === 'pane-' + name))
  const active = MAIN_TABS.includes(name) ? name : 'more'
  document.querySelectorAll('nav.tabs button').forEach(x => x.classList.toggle('on', x.dataset.tab === active))
  window.scrollTo({ top: 0 })
}
/** 하위 화면 열기. from을 주면 '뒤로'가 그 화면으로 돌아간다 */
function openSub(name, from) {
  backTo = from || 'more'
  switchTab(name)
}
$('tabs').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return
  switchTab(b.dataset.tab)
})
$('pane-more').addEventListener('click', e => {
  const b = e.target.closest('button[data-open]'); if (!b) return
  openSub(b.dataset.open, 'more')
})
document.querySelectorAll('button[data-back]').forEach(b => {
  b.addEventListener('click', () => switchTab(backTo))
})

/* ───────── 맛집 탭 ───────── */
let foodFilter = '전체', foodSort = 'rating'
function renderFoodFilters() {
  const cats = ['전체', '⭐ 즐겨찾기', ...CATS]
  $('foodFilters').innerHTML = cats.map(c =>
    `<button class="${c === foodFilter ? 'on' : ''}" data-c="${esc(c)}">${esc(c)}</button>`).join('')
  $('foodSort').innerHTML = `<span>정렬</span>` + [['rating', '별점 높은 순'], ['dist', '숙소에서 가까운 순']]
    .map(([k, t]) => `<button class="${k === foodSort ? 'on' : ''}" data-s="${k}">${t}</button>`).join('')
}
$('foodSort').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return
  foodSort = b.dataset.s; renderFoodFilters(); renderFoods()
})
$('foodFilters').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return
  foodFilter = b.dataset.c; renderFoodFilters(); renderFoods()
})
function renderFoods() {
  const hotel = (S.hotel && S.hotel.lat) ? S.hotel : null
  let list = allFoods()
  if (foodFilter === '⭐ 즐겨찾기') list = list.filter(f => (S.foodMeta[f.id] || {}).fav)
  else if (foodFilter !== '전체') list = list.filter(f => f.cat === foodFilter)
  if (foodSort === 'rating') {
    list = list.slice().sort((a, b) => (b.rating || 0) - (a.rating || 0))
  } else if (hotel) {
    list = list.slice().sort((a, b) => {
      const da = a.lat ? hav(hotel, a) : 9e9, db = b.lat ? hav(hotel, b) : 9e9; return da - db
    })
  }
  const el = $('foodList')
  if (!list.length) { el.innerHTML = `<div class="empty">해당하는 맛집이 없어요. 아래에서 추가해 보세요.</div>`; return }
  el.innerHTML = list.map(f => {
    const m = S.foodMeta[f.id] || {}
    const r = hotel && f.lat ? routes(hotel, f) : null
    return `<div class="card ${m.visited ? 'dim' : ''}">
      <div class="rowtop">
        <span class="pname">${esc(f.name)}</span>
        <span class="cat">${esc(f.cat || '기타')}</span>
        ${f.own ? `<span class="cat mine">내 픽</span>` : ''}
        <span class="area">${esc(f.area || '')}</span>
        ${f.price ? `<span class="area">· ${esc(f.price)}</span>` : ''}
      </div>
      ${f.rating ? `<div style="margin-top:7px">${ratingBtn(f)}</div>` : ''}
      ${f.desc ? `<p class="pdesc">${esc(f.desc)}</p>` : ''}
      ${r ? `<div class="chips">${routeChips(r)}</div>`
        : (hotel ? `<div class="chips"><span class="chip">위치 미등록 — 지도 링크로 확인</span></div>`
                 : `<div class="chips"><span class="chip">숙소를 설정하면 이동시간 표시</span></div>`)}
      <div class="acts">
        <button class="fav ${m.fav ? 'on' : ''}" data-act="fav" data-id="${f.id}">${m.fav ? '⭐ 즐겨찾기' : '☆ 즐겨찾기'}</button>
        <button class="done ${m.visited ? 'on' : ''}" data-act="visited" data-id="${f.id}">${m.visited ? '✓ 다녀옴' : '다녀옴 표시'}</button>
        <a href="${gmap(f.name)}" target="_blank" rel="noopener">지도 ↗</a>
        ${f.id.startsWith('x') ? `<button data-act="edit" data-id="${f.id}">수정</button>` : ''}
        <button data-act="del" data-id="${f.id}">삭제</button>
      </div>
    </div>`
  }).join('')
}
$('foodList').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return
  const id = b.dataset.id, act = b.dataset.act
  if (act === 'fav' || act === 'visited') {
    const m = S.foodMeta[id] = S.foodMeta[id] || {}
    const k = act === 'fav' ? 'fav' : 'visited'
    m[k] = !m[k]
  } else if (act === 'del') {
    if (!confirm('이 맛집을 리스트에서 삭제할까요?')) return
    if (id.startsWith('x')) S.customFoods = S.customFoods.filter(f => f.id !== id)
    else S.hiddenFoods.push(id)
  } else if (act === 'edit') {
    const f = S.customFoods.find(x => x.id === id); if (!f) return
    openFoodEditor(f); return
  }
  save(); renderFoods(); renderHotel(); refreshPickOptions()
})
const foodEditor = $('foodEditor')
function openFoodEditor(f) {
  foodEditor.hidden = false
  $('fe-id').value = f ? f.id : ''
  $('fe-name').value = f ? f.name : ''
  $('fe-cat').value = f ? f.cat : CATS[CATS.length - 1]
  $('fe-area').value = f ? f.area || '' : ''
  $('fe-price').value = f ? f.price || '' : ''
  $('fe-lat').value = f && f.lat != null ? f.lat : ''
  $('fe-lng').value = f && f.lng != null ? f.lng : ''
  $('fe-desc').value = f ? f.desc || '' : ''
  foodEditor.scrollIntoView({ behavior: 'smooth', block: 'center' })
}
$('addFoodBtn').addEventListener('click', () => openFoodEditor(null))
$('fe-cancel').addEventListener('click', () => { foodEditor.hidden = true })
foodEditor.addEventListener('submit', e => {
  e.preventDefault()
  const id = $('fe-id').value
  const lat = parseFloat($('fe-lat').value), lng = parseFloat($('fe-lng').value)
  const f = {
    id: id || uid(),
    name: $('fe-name').value.trim(),
    cat: $('fe-cat').value,
    area: $('fe-area').value.trim(),
    price: $('fe-price').value.trim(),
    desc: $('fe-desc').value.trim(),
    lat: isFinite(lat) ? lat : null, lng: isFinite(lng) ? lng : null,
  }
  if (!f.name) return
  if (id) { const i = S.customFoods.findIndex(x => x.id === id); if (i >= 0) S.customFoods[i] = f }
  else S.customFoods.push(f)
  foodEditor.hidden = true; save(); renderFoods(); renderHotel(); refreshPickOptions()
})

/* ───────── 숙소·이동 탭 ───────── */
/* 폼에 저장하지 않은 변경이 있는지. 동기화가 이 값을 덮어쓰지 못하게 한다 */
let hotelFormDirty = false
$('hotelForm').addEventListener('input', () => { hotelFormDirty = true })
$('hotelForm').addEventListener('change', () => { hotelFormDirty = true })

function renderHotelForm() {
  let html = `<option value="">— 숙소 선택 —</option>`
  let group = null
  HOTEL_PRESETS.forEach((p, i) => {
    if (p.group !== group) {
      if (group !== null) html += `</optgroup>`
      html += `<optgroup label="${esc(p.group)}">`
      group = p.group
    }
    html += `<option value="${i}">${esc(p.name)}</option>`
  })
  if (group !== null) html += `</optgroup>`
  $('ht-preset').innerHTML = html
  // 사용자가 고쳐둔 값이 있으면 건드리지 않는다.
  // 동기화가 끼어들면 고르던 숙소가 저장 전에 예전 값으로 되돌아가, 저장을 눌러도
  // 예전 숙소가 다시 저장되던 문제가 있었다.
  if (S.hotel && !hotelFormDirty) {
    $('ht-name').value = S.hotel.name || ''
    $('ht-lat').value = S.hotel.lat ?? ''
    $('ht-lng').value = S.hotel.lng ?? ''
    const i = HOTEL_PRESETS.findIndex(p => p.hotelName && p.hotelName === S.hotel.name)
    if (i >= 0) $('ht-preset').value = String(i)
  }
  showPresetNote()
}
function showPresetNote() {
  const p = HOTEL_PRESETS[$('ht-preset').value]
  $('ht-note').textContent = p && p.note ? p.note : ''
}
$('ht-preset').addEventListener('change', e => {
  const p = HOTEL_PRESETS[e.target.value]
  showPresetNote()
  if (!p) return
  $('ht-lat').value = p.lat
  $('ht-lng').value = p.lng
  if (p.hotelName) $('ht-name').value = p.hotelName
})
$('hotelForm').addEventListener('submit', e => {
  e.preventDefault()
  const lat = parseFloat($('ht-lat').value), lng = parseFloat($('ht-lng').value)
  if (!isFinite(lat) || !isFinite(lng)) { alert('위치(지역 선택 또는 좌표)를 입력해 주세요.'); return }
  S.hotel = { name: $('ht-name').value.trim(), lat, lng }
  hotelFormDirty = false
  save(); renderHotel(); renderFoods(); refreshPickOptions(); renderDays()
  document.activeElement?.blur?.()
  toast(`🏨 ${S.hotel.name || '숙소'} 저장했어요`)
})
function renderHotel() {
  const el = $('hotelResult')
  if (!S.hotel || !S.hotel.lat) { el.innerHTML = `<div class="empty">숙소를 저장하면 공항·맛집·명소까지 이동시간이 여기 표시됩니다.</div>`; return }
  const h = S.hotel
  const ra = routes(AIRPORT, h)
  let html = `<div class="hero">
    <div class="t">🏨 ${esc(h.name || '우리 숙소')}</div>
    <div class="d">후쿠오카공항(국제선)에서</div>
    <div class="big">${ra && ra.metro ? `🚇 약 ${ra.metro.min}분` : (ra ? `🚕 약 ${ra.taxi.min}분` : '—')}</div>
    <div class="d">${ra && ra.metro ? `국제선→국내선 무료셔틀 약 8분 포함 · ${ra.metro.from}→${ra.metro.to} 하차 후 도보 ${ra.metro.wb}분` : ''}
    ${ra ? ` · 🚕 택시 약 ${ra.taxi.min}분 (약 ¥${ra.taxi.fare.toLocaleString()})` : ''}</div>
  </div>`
  const rows = [...allFoods().filter(f => f.lat).map(f => ({ p: f, kind: '맛집' })), ...PRESET_SPOTS.map(s => ({ p: s, kind: '명소' }))]
    .map(x => ({ ...x, r: routes(h, x.p) }))
    .sort((a, b) => a.r.dKm - b.r.dKm)
  html += `<h3>숙소에서 가까운 순</h3>` + rows.map(x => `
    <div class="card">
      <div class="rowtop"><span class="pname" style="font-size:14.5px">${esc(x.p.name)}</span>
        <span class="cat plain">${x.kind}</span>${ratingMini(x.p)}</div>
      <div class="chips">${routeChips(x.r)}</div>
    </div>`).join('')
  el.innerHTML = html
}

/* ───────── 일정 탭 ───────── */
let curDay = 0
function dayLabel(i) {
  let s = `${i + 1}일차`
  if (S.tripStart) {
    const d = new Date(S.tripStart + 'T00:00:00'); d.setDate(d.getDate() + i)
    s += ` · ${d.getMonth() + 1}/${d.getDate()}(${'일월화수목금토'[d.getDay()]})`
  }
  return s
}
function renderDays() {
  if (!S.days || !S.days.length) S.days = [{ id: 'd1', items: [] }]
  $('tripStart').value = S.tripStart || ''
  if (curDay >= S.days.length) curDay = S.days.length - 1
  $('dayTabs').innerHTML = S.days.map((d, i) =>
    `<button class="${i === curDay ? 'on' : ''}" data-i="${i}">${dayLabel(i)}</button>`).join('')
  const day = S.days[curDay]
  const items = day.items.slice().sort((a, b) => (a.time || '').localeCompare(b.time || ''))
  day.items = items
  let html = `<div class="acts" style="margin:0 0 12px">
    <button class="btn small" id="addItemBtn">+ 장소 추가</button>
    ${S.days.length > 1 ? `<button class="btn small danger" id="delDayBtn">이 일차 삭제</button>` : ''}
  </div>`
  if (!items.length) {
    html += `<div class="empty">아직 일정이 없어요. '+ 장소 추가'로 맛집·명소를 시간대에 넣어보세요.</div>`
  } else {
    html += `<div class="route">`
    let totalMove = 0
    items.forEach((it, idx) => {
      const p = it.placeId ? findPlace(it.placeId) : null
      const name = p ? p.name : it.name
      html += `<div class="stop">
        <div class="tcol">${esc(it.time || '—')}</div><div class="dot"></div>
        <div class="body"><div class="itemcard">
          <span class="nm">${esc(name || '(장소)')}</span>
          ${p && p.kind ? ` <span class="cat plain">${p.kind}</span>` : ''}
          ${it.memo ? `<div class="memo">${esc(it.memo)}</div>` : ''}
          <div class="mini">
            <button data-mv="-1" data-id="${it.id}">↑</button>
            <button data-mv="1" data-id="${it.id}">↓</button>
            <button data-rm="${it.id}">삭제</button>
            ${name ? `<a href="${gmap(name.replace(/^🏨 /, ''))}" target="_blank" rel="noopener">지도↗</a>` : ''}
            ${cloud.active ? `<button class="cmbtn ${openComments.has(it.id) ? 'on' : ''}" data-cm="${it.id}">💬 ${(cloudComments[it.id] || []).length || ''}</button>` : ''}
          </div>
          ${cloud.active && openComments.has(it.id) ? commentPanel(it.id) : ''}
        </div></div>
      </div>`
      const next = items[idx + 1]
      if (next) {
        const np = next.placeId ? findPlace(next.placeId) : null
        const r = (p && np) ? routes(p, np) : null
        const sum = bestSummary(r)
        if (sum) { html += `<div class="leg">이동 <b>${sum}</b></div>`; if (r && !r.far) totalMove += (r.walk <= 15 || !r.metro) ? r.walk : r.metro.min }
        else html += `<div class="leg">이동시간 계산 불가 (좌표 없는 장소)</div>`
      }
    })
    html += `</div><p class="hint" style="margin-top:12px">이 날 이동시간 합계: 약 <b>${totalMove}분</b> (광역 이동 제외 추정치)</p>`
  }
  $('dayView').innerHTML = html
  renderDday()
  renderPlanHotel()
  renderNearby()
  renderActivity()
}
$('dayTabs').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return; curDay = +b.dataset.i; renderDays()
})
$('addDayBtn').addEventListener('click', () => {
  S.days.push({ id: uid(), items: [] }); curDay = S.days.length - 1; save(); renderDays()
})
$('tripStart').addEventListener('change', e => { S.tripStart = e.target.value; save(); renderDays() })
$('dayView').addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return
  if (b.id === 'addItemBtn') { openPicker(); return }
  if (b.id === 'delDayBtn') {
    if (!confirm('이 일차와 일정을 삭제할까요?')) return
    const removed = curDay
    if (cloud.active) {
      await Promise.all(S.days[removed].items.map(i => removeItem(i.id)))
      // 뒤 일차를 한 칸씩 당긴다
      for (let k = removed + 1; k < S.days.length; k++)
        await Promise.all(S.days[k].items.map(i => updateItem(i.id, { day: k - 1 })))
    }
    S.days.splice(removed, 1); curDay = Math.max(0, removed - 1); save(); renderDays(); return
  }
  const day = S.days[curDay]
  if (b.dataset.rm) {
    const id = b.dataset.rm
    day.items = day.items.filter(x => x.id !== id)
    openComments.delete(id)
    save(); renderDays()
    if (cloud.active) removeItem(id).catch(() => refreshCloud())
    return
  }
  if (b.dataset.mv) {
    const i = day.items.findIndex(x => x.id === b.dataset.id), j = i + (+b.dataset.mv)
    if (i < 0 || j < 0 || j >= day.items.length) return
    const a = day.items[i], c = day.items[j]
    const t = a.time; a.time = c.time; c.time = t
    ;[day.items[i], day.items[j]] = [c, a]
    save(); renderDays()
    if (cloud.active) {
      Promise.all([updateItem(a.id, { at: a.time || null }), updateItem(c.id, { at: c.time || null })])
        .catch(() => refreshCloud())
    }
    return
  }
  if (b.dataset.cm) {
    const id = b.dataset.cm
    openComments.has(id) ? openComments.delete(id) : openComments.add(id)
    renderDays()
  }
})

/* 코멘트 등록 / 삭제 */
$('dayView').addEventListener('submit', async e => {
  const f = e.target.closest('form[data-cmadd]'); if (!f) return
  e.preventDefault()
  const input = f.elements.body
  const body = input.value.trim()
  if (!body) return
  input.value = ''
  try { await addComment(f.dataset.cmadd, body); await refreshCloud() }
  catch (err) { alert(err.message || String(err)); input.value = body }
})
$('dayView').addEventListener('click', async e => {
  const b = e.target.closest('button[data-cmdel]'); if (!b) return
  if (!confirm('코멘트를 삭제할까요?')) return
  try { await removeComment(b.dataset.cmdel); await refreshCloud() }
  catch (err) { alert(err.message || String(err)) }
})
const pickDialog = $('pickDialog')
function refreshPickOptions() {
  $('pk-place').innerHTML = allPlaces().map(p => `<option value="${p.id}">[${p.kind}] ${esc(p.name)}</option>`).join('')
    + `<option value="__custom">✏️ 직접 입력…</option>`
}
$('pk-place').addEventListener('change', e => {
  $('pk-customWrap').hidden = e.target.value !== '__custom'
})
function openPicker(placeId, time) {
  refreshPickOptions()
  $('pk-memo').value = ''
  $('pk-customWrap').hidden = true
  if (placeId) $('pk-place').value = placeId
  $('pk-time').value = time || suggestNextTime()
  renderQuickPicks(placeId)
  pickDialog.showModal()
}
/* 다음 목적지 후보 3개 — 기준점에서 가까운 순 */
function renderQuickPicks(selectedId) {
  const { base, rows } = nearestCandidates(3)
  const wrap = $('pk-quickWrap')
  if (!rows.length) { wrap.hidden = true; return }
  wrap.hidden = false
  $('pk-quickLabel').textContent = `빠른 선택 · ${base.short} 기준 가까운 순`
  $('pk-quick').innerHTML = rows.map(x => {
    const walking = x.r.walk <= 15 || !x.r.metro
    const mins = walking ? x.r.walk : x.r.metro.min
    return `<button type="button" class="${x.p.id === selectedId ? 'on' : ''}" data-q="${x.p.id}" data-mins="${mins}">
      <span class="qn">${esc(x.p.name)}</span><span class="qt">${walking ? '🚶' : '🚇'} ${mins}분</span></button>`
  }).join('')
}
$('pk-quick').addEventListener('click', e => {
  const b = e.target.closest('button[data-q]'); if (!b) return
  $('pk-place').value = b.dataset.q
  $('pk-customWrap').hidden = true
  $('pk-time').value = suggestNextTime(+b.dataset.mins)
  $('pk-quick').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b))
})
/* 마지막 일정 + 체류 60분 + 이동시간 → 다음 일정 시각 제안 */
function suggestNextTime(travelMin) {
  const items = currentDayItems()
  const last = items[items.length - 1]
  if (!last || !last.time) return '10:00'
  const [h, m] = last.time.split(':').map(Number)
  if (!isFinite(h) || !isFinite(m)) return '10:00'
  const t = Math.min(23 * 60 + 55, Math.round((h * 60 + m + 60 + (travelMin ?? 20)) / 5) * 5)
  return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0')
}
$('pk-close').addEventListener('click', () => pickDialog.close())
$('pk-save').addEventListener('click', async () => {
  const v = $('pk-place').value
  const item = { id: uid(), time: $('pk-time').value, memo: $('pk-memo').value.trim() }
  if (v === '__custom') {
    const nm = $('pk-custom').value.trim()
    if (!nm) return; item.name = nm
  } else item.placeId = v
  pickDialog.close()
  if (cloud.active) {
    try {
      const row = await addItem({ day: curDay, ...item })
      S.days[curDay].items.push(toLocalItem(row))
      save(); renderDays()
    } catch (err) { alert(err.message || String(err)); refreshCloud() }
    return
  }
  S.days[curDay].items.push(item)
  save(); renderDays()
})
function renderDday() {
  const el = $('dday')
  if (!S.tripStart) { el.hidden = true; return }
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const start = new Date(S.tripStart + 'T00:00:00')
  const diff = Math.round((start - today) / 86400000)
  el.hidden = false
  el.textContent = diff > 0 ? `D-${diff}` : (diff === 0 ? 'D-DAY ✈️' : `여행 ${1 - diff}일차`)
}

/* ───────── 플래너: 숙소 요약 + 동선 기준 추천 장소 ───────── */
function currentDayItems() { return (S.days[curDay] || { items: [] }).items }

function renderPlanHotel() {
  const el = $('planHotel')
  if (!S.hotel || !S.hotel.lat) {
    el.innerHTML = `<div class="card hotelbar">
      <div class="info"><div class="nm">🏨 숙소 미설정</div>
        <div class="meta">숙소를 정하면 이동시간이 계산돼요</div></div>
      <button class="btn small" data-go="move">설정</button>
    </div>`
    return
  }
  const ra = routes(AIRPORT, S.hotel)
  const air = ra && ra.metro ? `🚇 약 ${ra.metro.min}분` : (ra ? `🚕 약 ${ra.taxi.min}분` : '—')
  el.innerHTML = `<div class="card hotelbar">
    <div class="info"><div class="nm">🏨 ${esc(S.hotel.name || '우리 숙소')}</div>
      <div class="meta">후쿠오카공항에서 ${air}</div></div>
    <button class="btn small ghost" data-go="move">변경</button>
  </div>`
}
$('planHotel').addEventListener('click', e => {
  if (e.target.closest('button[data-go="move"]')) openSub('move', 'plan')
})

/* 추천 기준점: 그 날 마지막 일정 → 없으면 숙소 → 없으면 공항 */
function nearbyBase() {
  const items = currentDayItems()
  for (let i = items.length - 1; i >= 0; i--) {
    const p = items[i].placeId ? findPlace(items[i].placeId) : null
    if (p && p.lat != null) return { p, short: p.name, label: `${p.name} (${items[i].time || '마지막 일정'})`, kind: 'last' }
  }
  if (S.hotel && S.hotel.lat) {
    const nm = `🏨 ${S.hotel.name || '우리 숙소'}`
    return { p: { id: 'hotel', ...S.hotel }, short: nm, label: nm, kind: 'hotel' }
  }
  return { p: AIRPORT, short: '후쿠오카공항', label: AIRPORT.name, kind: 'airport' }
}

/* 기준점에서 가까운 후보 (광역 이동 제외) */
function nearestCandidates(n) {
  const base = nearbyBase()
  const used = new Set(currentDayItems().map(i => i.placeId).filter(Boolean))
  const pool = [...allFoods().map(f => ({ ...f, kind: '맛집' })), ...PRESET_SPOTS.map(s => ({ ...s, kind: '명소' }))]
  const rows = pool
    .filter(p => p.lat != null && !used.has(p.id) && p.id !== base.p.id)
    .map(p => ({ p, r: routes(base.p, p) }))
    .filter(x => x.r && !x.r.far && !x.r.air)
    .sort((a, b) => a.r.dKm - b.r.dKm)
    .slice(0, n)
  return { base, rows }
}

let candFilter = '맛집', candLimit = 8
function renderNearby() {
  const base = nearbyBase()
  const used = new Set(currentDayItems().map(i => i.placeId).filter(Boolean))
  const foods = allFoods().map(f => ({ ...f, kind: '맛집' }))
  const spots = PRESET_SPOTS.map(s => ({ ...s, kind: '명소' }))
  let pool
  if (candFilter === '맛집') pool = foods
  else if (candFilter === '명소') pool = spots
  else if (candFilter === '⭐') pool = foods.filter(f => (S.foodMeta[f.id] || {}).fav)
  else pool = [...foods, ...spots]

  const rows = pool
    .filter(p => p.lat != null && !used.has(p.id) && p.id !== base.p.id)
    .map(p => ({ p, r: routes(base.p, p) }))
    .filter(x => x.r)
    .sort((a, b) => a.r.dKm - b.r.dKm)

  const filters = [['맛집', '맛집'], ['명소', '명소'], ['⭐', '⭐ 즐겨찾기'], ['전체', '전체']]
  let html = `<div class="nearby">
    <h3 style="margin-top:0">이 동선에서 가까운 곳</h3>
    <div class="basebar">기준: <b>${esc(base.label)}</b>${base.kind === 'last' ? ' 다음 목적지' : ''}</div>
    <div class="filters" id="candFilters">${filters.map(([k, t]) =>
      `<button class="${k === candFilter ? 'on' : ''}" data-c="${k}">${esc(t)}</button>`).join('')}</div>`

  if (!rows.length) {
    html += `<div class="empty">추가할 만한 장소가 없어요. 필터를 바꾸거나 맛집 탭에서 새로 추가해 보세요.</div>`
  } else {
    const shown = rows.slice(0, candLimit)
    html += `<div class="candlist">` + shown.map(x => {
      const mins = x.r.far ? null : (x.r.walk <= 15 || !x.r.metro ? x.r.walk : x.r.metro.min)
      const how = x.r.far ? '광역' : (x.r.walk <= 15 || !x.r.metro ? '🚶 도보' : '🚇 지하철')
      return `<div class="cand">
        <div class="info">
          <div class="nm">${esc(x.p.name)}</div>
          <div class="meta">${ratingMini(x.p)}${x.p.rating ? ' · ' : ''}${esc(x.p.kind)}${x.p.cat ? ' · ' + esc(x.p.cat) : ''}${x.p.area ? ' · ' + esc(x.p.area) : ''}</div>
        </div>
        <div class="t">${mins != null ? `${how}<br>${mins}분` : `${how}<br>${x.r.dKm.toFixed(1)}km`}</div>
        <button class="add" data-add="${x.p.id}" data-mins="${mins ?? 45}" aria-label="${esc(x.p.name)} 일정에 추가">+</button>
      </div>`
    }).join('') + `</div>`
    if (rows.length > candLimit)
      html += `<div class="acts" style="justify-content:center"><button class="btn small ghost" id="candMore">더 보기 (${rows.length - candLimit}곳)</button></div>`
  }
  html += `</div>`
  $('nearbyWrap').innerHTML = html
}
$('nearbyWrap').addEventListener('click', e => {
  const f = e.target.closest('#candFilters button')
  if (f) { candFilter = f.dataset.c; candLimit = 8; renderNearby(); return }
  if (e.target.closest('#candMore')) { candLimit += 12; renderNearby(); return }
  const a = e.target.closest('button[data-add]')
  if (a) openPicker(a.dataset.add, suggestNextTime(+a.dataset.mins))
})

/* ───────── 함께 쓰기 (Supabase) ───────── */
let cloudComments = {}
const openComments = new Set()
let refreshTimer = null

const toLocalItem = r => ({
  id: r.id, time: r.at || '', placeId: r.place_id || undefined,
  name: r.name || undefined, memo: r.memo || '',
})

async function refreshCloud() {
  if (!cloud.active) return
  const startedAt = Date.now()
  try {
    const data = await fetchAll()
    if (!data) return
    // 서버의 옛 값이 방금 저장한 내 값을 덮어쓰지 않게 한다. (저장이 한 번에 안 먹던 원인)
    // 셋 중 하나라도 해당하면 이 응답은 내 변경보다 오래된 것이다.
    //  - 아직 못 올린 변경이 남아 있다
    //  - 요청이 오가는 사이에 내가 저장했다
    //  - 내 변경이 서버에 기록되기 전에 시작된 읽기다
    const w = stateWriteInfo()
    const mineIsNewer = w.pending || localEditAt > startedAt || startedAt < w.lastWriteAt
    if (!mineIsNewer) {
      for (const k of SHARED_KEYS) {
        if (k === 'dayCount') continue
        if (data.state[k] !== undefined) S[k] = data.state[k]
      }
    }
    const dayCount = Math.max(1, data.state.dayCount || 1, ...data.items.map(i => i.day + 1))
    S.days = Array.from({ length: dayCount }, (_, d) => ({
      id: 'd' + d, items: data.items.filter(i => i.day === d).map(toLocalItem),
    }))
    cloudComments = {}
    for (const c of data.comments) (cloudComments[c.item_id] ||= []).push(c)
    cloudActivity = data.activity || []
    try { localStorage.setItem(KEY, JSON.stringify(S)) } catch (e) { /* ignore */ }
    renderAll()
  } catch (e) {
    cloud.error = String(e.message || e)
    renderShare()
  }
}
/* 앱을 열어둔 동안 들어오는 변경은 화면 위에 바로 띄운다.
   (앱이 꺼져 있을 때의 푸시는 서버 함수가 따로 처리한다) */
let toastTimer = null
function toast(msg) {
  let el = $('toast')
  if (!el) {
    el = document.createElement('div')
    el.id = 'toast'
    el.setAttribute('role', 'status')
    document.body.appendChild(el)
  }
  el.textContent = msg
  el.classList.add('on')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el.classList.remove('on'), 4500)
}

function onCloudChange(kind, payload) {
  if (payload?.eventType === 'INSERT') {
    const row = payload.new
    if (kind === 'comments' && row && row.member_id !== cloud.me?.memberId) {
      toast(`💬 ${row.author}: ${row.body}`)
    } else if (kind === 'plan_items' && row && row.created_by !== cloud.me?.memberId) {
      toast('🗓️ 친구가 일정을 바꿨어요')
    }
  }
  clearTimeout(refreshTimer)
  refreshTimer = setTimeout(refreshCloud, 250)
}

/* 누가 무엇을 바꿨는지 최근 내역 */
let cloudActivity = []
let activityAll = false
const ACT_LABEL = {
  item_add: ['＋', '일정 추가'],
  item_edit: ['✎', '일정 수정'],
  item_del: ['−', '일정 삭제'],
  comment: ['💬', '코멘트'],
}
function renderActivity() {
  const el = $('activityWrap')
  if (!cloud.active || !cloudActivity.length) { el.innerHTML = ''; return }
  const rows = activityAll ? cloudActivity : cloudActivity.slice(0, 5)
  el.innerHTML = `<div class="nearby">
    <h3 style="margin-top:0">최근 변경</h3>
    <div class="card actlist">${rows.map(a => {
      const [icon, what] = ACT_LABEL[a.action] || ['·', a.action]
      const place = a.place_id ? (findPlace(a.place_id)?.name || a.label || '') : (a.label || '')
      return `<div class="act">
        <span class="ai">${icon}</span>
        <span class="ab"><b>${esc(a.actor)}</b>님이 ${what}
          <span class="ap">${esc([a.at, place].filter(Boolean).join(' '))}</span></span>
        <span class="aw">${fmtWhen(a.created_at)}</span>
      </div>`
    }).join('')}</div>
    ${cloudActivity.length > 5 ? `<div class="acts" style="justify-content:center">
      <button class="btn small ghost" id="actMore">${activityAll ? '접기' : `더 보기 (${cloudActivity.length - 5}건)`}</button></div>` : ''}
  </div>`
}
$('activityWrap').addEventListener('click', e => {
  if (!e.target.closest('#actMore')) return
  activityAll = !activityAll
  renderActivity()
})

function commentPanel(itemId) {
  const list = cloudComments[itemId] || []
  const mine = cloud.me?.memberId
  return `<div class="cmpanel">
    ${list.length ? list.map(c => `<div class="cm">
      <div class="cmhead"><b>${esc(c.author)}</b><span>${fmtWhen(c.created_at)}</span>
        ${c.member_id === mine ? `<button class="cmdel" data-cmdel="${c.id}" aria-label="코멘트 삭제">✕</button>` : ''}</div>
      <div class="cmbody">${esc(c.body)}</div>
    </div>`).join('') : `<div class="cmempty">아직 코멘트가 없어요.</div>`}
    <form class="cmform" data-cmadd="${itemId}">
      <input name="body" placeholder="코멘트 남기기" maxlength="200" autocomplete="off">
      <button class="btn small" type="submit">등록</button>
    </form>
  </div>`
}
function fmtWhen(iso) {
  const d = new Date(iso), now = new Date()
  const diff = Math.round((now - d) / 60000)
  if (diff < 1) return '방금'
  if (diff < 60) return `${diff}분 전`
  if (diff < 1440) return `${Math.round(diff / 60)}시간 전`
  return `${d.getMonth() + 1}/${d.getDate()}`
}

/* 메뉴 탭의 '함께 쓰기' 카드 */
async function renderShare() {
  const el = $('shareBox')
  if (!cloud.configured) {
    el.innerHTML = `<div class="card"><div class="rowtop"><span class="pname">👥 함께 쓰기</span></div>
      <p class="pdesc">공유 서버가 아직 연결되지 않았어요. 지금은 이 기기에만 저장됩니다.</p></div>`
    return
  }
  if (!cloud.active) {
    el.innerHTML = `<div class="card">
      <div class="rowtop"><span class="pname">👥 함께 쓰기</span></div>
      <p class="pdesc">여행을 만들고 초대코드를 공유하면 친구들과 같은 일정을 보고, 일정마다 코멘트를 남길 수 있어요.</p>
      <div class="acts">
        <button class="btn small" data-share="create">여행 만들기</button>
        <button class="btn small ghost" data-share="join">초대코드로 참가</button>
      </div></div>`
    return
  }
  const st = await pushStatus()
  const names = cloud.members.map(m => m.name).join(', ')
  const pushUI = {
    unconfigured: `<span class="chip">🔔 알림 준비 중 — 서버 설정이 끝나면 켤 수 있어요</span>`,
    'no-backend': `<span class="chip">🔔 알림 서버 배포 전 — 지금은 앱을 열어둔 동안만 알려드려요</span>`,
    'ios-needs-install': `<span class="chip">🔔 사파리 공유 → 홈 화면에 추가 후 그 앱에서 켜주세요</span>`,
    unsupported: `<span class="chip">이 브라우저는 알림을 지원하지 않아요</span>`,
    denied: `<span class="chip">알림 차단됨 — 브라우저 설정에서 허용</span>`,
    on: `<button class="btn small ghost" data-share="pushoff">🔔 알림 끄기</button>`,
    off: `<button class="btn small" data-share="pushon">🔔 코멘트 알림 받기</button>`,
  }[st]
  el.innerHTML = `<div class="card">
    <div class="rowtop"><span class="pname">👥 ${esc(cloud.trip.name || '우리 여행')}</span>
      <span class="cat mine">보는 중</span>
      <button class="btn small ghost" data-share="rename" style="margin-left:auto">이름 변경</button></div>
    <div class="acts" style="margin-top:8px">
      <button class="btn small ghost" data-share="trips">🧳 여행 목록 (${myTrips.length}개)</button>
    </div>
    <div class="codebox">초대코드 <b>${esc(cloud.trip.code)}</b>
      <button class="btn small ghost" data-share="copycode">코드 복사</button></div>
    <div class="acts" style="margin-top:8px">
      <button class="btn small" data-share="invite">🔗 초대링크 보내기</button>
    </div>
    <p class="pdesc">참여자 ${cloud.members.length}명 · ${esc(names)}<br>나: <b>${esc(cloud.me.name)}</b></p>
    ${cloud.error ? `<p class="pdesc" style="color:var(--bad)">${esc(cloud.error)}</p>` : ''}
    <div class="acts">
      ${pushUI}
      <button class="btn small danger" data-share="leave">나가기</button>
    </div>
    <p class="hint">앱을 열어둔 동안에는 친구가 코멘트를 남기면 화면에 바로 뜹니다.</p>
  </div>`
}

$('shareBox').addEventListener('click', async e => {
  const b = e.target.closest('button[data-share]'); if (!b) return
  const act = b.dataset.share
  try {
    if (act === 'create' || act === 'join') { openJoin(act); return }
    if (act === 'trips') { openTripDialog(); return }
    if (act === 'rename') {
      const input = prompt('여행 이름', cloud.trip.name || '')
      if (!input || !input.trim()) return
      const name = uniqueTripName(input, cloud.trip.id)
      if (name !== input.trim()) toast(`같은 이름이 있어 '${name}' 로 저장했어요`)
      await renameTrip(name)
      await refreshTripList()
      renderTripBar()
      renderShare()
      return
    }
    if (act === 'copycode') {
      await navigator.clipboard.writeText(cloud.trip.code)
      b.textContent = '복사됨 ✓'; return
    }
    if (act === 'invite') {
      const url = inviteUrl()
      const text = `${cloud.trip.name || '후쿠오카 여행'} 일정 같이 짜자!\n링크 열면 바로 참가돼 (초대코드 ${cloud.trip.code})`
      // 폰에서는 카톡 등으로 바로 보낼 수 있는 공유 시트를 띄운다
      if (navigator.share) {
        try { await navigator.share({ title: '후쿠오카 수첩', text, url }); return } catch (err) {
          if (err?.name === 'AbortError') return   // 사용자가 취소
        }
      }
      await navigator.clipboard.writeText(`${text}\n${url}`)
      b.textContent = '링크 복사됨 ✓'
      toast('초대링크를 복사했어요. 카톡에 붙여넣기 하세요.')
      return
    }
    if (act === 'pushon') { b.disabled = true; await enablePush() }
    if (act === 'pushoff') { b.disabled = true; await disablePush() }
    if (act === 'leave') {
      if (!confirm('이 여행에서 나갈까요? 기기에 남은 데이터는 그대로예요.')) return
      clearSession()
    }
  } catch (err) {
    alert(err.message || String(err))
  }
  renderShare()
})

/* ───────── 여행 여러 개 관리 ───────── */
/* 친구들과 함께 쓰는 일정과, 나 혼자 움직이는 일정을 따로 두고 오갈 수 있게 한다 */
let myTrips = []
const tripDialog = $('tripDialog')

/** 목록에서 헷갈리지 않게, 같은 이름이 있으면 뒤에 번호를 붙인다 */
function uniqueTripName(base, exceptTripId) {
  const want = (base || '').trim() || '내 여행'
  const taken = new Set(
    myTrips.filter(t => t.tripId !== exceptTripId).map(t => (t.name || '').trim()),
  )
  if (!taken.has(want)) return want
  for (let n = 2; n < 999; n++) {
    const cand = `${want} (${n})`
    if (!taken.has(cand)) return cand
  }
  return `${want} (${myTrips.length + 1})`
}

async function refreshTripList() {
  if (!cloud.active) { myTrips = []; renderTripBar(); return }
  try { myTrips = await listTrips() } catch (e) { myTrips = [] }
  renderTripBar()
}
function renderTripBar() {
  const bar = $('tripBar')
  if (!cloud.active) { bar.hidden = true; return }
  bar.hidden = false
  const name = cloud.trip.name || '우리 여행'
  bar.innerHTML = `<span class="tn">${esc(name)}</span>
    ${myTrips.length > 1 ? `<span class="tc">${myTrips.length}개 중</span>` : ''}
    <span class="tx">바꾸기 ▾</span>`
}
function renderTripList() {
  $('tripList').innerHTML = myTrips.length
    ? myTrips.map(t => `<button class="triprow ${t.tripId === cloud.trip?.id ? 'on' : ''}" data-trip="${t.tripId}">
        <span class="ti">
          <b>${esc(t.name || '이름 없는 여행')}</b>
          <small>초대코드 ${esc(t.code)} · 내 이름 ${esc(t.myName)}</small>
        </span>
        <span class="tk">${t.tripId === cloud.trip?.id ? '보는 중' : '열기'}</span>
      </button>`).join('')
    : `<div class="empty">아직 여행이 없어요.</div>`
}
function openTripDialog() {
  renderTripList()
  tripDialog.showModal()
  refreshTripList().then(renderTripList)
}
$('tripBar').addEventListener('click', openTripDialog)
$('tripClose').addEventListener('click', () => tripDialog.close())
$('tripDialog').addEventListener('click', async e => {
  if (e.target.closest('[data-trip-new]')) { tripDialog.close(); openJoin('create'); return }
  if (e.target.closest('[data-trip-join]')) { tripDialog.close(); openJoin('join'); return }
  const copyBtn = e.target.closest('[data-trip-copy]')
  if (copyBtn) {
    if (!cloud.active) return
    const base = cloud.trip.name || '여행'
    const now = new Date()
    const stamp = `${now.getMonth() + 1}/${now.getDate()}`
    const input = prompt('복사본 이름', `${base} 백업 ${stamp}`)
    if (!input || !input.trim()) return
    const name = uniqueTripName(input)
    copyBtn.disabled = true
    copyBtn.textContent = '복사 중…'
    try {
      await duplicateTrip(name)
      await refreshTripList()
      renderTripList()
      toast(`'${name}' 로 복사했어요`)
    } catch (err) {
      alert('복사에 실패했어요: ' + (err.message || err))
    } finally {
      copyBtn.disabled = false
      copyBtn.textContent = '📋 지금 여행 복사'
    }
    return
  }
  const b = e.target.closest('button[data-trip]'); if (!b) return
  const t = myTrips.find(x => x.tripId === b.dataset.trip)
  if (!t || t.tripId === cloud.trip?.id) { tripDialog.close(); return }
  tripDialog.close()
  switchTrip(t)
  resetSharedLocal()
  await refreshCloud()
  await renderShare()
  renderTripBar()
  switchTab('plan')
  toast(`${t.name || '여행'} 일정으로 바꿨어요`)
})
/* 여행을 바꾸면 이전 여행의 값이 남지 않게 공유 항목을 초기화한다 */
function resetSharedLocal() {
  const d = defaultState()
  for (const k of SHARED_KEYS) if (k !== 'dayCount') S[k] = d[k]
  S.days = [{ id: 'd1', items: [] }]
  curDay = 0
  cloudComments = {}
  cloudActivity = []
  openComments.clear()
}

/* 초대링크: ?join=코드 로 열면 코드가 채워진 참가 화면이 바로 뜬다 */
const inviteUrl = () =>
  `${location.origin}${location.pathname}?join=${encodeURIComponent(cloud.trip.code)}`

function pendingInviteCode() {
  const m = new URLSearchParams(location.search).get('join')
  return m ? m.trim().toUpperCase().slice(0, 8) : ''
}
function clearInviteParam() {
  const u = new URL(location.href)
  u.searchParams.delete('join')
  history.replaceState(null, '', u.pathname + u.search + u.hash)
}

/* 참가 다이얼로그 */
const joinDialog = $('joinDialog')
let joinMode = 'join'
function openJoin(mode, code) {
  joinMode = mode
  $('joinTitle').textContent = mode === 'create' ? '여행 만들기' : '초대코드로 참가'
  $('joinHint').textContent = mode === 'create'
    ? '만들면 초대코드가 나와요. 친구들에게 코드를 알려주면 같은 일정을 보게 됩니다.'
    : '친구에게 받은 초대코드와 내 이름을 넣어주세요.'
  $('jn-codeWrap').hidden = mode === 'create'
  $('jn-tripWrap').hidden = mode !== 'create'
  if (mode === 'create') $('jn-trip').value = myTrips.length ? '' : '친구들과 후쿠오카'
  $('jn-go').textContent = mode === 'create' ? '만들기' : '참가하기'
  $('jn-err').textContent = ''
  $('jn-name').value = cloud.me?.name || ''
  if (code) {
    $('jn-code').value = code
    $('joinHint').textContent = `초대코드 ${code} 로 참가합니다. 내 이름만 넣어주세요.`
  }
  joinDialog.showModal()
  if (code) $('jn-name').focus()
}
$('jn-close').addEventListener('click', () => joinDialog.close())
$('jn-go').addEventListener('click', async () => {
  const name = $('jn-name').value.trim()
  const code = $('jn-code').value.trim().toUpperCase()
  if (!name) { $('jn-err').textContent = '이름을 넣어주세요.'; return }
  if (joinMode === 'join' && !code) { $('jn-err').textContent = '초대코드를 넣어주세요.'; return }
  $('jn-go').disabled = true
  try {
    if (joinMode === 'create') {
      const wanted = $('jn-trip').value.trim() || '내 여행'
      const unique = uniqueTripName(wanted)
      await createTrip(unique, name)
      resetSharedLocal()
      if (unique !== wanted) toast(`같은 이름이 있어 '${unique}' 로 만들었어요`)
    } else await joinTrip(code, name)
    joinDialog.close()
    clearInviteParam()
    await refreshCloud()
    await refreshTripList()
    await renderShare()
    if (joinMode === 'join') { switchTab('plan'); toast('참가했어요! 이제 같은 일정을 봅니다.') }
  } catch (err) {
    $('jn-err').textContent = err.message || String(err)
  } finally {
    $('jn-go').disabled = false
  }
})

/* ───────── 홈 화면 설치 안내 ───────── */
/* 안드로이드·크롬은 설치 버튼을 직접 띄울 수 있다. 사파리는 불가라 손으로 안내한다. */
let installPrompt = null
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault()
  installPrompt = e
  renderInstall()
})
window.addEventListener('appinstalled', () => { installPrompt = null; renderInstall() })

/* 사파리 공유 시트에서 '홈 화면에 추가'가 어디 있는지 보여주는 삽화 */
const shareSheetSvg = () => `
<svg class="sheetfig" viewBox="0 0 300 232" role="img" aria-label="사파리 공유 시트에서 홈 화면에 추가 위치">
  <rect x="4" y="4" width="292" height="224" rx="16" fill="var(--surface2)" stroke="var(--line)"/>
  <rect x="16" y="16" width="26" height="26" rx="6" fill="var(--indigo)"/>
  <text x="50" y="28" font-size="11" font-weight="700" fill="var(--ink)">후쿠오카 수첩</text>
  <text x="50" y="41" font-size="9" fill="var(--muted)">kozikim.github.io</text>
  <line x1="16" y1="55" x2="284" y2="55" stroke="var(--line)"/>
  <g font-size="10.5" fill="var(--muted)">
    <text x="46" y="76">북마크에 추가</text>
    <text x="46" y="102">QR 코드 만들기</text>
    <text x="46" y="128">페이지에서 찾기</text>
  </g>
  <g fill="none" stroke="var(--muted)" stroke-width="1.4">
    <path d="M25 68l5 10 5-10-5 3z"/><rect x="25" y="94" width="10" height="10" rx="2"/>
    <circle cx="30" cy="123" r="5"/>
  </g>
  <!-- 강조: 홈 화면에 추가 -->
  <rect x="12" y="142" width="276" height="34" rx="10" fill="var(--accent-soft)" stroke="var(--accent)" stroke-width="1.6"/>
  <g stroke="var(--accent)" stroke-width="1.8" fill="none">
    <rect x="24" y="152" width="14" height="14" rx="3.5"/>
    <path d="M31 155.5v7M27.5 159h7" stroke-linecap="round"/>
  </g>
  <text x="48" y="164" font-size="11.5" font-weight="800" fill="var(--accent)">홈 화면에 추가</text>
  <text x="272" y="164" font-size="13" font-weight="800" fill="var(--accent)" text-anchor="end">←</text>
  <g font-size="10.5" fill="var(--muted)">
    <text x="46" y="197">새로운 빠른 메모에 추가</text>
    <text x="46" y="219">Safari에서 열기</text>
  </g>
  <g fill="none" stroke="var(--muted)" stroke-width="1.4">
    <rect x="25" y="189" width="10" height="10" rx="2"/><circle cx="30" cy="214" r="5"/>
  </g>
</svg>`

const GUIDES = {
  ios: {
    figure: shareSheetSvg,
    icon: '', title: '아이폰 · 아이패드 (사파리)',
    steps: [
      '<b>사파리</b>로 이 페이지를 엽니다. (크롬·네이버 앱에서는 설치가 안 돼요)',
      '주소창 오른쪽 또는 화면 아래의 <b>공유 버튼</b>(네모에 위쪽 화살표)을 누릅니다.',
      '메뉴를 아래로 내려 <b>홈 화면에 추가</b>를 누릅니다.',
      '오른쪽 위 <b>추가</b>를 누르면 끝이에요.',
    ],
    note: '아이폰은 홈 화면에 추가한 뒤 그 앱에서 열어야 알림을 켤 수 있어요. 애플 정책이라 사파리 탭에서는 안 됩니다.',
  },
  android: {
    icon: '', title: '안드로이드 (크롬)',
    steps: [
      '주소창 오른쪽 <b>⋮</b> 메뉴를 누릅니다.',
      '<b>앱 설치</b> 또는 <b>홈 화면에 추가</b>를 누릅니다.',
      '<b>설치</b>를 누르면 끝이에요.',
    ],
    note: '설치하면 알림도 바로 받을 수 있어요.',
  },
  desktop: {
    icon: '', title: 'PC (크롬 · 엣지)',
    steps: [
      '주소창 오른쪽 끝의 <b>설치 아이콘</b>을 누릅니다.',
      '안 보이면 <b>⋮</b> 메뉴 → <b>캐스트, 저장 및 공유</b> → <b>페이지를 앱으로 설치</b>를 고릅니다.',
    ],
    note: '',
  },
}
function detectPlatform() {
  const ua = navigator.userAgent
  if (/iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios'
  if (/Android/.test(ua)) return 'android'
  return 'desktop'
}
function guideCard(g, main) {
  return `<div class="card guide ${main ? 'main' : ''}">
    <div class="gt">${esc(g.title)}${main ? '<span class="cat mine">내 기기</span>' : ''}</div>
    <ol class="gsteps">${g.steps.map(s => `<li>${s}</li>`).join('')}</ol>
    ${g.figure ? g.figure() : ''}
    ${g.note ? `<p class="hint">${esc(g.note)}</p>` : ''}
  </div>`
}
function renderInstall() {
  const el = $('installBox'); if (!el) return
  const plat = detectPlatform()
  if (isStandalone()) {
    el.innerHTML = `<div class="card"><div class="rowtop"><span class="pname">✅ 이미 설치돼 있어요</span></div>
      <p class="pdesc">홈 화면 앱으로 열고 있습니다. 알림도 켤 수 있어요.</p>
      <div class="acts"><button class="btn small ghost" data-go-share>함께 쓰기·알림 설정으로</button></div></div>`
    return
  }
  let html = ''
  if (installPrompt) {
    html += `<div class="card"><div class="rowtop"><span class="pname">📲 바로 설치하기</span></div>
      <p class="pdesc">이 기기는 버튼 한 번으로 설치할 수 있어요.</p>
      <div class="acts"><button class="btn" id="installNow">홈 화면에 설치</button></div></div>`
  }
  html += guideCard(GUIDES[plat], true)
  html += `<h3>다른 기기에서는</h3>`
  for (const k of Object.keys(GUIDES)) if (k !== plat) html += guideCard(GUIDES[k], false)
  el.innerHTML = html
}
$('installBox').addEventListener('click', async e => {
  if (e.target.closest('[data-go-share]')) { switchTab('more'); return }
  if (!e.target.closest('#installNow') || !installPrompt) return
  installPrompt.prompt()
  const { outcome } = await installPrompt.userChoice
  if (outcome === 'accepted') toast('설치했어요! 홈 화면에서 열어보세요.')
  installPrompt = null
  renderInstall()
})

/* ───────── 꿀팁 탭 ───────── */
/* 항목은 "문자열" 또는 { t, pri } 형태 — pri 1=필수, 2=중요, 없으면 일반 */
const normEntry = x => (typeof x === 'string' ? { t: x, pri: 0 } : { t: x.t, pri: x.pri || 0 })
/* 체크/삭제 상태의 키는 내용에서 뽑는다. 목록 순서가 바뀌어도 엉뚱한 항목에 붙지 않는다 */
function textKey(prefix, text) {
  let h = 0
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0
  return prefix + Math.abs(h).toString(36)
}
const priBadge = p => p === 1 ? `<span class="pri p1">필수</span>` : p === 2 ? `<span class="pri p2">중요</span>` : ''
const byPri = (a, b) => (a.pri || 9) - (b.pri || 9)

let onlyImportantTips = false, onlyImportantChecks = false
function renderPriFilter(el, on, label) {
  $(el).innerHTML = `<span>보기</span>`
    + [[false, '전체'], [true, label]].map(([v, t]) =>
      `<button class="${v === on ? 'on' : ''}" data-v="${v}">${t}</button>`).join('')
}
$('tipFilter').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return
  onlyImportantTips = b.dataset.v === 'true'; renderTips()
})
$('checkFilter').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return
  onlyImportantChecks = b.dataset.v === 'true'; renderChecks()
})

function renderTips() {
  renderPriFilter('tipFilter', onlyImportantTips, '필수·중요만')
  let html = ''
  TIPS.forEach((cat, ci) => {
    const items = cat.items.map(raw => {
      const e = normEntry(raw)
      return { ...e, key: textKey('t', cat.c + e.t), custom: false }
    }).filter(x => !S.removedTips.includes(x.key))
    const customs = S.customTips.filter(x => x.cat === cat.c).map(x => ({ t: x.text, pri: 0, key: x.id, custom: true }))
    let all = [...items, ...customs].sort(byPri)
    if (onlyImportantTips) all = all.filter(x => x.pri === 1 || x.pri === 2)
    if (!all.length) return
    html += `<div class="tipcat"><h3>${esc(cat.c)}</h3><div class="card" style="padding:6px 16px">` +
      all.map(x => `<div class="tip"><span class="mark">${x.custom ? '✎' : '◦'}</span>
        <span>${priBadge(x.pri)}${esc(x.t)}</span>
        <span class="del"><button data-key="${esc(x.key)}" data-custom="${x.custom}" aria-label="팁 삭제">✕</button></span></div>`).join('')
      + `</div></div>`
  })
  $('tipList').innerHTML = html || `<div class="empty">해당하는 팁이 없어요.</div>`
  $('tipSrcs').innerHTML = '출처: ' + TIP_SOURCES.map(s => `<a href="${s[1]}" target="_blank" rel="noopener">${esc(s[0])}</a>`).join(' · ')
}
$('tipList').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return
  if (!confirm('이 팁을 삭제할까요?')) return
  if (b.dataset.custom === 'true') S.customTips = S.customTips.filter(x => x.id !== b.dataset.key)
  else S.removedTips.push(b.dataset.key)
  save(); renderTips()
})
$('tp-cat').innerHTML = TIPS.map(t => `<option>${esc(t.c)}</option>`).join('')
$('tipForm').addEventListener('submit', e => {
  e.preventDefault()
  const text = $('tp-text').value.trim(); if (!text) return
  S.customTips.push({ id: uid(), cat: $('tp-cat').value, text })
  $('tp-text').value = ''
  save(); renderTips()
})

/* ───────── 준비 탭 ───────── */
function renderChecks() {
  renderPriFilter('checkFilter', onlyImportantChecks, '필수·중요만')
  let rows = [
    ...PRESET_CHECKS.map(raw => {
      const e = normEntry(raw)
      return { ...e, key: textKey('k', e.t), custom: false }
    }).filter(x => !S.removedChecks.includes(x.key)),
    ...S.customChecks.map(x => ({ t: x.text, pri: 0, key: x.id, custom: true })),
  ].sort(byPri)
  if (onlyImportantChecks) rows = rows.filter(x => x.pri === 1 || x.pri === 2)
  const done = rows.filter(x => S.checks[x.key]).length
  $('checkList').innerHTML = rows.length ? `
    <div class="ckprogress"><b>${done}/${rows.length}</b> 완료</div>` + rows.map(x => `
    <div class="checkrow ${S.checks[x.key] ? 'done' : ''}">
      <input type="checkbox" id="ck-${esc(x.key)}" data-key="${esc(x.key)}" ${S.checks[x.key] ? 'checked' : ''}>
      <label for="ck-${esc(x.key)}">${priBadge(x.pri)}${esc(x.t)}</label>
      <button class="rm" data-key="${esc(x.key)}" data-custom="${x.custom}">✕</button>
    </div>`).join('') : `<div class="empty">해당하는 준비물이 없어요.</div>`
}
$('checkList').addEventListener('change', e => {
  const c = e.target.closest('input[type=checkbox]'); if (!c) return
  S.checks[c.dataset.key] = c.checked; save(); renderChecks()
})
$('checkList').addEventListener('click', e => {
  const b = e.target.closest('button.rm'); if (!b) return
  if (b.dataset.custom === 'true') S.customChecks = S.customChecks.filter(x => x.id !== b.dataset.key)
  else S.removedChecks.push(b.dataset.key)
  delete S.checks[b.dataset.key]; save(); renderChecks()
})
$('checkForm').addEventListener('submit', e => {
  e.preventDefault()
  const t = $('ck-text').value.trim(); if (!t) return
  S.customChecks.push({ id: uid(), text: t })
  $('ck-text').value = ''; save(); renderChecks()
})
/* 환율/경비 */
const fxJpy = $('fx-jpy'), fxRate = $('fx-rate'), fxKrw = $('fx-krw')
function fxCalc() { const j = parseFloat(fxJpy.value) || 0; fxKrw.textContent = Math.round(j * (parseFloat(fxRate.value) || 0) / 100).toLocaleString() + '원' }
fxJpy.addEventListener('input', fxCalc)
fxRate.addEventListener('input', () => { S.rate = parseFloat(fxRate.value) || 860; save(); fxCalc(); renderExpenses() })
/* ───────── 경비 탭 ───────── */
let expScope = 'shared'
const CAT_OPTS = ['식비', '교통', '쇼핑', '숙박', '입장료', '기타']
const krw = j => Math.round(j * S.rate / 100).toLocaleString()
const sum = rows => rows.reduce((s, x) => s + x.jpy, 0)
/** 공동 지출을 나눌 인원 수 */
const headcount = () => (cloud.active && cloud.members.length ? cloud.members.length : 1)

function renderExpSummary() {
  const shared = sum(S.expenses), mine = sum(S.myExpenses)
  const n = headcount()
  const myShare = Math.round(shared / n)
  const burden = mine + myShare
  $('expSummary').innerHTML = `<div class="card expsum">
    <div class="er"><span>👥 공동 지출</span><b>¥${shared.toLocaleString()}</b><span class="sub">${S.expenses.length}건</span></div>
    <div class="er"><span>🙋 내 지출</span><b>¥${mine.toLocaleString()}</b><span class="sub">${S.myExpenses.length}건</span></div>
    <div class="er tot"><span>내 총부담</span><b>¥${burden.toLocaleString()}</b><span class="sub">≈ ${krw(burden)}원</span></div>
    <p class="hint" style="margin:6px 0 0">내 지출 + 공동 지출을 ${n}명으로 나눈 몫(¥${myShare.toLocaleString()})</p>
  </div>`
}

function expPanelHtml() {
  const isShared = expScope === 'shared'
  const rows = isShared ? S.expenses : S.myExpenses
  const total = sum(rows)

  let html = `<p class="hint" style="margin:0 0 10px">${isShared
    ? (cloud.active ? '여행 참여자 모두에게 똑같이 보이고, 누가 냈는지도 함께 기록돼요.'
                    : '함께 쓰기를 연결하면 친구들과 공유돼요. 지금은 이 기기에만 저장됩니다.')
    : '나만 보는 지출이에요. 공유되지 않고 이 기기에만 남습니다.'}</p>`

  html += `<form class="editor" data-expform="${expScope}">
    <div class="grid">
      <div class="full"><label class="f">내역</label><input name="desc" placeholder="예: 이치란 라멘 2인" autocomplete="off"></div>
      <div><label class="f">금액 (¥)</label><input name="jpy" inputmode="numeric" placeholder="2200"></div>
      <div><label class="f">분류</label><select name="cat">${CAT_OPTS.map(c => `<option>${c}</option>`).join('')}</select></div>
    </div>
    <div class="acts" style="margin-top:10px"><button class="btn small" type="submit">${isShared ? '공동' : '내'} 지출 추가</button></div>
  </form>`

  if (!rows.length) {
    html += `<div class="empty">아직 기록한 ${isShared ? '공동' : '개인'} 지출이 없어요.</div>`
    return html
  }

  html += `<div class="card"><table class="exp"><thead><tr><th>내역</th>${isShared ? '<th>낸 사람</th>' : ''}<th class="r">¥</th><th class="r">원화</th><th></th></tr></thead><tbody>` +
    rows.map(x => `<tr><td>${esc(x.desc)}<div class="exsub">${esc(x.cat)}</div></td>
      ${isShared ? `<td>${esc(x.by || '—')}</td>` : ''}
      <td class="r">${x.jpy.toLocaleString()}</td><td class="r">${krw(x.jpy)}</td>
      <td class="r"><button class="rm" data-exdel="${x.id}">✕</button></td></tr>`).join('') +
    `</tbody></table>
    <div class="total"><span>합계</span><span>¥${total.toLocaleString()} ≈ ${krw(total)}원</span></div>`

  // 공동 지출은 누가 얼마 냈는지와 1인당 분담액까지
  if (isShared) {
    const paid = {}
    for (const x of rows) if (x.by) paid[x.by] = (paid[x.by] || 0) + x.jpy
    const names = [...new Set([...(cloud.active ? cloud.members.map(m => m.name) : []), ...Object.keys(paid)])]
    if (names.length > 1) {
      const share = Math.round(total / names.length)
      html += `<div class="settle"><div class="sh">1인당 <b>¥${share.toLocaleString()}</b> ≈ ${krw(share)}원 <span>(${names.length}명 기준)</span></div>` +
        names.map(n => {
          const p = paid[n] || 0, diff = p - share
          return `<div class="srow"><span class="sn">${esc(n)}</span>
            <span class="sp">낸 돈 ¥${p.toLocaleString()}</span>
            <span class="sd ${diff >= 0 ? 'plus' : 'minus'}">${diff >= 0 ? `+${diff.toLocaleString()} 받을 돈` : `${Math.abs(diff).toLocaleString()} 낼 돈`}</span></div>`
        }).join('') + `</div>`
    }
  }
  return html + `</div>`
}

function renderExpenses() {
  $('expScope').innerHTML = [['shared', '👥 공동 지출'], ['personal', '🙋 내 지출']]
    .map(([k, t]) => `<button class="${k === expScope ? 'on' : ''}" data-x="${k}">${t}</button>`).join('')
  renderExpSummary()
  $('expPanel').innerHTML = expPanelHtml()
}
$('expScope').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return
  expScope = b.dataset.x; renderExpenses()
})
$('expPanel').addEventListener('click', e => {
  const b = e.target.closest('button[data-exdel]'); if (!b) return
  const id = b.dataset.exdel
  if (expScope === 'shared') S.expenses = S.expenses.filter(x => x.id !== id)
  else S.myExpenses = S.myExpenses.filter(x => x.id !== id)
  save(); renderExpenses()
})
$('expPanel').addEventListener('submit', e => {
  const f = e.target.closest('form[data-expform]'); if (!f) return
  e.preventDefault()
  const desc = f.elements.desc.value.trim()
  const jpy = parseFloat(f.elements.jpy.value)
  if (!desc || !isFinite(jpy)) return
  const row = { id: uid(), desc, jpy: Math.round(jpy), cat: f.elements.cat.value }
  if (f.dataset.expform === 'shared') {
    if (cloud.active) row.by = cloud.me.name
    S.expenses.push(row)
  } else S.myExpenses.push(row)
  save(); renderExpenses()
})

/* ───────── 백업 ───────── */
const ioDialog = $('ioDialog')
let ioMode = 'export'
$('exportBtn').addEventListener('click', () => {
  ioMode = 'export'
  $('ioTitle').textContent = '데이터 내보내기'
  $('ioHint').textContent = '아래 내용을 복사해 메모장·카톡 등에 보관하세요.'
  $('ioText').value = JSON.stringify(S)
  $('ioAction').textContent = '복사'
  ioDialog.showModal()
})
$('importBtn').addEventListener('click', () => {
  ioMode = 'import'
  $('ioTitle').textContent = '데이터 가져오기'
  $('ioHint').textContent = "내보내기로 만든 내용을 붙여넣고 '적용'을 누르세요. 현재 데이터는 덮어써집니다."
  $('ioText').value = ''
  $('ioAction').textContent = '적용'
  ioDialog.showModal()
})
$('ioAction').addEventListener('click', () => {
  if (ioMode === 'export') {
    const ta = $('ioText'); ta.select()
    try { navigator.clipboard.writeText(ta.value) } catch (e) { document.execCommand('copy') }
    $('ioAction').textContent = '복사됨 ✓'
  } else {
    try {
      const data = JSON.parse($('ioText').value)
      S = Object.assign(defaultState(), data); save(); renderAll(); ioDialog.close()
    } catch (e) { alert('형식이 올바르지 않아요. 내보내기로 만든 내용인지 확인해 주세요.') }
  }
})
$('ioClose').addEventListener('click', () => ioDialog.close())
$('resetBtn').addEventListener('click', () => {
  if (!confirm('모든 데이터(숙소·일정·지출·체크 등)를 초기화할까요?')) return
  S = defaultState(); save(); renderAll()
})

/* ───────── 초기화 ───────── */
$('fe-cat').innerHTML = CATS.map(c => `<option>${esc(c)}</option>`).join('')
function renderAll() {
  renderFoodFilters(); renderFoods(); renderHotelForm(); renderHotel()
  renderDays(); renderTips(); renderChecks(); renderExpenses(); renderInstall(); refreshPickOptions()
  fxRate.value = S.rate; fxCalc()
}
renderAll()

/* 공유 세션이 있으면 이어서 접속한다 */
renderShare()
if (cloud.configured) {
  initCloud(onCloudChange)
    .then(resumeTrip)
    .then(async ok => { if (ok) await refreshCloud() })
    .catch(e => { cloud.error = String(e.message || e) })
    .finally(async () => {
      await refreshTripList()
      await renderShare()
      // 초대링크로 들어왔는데 아직 그 여행의 멤버가 아니면 참가 화면을 바로 띄운다
      const code = pendingInviteCode()
      if (!code) return
      if (cloud.active && cloud.trip.code === code) { clearInviteParam(); return }
      switchTab('more')
      openJoin('join', code)
    })
}

/* ───────── 버전 확인 · 업데이트 ───────── */
/* 서비스워커 갱신만 믿으면 (특히 아이폰 홈 화면 앱에서) 새 배포가 한참 안 잡힌다.
   그래서 앱이 직접 version.json 을 확인하고, 다르면 사용자에게 갱신 버튼을 띄운다. */
const BUILD_ID = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev'
let updateReady = false

async function fetchLatestBuild() {
  const r = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' })
  if (!r.ok) throw new Error('version check failed')
  return (await r.json()).build
}

async function checkForUpdate({ manual = false } = {}) {
  try {
    const latest = await fetchLatestBuild()
    if (latest && latest !== BUILD_ID) {
      updateReady = true
      onNewVersion(manual)
    } else if (manual) {
      toast('이미 최신 버전이에요.')
    }
  } catch (e) {
    if (manual) toast('업데이트 확인에 실패했어요. 연결을 확인해 주세요.')
  }
}

/* 새 버전을 찾으면 알아서 새로고침한다.
   다만 뭔가 입력하는 중이면 날아가니, 그때는 버튼만 띄우고 사용자가 고르게 한다. */
const RELOAD_KEY = 'fukuoka-auto-reload'
const reloadCount = () => { try { return Number(sessionStorage.getItem(RELOAD_KEY) || 0) } catch (e) { return 99 } }
const bumpReload = () => { try { sessionStorage.setItem(RELOAD_KEY, String(reloadCount() + 1)) } catch (e) { /* ignore */ } }

function isBusy() {
  if (document.querySelector('dialog[open]')) return true
  const el = document.activeElement
  return Boolean(el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && el.value)
}

function onNewVersion(manual) {
  // 배포 직후 CDN이 엇갈려 계속 새 버전으로 보일 수 있으니 한 세션에 두 번까지만 자동 새로고침
  if (!manual && (isBusy() || reloadCount() >= 2)) { showUpdateBar(); return }
  bumpReload()
  toast('새 버전을 불러옵니다…')
  setTimeout(applyUpdate, 500)
}

function showUpdateBar() {
  if ($('updateBar')) return
  const el = document.createElement('div')
  el.id = 'updateBar'
  el.innerHTML = `<span>새 버전이 나왔어요</span><button type="button">지금 업데이트</button>`
  el.querySelector('button').addEventListener('click', applyUpdate)
  document.body.appendChild(el)
  requestAnimationFrame(() => el.classList.add('on'))
}

/** 오래된 캐시를 지우고 새로 받아온다. 서비스워커가 옛 화면을 붙들고 있어도 확실히 넘어간다 */
async function applyUpdate() {
  try {
    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(keys.map(k => caches.delete(k)))
    }
    const reg = await navigator.serviceWorker?.getRegistration()
    await reg?.update()
  } catch (e) { /* 실패해도 새로고침은 시도한다 */ }
  location.reload()
}

/* PWA: 오프라인 캐시 + 새 버전 자동 반영 */
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  // 페이지를 열 때 이미 서비스워커가 있었는지 기억해 둔다.
  // 첫 설치 때도 controllerchange가 한 번 도는데, 그때 새로고침하면 헛도는 느낌이 난다.
  const hadController = Boolean(navigator.serviceWorker.controller)
  let reloading = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return
    reloading = true
    location.reload()
  })

  // updateViaCache:'none' — sw.js 자체가 HTTP 캐시에서 나오지 않게 한다
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then(reg => {
    reg.update().catch(() => { /* 오프라인 */ })
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing
      if (!sw) return
      sw.addEventListener('statechange', () => {
        if (sw.state === 'installed' && navigator.serviceWorker.controller) sw.postMessage('skipWaiting')
      })
    })
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) reg.update().catch(() => { /* 오프라인 */ })
    })
  }).catch(() => { /* 미지원 환경 무시 */ })
}

$('verText').textContent = `버전 ${BUILD_ID}`
$('verCheck').addEventListener('click', async () => {
  const b = $('verCheck')
  b.disabled = true; b.textContent = '확인 중…'
  await checkForUpdate({ manual: true })
  b.disabled = false; b.textContent = '업데이트 확인'
})

if (import.meta.env.PROD) {
  checkForUpdate()
  // 앱을 계속 열어두는 경우도 있으니 주기적으로도 확인한다
  setInterval(() => { if (!updateReady) checkForUpdate() }, 5 * 60 * 1000)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !updateReady) checkForUpdate()
  })
}
