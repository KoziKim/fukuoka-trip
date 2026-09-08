// photos-inbox/ 에 넣어둔 사진을 장소에 붙인다.
//   npm run photos
// 파일 이름은 장소 이름("라멘 부타킨.jpg") 또는 id("u17.jpg") 아무거나. jpg/png/webp/heic(아이폰) 모두 됨.
// 처리한 원본은 photos-inbox/처리됨/ 으로 옮기고, 목록(photos-inbox/사진목록.html)을 다시 만든다.
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { INBOX, DONE, OUT, loadPlaces, readCredits, writeCredits, matchPlace } from './photo-lib.mjs'
import { writeList } from './photo-list.mjs'

const EXT = /\.(jpe?g|png|webp|heic|heif|gif|bmp|tiff?)$/i

const places = await loadPlaces()
const credits = readCredits()
fs.mkdirSync(OUT, { recursive: true })
fs.mkdirSync(DONE, { recursive: true })

const files = fs.existsSync(INBOX) ? fs.readdirSync(INBOX).filter(f => EXT.test(f)) : []
if (!files.length) {
  console.log(`photos-inbox 폴더에 사진이 없어요.\n  ${INBOX}\n가게 이름으로 저장한 사진을 넣고 다시 실행하세요.`)
} else {
  let ok = 0
  const problems = []
  for (const f of files) {
    const { place, candidates } = matchPlace(f, places)
    if (!place) {
      problems.push(candidates
        ? `❓ ${f} → 어느 곳인지 애매해요: ${candidates.map(c => `${c.name} [${c.id}]`).join(' / ')}. 파일 이름을 그중 하나로 바꿔주세요.`
        : `❓ ${f} → 맞는 장소를 못 찾았어요. 사진목록.html 에 나온 이름이나 id 로 저장해 주세요.`)
      continue
    }
    try {
      const src = path.join(INBOX, f)
      // 파일을 먼저 통째로 읽는다 — Windows 에서는 sharp 가 파일을 잡고 있으면 뒤의 이동이 실패한다
      const out = await sharp(fs.readFileSync(src), { failOn: 'none' }).rotate()
        .resize({ width: 640, height: 480, fit: 'cover', position: 'attention' })
        .webp({ quality: 74 }).toBuffer()
      fs.writeFileSync(path.join(OUT, place.id + '.webp'), out)
      credits[place.id] = { kind: 'own', file: f, artist: '우리가 넣은 사진', license: '', page: '' }
      // 같은 이름의 파일이 이미 있으면 덧붙여 저장
      let dest = path.join(DONE, f), n = 1
      while (fs.existsSync(dest)) dest = path.join(DONE, f.replace(EXT, `_${n++}$&`))
      try { fs.renameSync(src, dest) } catch (e) { console.log(`   (원본을 처리됨 폴더로 옮기지 못했어요: ${e.code}. 다음에 다시 처리돼도 결과는 같아요)`) }
      ok++
      console.log(`✅ ${place.name} [${place.id}] ← ${f} (${Math.round(out.length / 1024)}KB)`)
    } catch (e) {
      problems.push(`⚠️ ${f} → 사진을 읽을 수 없어요 (${e.message}). 다른 형식으로 저장해 보세요.`)
    }
  }
  writeCredits(credits)
  console.log(`\n${ok}장 반영. 총 사진 ${Object.keys(credits).length}장`)
  if (problems.length) console.log('\n' + problems.join('\n'))
}
await writeList(places, credits)
