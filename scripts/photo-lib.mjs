// 장소 사진 도구 공용 — 장소 목록 읽기, 이름 매칭, 사진 출처 파일 읽고 쓰기
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const INBOX = path.join(ROOT, 'photos-inbox')
export const DONE = path.join(INBOX, '처리됨')
export const OUT = path.join(ROOT, 'public', 'photos')
export const CREDITS = path.join(ROOT, 'src', 'photos.js')

export async function loadPlaces() {
  const d = await import(pathToFileURL(path.join(ROOT, 'src', 'data.js')).href)
  const stays = d.HOTEL_PRESETS.filter(h => h.hotelName).map(h => ({ id: h.id, name: h.hotelName, area: h.area, kind: '숙소' }))
  return [
    { ...d.ICN, kind: '공항' }, { ...d.AIRPORT, kind: '공항' },
    ...stays,
    ...d.PRESET_FOODS.map(p => ({ ...p, kind: '맛집' })),
    ...d.PRESET_SPOTS.map(p => ({ ...p, kind: '명소' })),
  ]
}

export function readCredits() {
  if (!fs.existsSync(CREDITS)) return {}
  return JSON.parse(fs.readFileSync(CREDITS, 'utf8').match(/PHOTOS = ([\s\S]*)$/)[1])
}
export function writeCredits(credits) {
  fs.writeFileSync(CREDITS,
    '// 자동 생성 — scripts/add-photos.mjs · 장소 id → 사진 출처. 파일은 public/photos/<id>.webp\n' +
    'export const PHOTOS = ' + JSON.stringify(credits, null, 1) + '\n')
}

/** 괄호 안 지점명까지 살린 비교용 — '카와야 (기온점)' 처럼 지점을 적어준 파일 이름은 이걸로 먼저 정확히 맞춘다 */
export const normFull = s => String(s || '')
  .replace(/[\s·・,.\-–—_'"!?!？~〜\/\\()（）]+/g, '')
  .replace(/[🏨📍]/g, '')
  .toLowerCase()

/** 이름 비교용 — 공백·괄호·기호·이모지를 걷어내고 소문자로 */
export const norm = s => String(s || '')
  .replace(/\([^)]*\)/g, '')
  .replace(/[\s·・,.\-–—_'"!?!？~〜\/\\]+/g, '')
  .replace(/[🏨📍]/g, '')
  .toLowerCase()

/**
 * 파일 이름으로 장소를 찾는다.
 *  - "u17.jpg" 처럼 id 가 그대로면 그 장소
 *  - "라멘 부타킨.jpg" 처럼 이름이면: 완전 일치 → 한쪽이 다른 쪽을 포함 → 앞 4글자 이상 공통
 * 여러 개가 걸리면 candidates 로 돌려준다 (지점이 여러 개인 체인 등)
 */
export function matchPlace(basename, places) {
  const key = basename.replace(/\.[^.]+$/, '').trim()
  const byId = places.find(p => p.id === key)
  if (byId) return { place: byId }
  const full = places.filter(p => normFull(p.name) === normFull(key))
  if (full.length === 1) return { place: full[0] }
  const n = norm(key)
  if (!n) return {}
  const exact = places.filter(p => norm(p.name) === n)
  if (exact.length === 1) return { place: exact[0] }
  if (exact.length > 1) return { candidates: exact }
  const contains = places.filter(p => { const pn = norm(p.name); return pn.includes(n) || n.includes(pn) })
  if (contains.length === 1) return { place: contains[0] }
  if (contains.length > 1) return { candidates: contains }
  // 앞부분이 같은 것 (오타·표기 차이 대비)
  const head = n.slice(0, 4)
  const loose = head.length >= 4 ? places.filter(p => norm(p.name).startsWith(head)) : []
  if (loose.length === 1) return { place: loose[0] }
  if (loose.length > 1) return { candidates: loose }
  return {}
}

export const photoStatus = (credits, id) => {
  const c = credits[id]
  if (!c) return '없음'
  if (c.kind === 'own') return '우리 사진'
  if (c.kind === 'dish') return '메뉴 예시'
  return '위키 사진'
}
