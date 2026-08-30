// 이동시간 추정: 직선거리(하버사인) + 내장 지하철 노선 그래프
import { STN, LINES, TRANSFERS } from './data.js'

export function hav(a, b) {
  const R = 6371, t = Math.PI / 180
  const dLat = (b.lat - a.lat) * t, dLng = (b.lng - a.lng) * t
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s)) // km
}

const GRAPH = {}
{
  const add = (a, b, w) => {
    (GRAPH[a] = GRAPH[a] || []).push([b, w]);
    (GRAPH[b] = GRAPH[b] || []).push([a, w])
  }
  for (const line of LINES)
    for (let i = 0; i < line.length - 1; i++) {
      const a = STN[line[i]], b = STN[line[i + 1]]
      add(line[i], line[i + 1], Math.max(1.6, hav(a, b) * 1.15 / 0.55)) // 약 33km/h + 정차
    }
  for (const [a, b, w] of TRANSFERS) add(a, b, w)
}

function dijkstra(src, dst) {
  const dist = {}, Q = new Set(Object.keys(STN))
  for (const k of Q) dist[k] = Infinity
  dist[src] = 0
  while (Q.size) {
    let u = null, best = Infinity
    for (const k of Q) if (dist[k] < best) { best = dist[k]; u = k }
    if (u === null || u === dst) break
    Q.delete(u)
    for (const [v, w] of (GRAPH[u] || []))
      if (Q.has(v) && dist[u] + w < dist[v]) dist[v] = dist[u] + w
  }
  return dist[dst] === Infinity ? null : { min: dist[dst] }
}

function nearestStations(p, n) {
  return Object.keys(STN).map(k => ({ k, d: hav(p, STN[k]) })).sort((a, b) => a.d - b.d).slice(0, n)
}

export const walkMin = km => Math.max(1, Math.round(km * 1000 * 1.3 / 80))

/** 두 지점 간 이동 옵션 (도보/지하철/택시) — 좌표 없으면 null */
export function routes(a, b) {
  if (!a || !b || a.lat == null || b.lat == null || a.lat === '' || b.lat === '') return null
  const d = hav(a, b)
  const out = { dKm: d, walk: walkMin(d), taxi: null, metro: null, far: d > 12 }
  out.taxi = { min: Math.max(5, Math.round(d * 1.4 / 0.42)), fare: Math.round((670 + Math.max(0, d * 1.4 - 1) * 410) / 10) * 10 }
  let best = null
  for (const sa of nearestStations(a, 3))
    for (const sb of nearestStations(b, 3)) {
      if (sa.k === sb.k) continue
      const wa = walkMin(sa.d), wb = walkMin(sb.d)
      if (wa > 16 || wb > 16) continue
      const r = dijkstra(sa.k, sb.k)
      if (!r) continue
      const total = wa + 4 + Math.round(r.min) + wb
      if (!best || total < best.min) best = { min: total, from: STN[sa.k].n, to: STN[sb.k].n, wa, wb, ride: Math.round(r.min) }
    }
  if (best && best.min < out.walk) out.metro = best
  return out
}

export function routeChips(r) {
  if (!r) return ''
  let h = ''
  if (r.far) {
    h += `<span class="chip far">직선 ${r.dKm.toFixed(1)}km · 니시테츠/JR 등 광역 이동 권장</span>`
    h += `<span class="chip taxi">🚕 택시 약 ${r.taxi.min}분</span>`
    return h
  }
  if (r.walk <= 25) h += `<span class="chip walk">🚶 도보 ${r.walk}분 (${(r.dKm * 1.3).toFixed(1)}km)</span>`
  if (r.metro) h += `<span class="chip metro">🚇 약 ${r.metro.min}분 · ${r.metro.from}→${r.metro.to}</span>`
  if (r.walk > 12) h += `<span class="chip taxi">🚕 약 ${r.taxi.min}분 · 약 ¥${r.taxi.fare.toLocaleString()}</span>`
  if (!h) h = `<span class="chip walk">🚶 도보 ${r.walk}분</span>`
  return h
}

export function bestSummary(r) {
  if (!r) return null
  if (r.far) return `광역 이동 (직선 ${r.dKm.toFixed(1)}km)`
  if (r.walk <= 15 || !r.metro) return `🚶 도보 약 ${r.walk}분`
  return `🚇 지하철 약 ${r.metro.min}분 (${r.metro.from}→${r.metro.to})`
}
