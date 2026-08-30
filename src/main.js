import './styles.css'
import { CATS, AIRPORT, PRESET_FOODS, PRESET_SPOTS, HOTEL_PRESETS, TIPS, TIP_SOURCES, PRESET_CHECKS } from './data.js'
import { hav, routes, routeChips, bestSummary } from './transit.js'

/* ───────── 저장소 ───────── */
const KEY = 'fukuoka-note-v1'
const defaultState = () => ({
  hotel: null, customFoods: [], foodMeta: {}, hiddenFoods: [],
  tripStart: '', days: [{ id: 'd1', items: [] }],
  customTips: [], removedTips: [],
  checks: {}, customChecks: [], removedChecks: [],
  expenses: [], rate: 950,
})
let S = defaultState()
try { const raw = localStorage.getItem(KEY); if (raw) S = Object.assign(defaultState(), JSON.parse(raw)) } catch (e) { /* 프라이빗 모드 등 */ }
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)) } catch (e) { /* ignore */ } }
const uid = () => 'x' + Math.random().toString(36).slice(2, 9)
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const gmap = name => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name + ' 福岡')}`
const $ = id => document.getElementById(id)

function allFoods() { return PRESET_FOODS.filter(f => !S.hiddenFoods.includes(f.id)).concat(S.customFoods) }
function allPlaces() {
  const places = [{ ...AIRPORT, kind: '공항' }]
  if (S.hotel && S.hotel.lat) places.push({ id: 'hotel', name: '🏨 ' + (S.hotel.name || '우리 숙소'), lat: S.hotel.lat, lng: S.hotel.lng, kind: '숙소' })
  for (const f of allFoods()) places.push({ ...f, kind: '맛집' })
  for (const s of PRESET_SPOTS) places.push({ ...s, kind: '명소' })
  return places
}
function findPlace(id) { return allPlaces().find(p => p.id === id) }

/* ───────── 탭 ───────── */
$('tabs').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return
  document.querySelectorAll('nav.tabs button').forEach(x => x.classList.toggle('on', x === b))
  document.querySelectorAll('section.pane').forEach(x => x.classList.toggle('on', x.id === 'pane-' + b.dataset.tab))
})

/* ───────── 맛집 탭 ───────── */
let foodFilter = '전체'
function renderFoodFilters() {
  const cats = ['전체', '⭐ 즐겨찾기', ...CATS]
  $('foodFilters').innerHTML = cats.map(c =>
    `<button class="${c === foodFilter ? 'on' : ''}" data-c="${esc(c)}">${esc(c)}</button>`).join('')
}
$('foodFilters').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return
  foodFilter = b.dataset.c; renderFoodFilters(); renderFoods()
})
function renderFoods() {
  const hotel = (S.hotel && S.hotel.lat) ? S.hotel : null
  let list = allFoods()
  if (foodFilter === '⭐ 즐겨찾기') list = list.filter(f => (S.foodMeta[f.id] || {}).fav)
  else if (foodFilter !== '전체') list = list.filter(f => f.cat === foodFilter)
  if (hotel) list = list.slice().sort((a, b) => {
    const da = a.lat ? hav(hotel, a) : 9e9, db = b.lat ? hav(hotel, b) : 9e9; return da - db
  })
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
function renderHotelForm() {
  $('ht-preset').innerHTML = `<option value="">— 지역 선택 —</option>` + HOTEL_PRESETS.map((p, i) => `<option value="${i}">${esc(p.name)}</option>`).join('')
  if (S.hotel) {
    $('ht-name').value = S.hotel.name || ''
    $('ht-lat').value = S.hotel.lat ?? ''
    $('ht-lng').value = S.hotel.lng ?? ''
  }
}
$('ht-preset').addEventListener('change', e => {
  const p = HOTEL_PRESETS[e.target.value]; if (!p) return
  $('ht-lat').value = p.lat
  $('ht-lng').value = p.lng
})
$('hotelForm').addEventListener('submit', e => {
  e.preventDefault()
  const lat = parseFloat($('ht-lat').value), lng = parseFloat($('ht-lng').value)
  if (!isFinite(lat) || !isFinite(lng)) { alert('위치(지역 선택 또는 좌표)를 입력해 주세요.'); return }
  S.hotel = { name: $('ht-name').value.trim(), lat, lng }
  save(); renderHotel(); renderFoods(); refreshPickOptions()
})
function renderHotel() {
  const el = $('hotelResult')
  if (!S.hotel || !S.hotel.lat) { el.innerHTML = `<div class="empty">숙소를 저장하면 공항·맛집·명소까지 이동시간이 여기 표시됩니다.</div>`; return }
  const h = S.hotel
  const ra = routes(AIRPORT, h)
  let html = `<div class="hero">
    <div class="t">🏨 ${esc(h.name || '우리 숙소')}</div>
    <div class="d">후쿠오카공항(국제선)에서</div>
    <div class="big">${ra && ra.metro ? `🚇 약 ${ra.metro.min + 8}분` : (ra ? `🚕 약 ${ra.taxi.min}분` : '—')}</div>
    <div class="d">${ra && ra.metro ? `국제선→국내선 무료셔틀 약 8분 포함 · ${ra.metro.from}→${ra.metro.to} 하차 후 도보 ${ra.metro.wb}분` : ''}
    ${ra ? ` · 🚕 택시 약 ${ra.taxi.min}분 (약 ¥${ra.taxi.fare.toLocaleString()})` : ''}</div>
  </div>`
  const rows = [...allFoods().filter(f => f.lat).map(f => ({ p: f, kind: '맛집' })), ...PRESET_SPOTS.map(s => ({ p: s, kind: '명소' }))]
    .map(x => ({ ...x, r: routes(h, x.p) }))
    .sort((a, b) => a.r.dKm - b.r.dKm)
  html += `<h3>숙소에서 가까운 순</h3>` + rows.map(x => `
    <div class="card">
      <div class="rowtop"><span class="pname" style="font-size:14.5px">${esc(x.p.name)}</span>
        <span class="cat plain">${x.kind}</span></div>
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
          </div>
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
}
$('dayTabs').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return; curDay = +b.dataset.i; renderDays()
})
$('addDayBtn').addEventListener('click', () => {
  S.days.push({ id: uid(), items: [] }); curDay = S.days.length - 1; save(); renderDays()
})
$('tripStart').addEventListener('change', e => { S.tripStart = e.target.value; save(); renderDays() })
$('dayView').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return
  if (b.id === 'addItemBtn') { openPicker(); return }
  if (b.id === 'delDayBtn') {
    if (!confirm('이 일차와 일정을 삭제할까요?')) return
    S.days.splice(curDay, 1); curDay = Math.max(0, curDay - 1); save(); renderDays(); return
  }
  const day = S.days[curDay]
  if (b.dataset.rm) { day.items = day.items.filter(x => x.id !== b.dataset.rm); save(); renderDays(); return }
  if (b.dataset.mv) {
    const i = day.items.findIndex(x => x.id === b.dataset.id), j = i + (+b.dataset.mv)
    if (i < 0 || j < 0 || j >= day.items.length) return
    const t = day.items[i].time; day.items[i].time = day.items[j].time; day.items[j].time = t
    ;[day.items[i], day.items[j]] = [day.items[j], day.items[i]]
    save(); renderDays()
  }
})
const pickDialog = $('pickDialog')
function refreshPickOptions() {
  $('pk-place').innerHTML = allPlaces().map(p => `<option value="${p.id}">[${p.kind}] ${esc(p.name)}</option>`).join('')
    + `<option value="__custom">✏️ 직접 입력…</option>`
}
$('pk-place').addEventListener('change', e => {
  $('pk-customWrap').hidden = e.target.value !== '__custom'
})
function openPicker() {
  refreshPickOptions()
  $('pk-memo').value = ''
  $('pk-customWrap').hidden = true
  pickDialog.showModal()
}
$('pk-close').addEventListener('click', () => pickDialog.close())
$('pk-save').addEventListener('click', () => {
  const v = $('pk-place').value
  const item = { id: uid(), time: $('pk-time').value, memo: $('pk-memo').value.trim() }
  if (v === '__custom') {
    const nm = $('pk-custom').value.trim()
    if (!nm) return; item.name = nm
  } else item.placeId = v
  S.days[curDay].items.push(item)
  save(); renderDays(); pickDialog.close()
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

/* ───────── 꿀팁 탭 ───────── */
function renderTips() {
  let html = ''
  TIPS.forEach((cat, ci) => {
    const items = cat.items.map((t, ti) => ({ t, key: `p${ci}-${ti}`, custom: false }))
      .filter(x => !S.removedTips.includes(x.key))
    const customs = S.customTips.filter(x => x.cat === cat.c).map(x => ({ t: x.text, key: x.id, custom: true }))
    const all = [...items, ...customs]
    if (!all.length) return
    html += `<div class="tipcat"><h3>${esc(cat.c)}</h3><div class="card" style="padding:6px 16px">` +
      all.map(x => `<div class="tip"><span class="mark">${x.custom ? '✎' : '◦'}</span><span>${esc(x.t)}</span>
        <span class="del"><button data-key="${esc(x.key)}" data-custom="${x.custom}" aria-label="팁 삭제">✕</button></span></div>`).join('')
      + `</div></div>`
  })
  $('tipList').innerHTML = html
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
  const rows = [
    ...PRESET_CHECKS.map((t, i) => ({ t, key: 'c' + i, custom: false })).filter(x => !S.removedChecks.includes(x.key)),
    ...S.customChecks.map(x => ({ t: x.text, key: x.id, custom: true })),
  ]
  $('checkList').innerHTML = rows.length ? rows.map(x => `
    <div class="checkrow ${S.checks[x.key] ? 'done' : ''}">
      <input type="checkbox" id="ck-${esc(x.key)}" data-key="${esc(x.key)}" ${S.checks[x.key] ? 'checked' : ''}>
      <label for="ck-${esc(x.key)}">${esc(x.t)}</label>
      <button class="rm" data-key="${esc(x.key)}" data-custom="${x.custom}">✕</button>
    </div>`).join('') : `<div class="empty">체크리스트가 비었어요.</div>`
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
fxRate.addEventListener('input', () => { S.rate = parseFloat(fxRate.value) || 950; save(); fxCalc(); renderExpenses() })
function renderExpenses() {
  const el = $('expList')
  if (!S.expenses.length) { el.innerHTML = `<div style="color:var(--muted); font-size:13px">아직 기록한 지출이 없어요.</div>`; return }
  const total = S.expenses.reduce((s, x) => s + x.jpy, 0)
  el.innerHTML = `<table class="exp"><thead><tr><th>내역</th><th>분류</th><th class="r">¥</th><th class="r">원화</th><th></th></tr></thead><tbody>` +
    S.expenses.map(x => `<tr><td>${esc(x.desc)}</td><td>${esc(x.cat)}</td><td class="r">${x.jpy.toLocaleString()}</td>
      <td class="r">${Math.round(x.jpy * S.rate / 100).toLocaleString()}</td>
      <td class="r"><button class="rm" data-id="${x.id}">✕</button></td></tr>`).join('') +
    `</tbody></table>
    <div class="total"><span>합계</span><span>¥${total.toLocaleString()} ≈ ${Math.round(total * S.rate / 100).toLocaleString()}원</span></div>`
}
$('expList').addEventListener('click', e => {
  const b = e.target.closest('button.rm'); if (!b) return
  S.expenses = S.expenses.filter(x => x.id !== b.dataset.id); save(); renderExpenses()
})
$('expForm').addEventListener('submit', e => {
  e.preventDefault()
  const desc = $('ex-desc').value.trim()
  const jpy = parseFloat($('ex-jpy').value)
  if (!desc || !isFinite(jpy)) return
  S.expenses.push({ id: uid(), desc, jpy: Math.round(jpy), cat: $('ex-cat').value })
  $('ex-desc').value = ''; $('ex-jpy').value = ''
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
  renderDays(); renderTips(); renderChecks(); renderExpenses(); refreshPickOptions()
  fxRate.value = S.rate; fxCalc()
}
renderAll()

/* PWA: 오프라인 캐시 */
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => { /* 미지원 환경 무시 */ })
}
