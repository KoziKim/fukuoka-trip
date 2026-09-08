// 사진 넣을 장소 목록을 photos-inbox/사진목록.html 로 만든다.
//   npm run photos:list
// 브라우저로 열면 장소마다 [지도 열기] → 사진 저장 → 파일 이름 복사 순서로 진행할 수 있다.
import fs from 'node:fs'
import path from 'node:path'
import { INBOX, OUT, loadPlaces, readCredits, photoStatus } from './photo-lib.mjs'

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const gmap = name => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name.replace(/^🏨 /, '') + ' 福岡')}`
/** 파일 이름으로 쓰기 좋은 형태 — Windows 에서 못 쓰는 글자만 뺀다 */
const safeName = name => name.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim()

export async function writeList(places, credits) {
  const order = { '없음': 0, '메뉴 예시': 1, '위키 사진': 2, '우리 사진': 3 }
  const rows = places.map(p => ({ ...p, st: photoStatus(credits, p.id) }))
  const groups = [['맛집', rows.filter(r => r.kind === '맛집')], ['명소·쇼핑', rows.filter(r => r.kind === '명소')], ['기타', rows.filter(r => r.kind !== '맛집' && r.kind !== '명소')]]
  const cnt = st => rows.filter(r => r.st === st).length
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>후쿠오카 수첩 · 사진 넣기 목록</title>
<style>
body{font-family:system-ui,'Malgun Gothic',sans-serif;margin:24px;color:#222;max-width:1100px}
h1{font-size:20px} h2{font-size:16px;margin-top:28px;border-bottom:2px solid #eee;padding-bottom:6px}
.how{background:#f6f4ee;border-radius:10px;padding:12px 16px;font-size:14px;line-height:1.7}
.how code{background:#fff;padding:1px 6px;border-radius:4px}
.sum{margin:12px 0;font-size:14px} .sum b{margin-right:14px}
table{border-collapse:collapse;width:100%;font-size:13.5px} th,td{border-bottom:1px solid #eee;padding:7px 8px;text-align:left;vertical-align:middle}
th{background:#fafafa;font-size:12.5px;color:#666}
img{width:96px;height:72px;object-fit:cover;border-radius:6px;background:#eee;display:block}
.st{font-size:12px;padding:2px 8px;border-radius:999px;white-space:nowrap}
.st0{background:#ffe3e3;color:#a00} .st1{background:#fff2cc;color:#7a5a00} .st2{background:#e6f0ff;color:#245} .st3{background:#e3f7e6;color:#1a6b2a}
button{font-size:12px;padding:4px 9px;border:1px solid #bbb;border-radius:6px;background:#fff;cursor:pointer} button:active{background:#eee}
.fn{font-family:Consolas,monospace;font-size:12.5px;color:#333}
a{color:#2F4E7E}
tr.hide{display:none}
</style></head><body>
<h1>📷 후쿠오카 수첩 · 사진 넣기 목록</h1>
<div class="how">
① 아래 표에서 <b>지도 열기</b>를 눌러 구글 지도에서 사진을 하나 고르고 저장합니다 (오른쪽 클릭 → 이미지를 다른 이름으로 저장).<br>
② 저장할 때 파일 이름을 표의 <b>파일 이름</b>대로 넣습니다 (복사 버튼). 확장자는 jpg·png·webp·heic 아무거나 됩니다.<br>
③ 파일을 이 폴더에 넣습니다: <code>${esc(INBOX)}</code><br>
④ 다 넣었으면 저에게 "사진 넣었어"라고 하거나, 터미널에서 <code>npm run photos</code> 를 실행하면 앱에 반영됩니다.
</div>
<div class="sum"><b>전체 ${rows.length}곳</b> <span class="st st0">없음 ${cnt('없음')}</span> <span class="st st1">메뉴 예시 ${cnt('메뉴 예시')}</span> <span class="st st2">위키 사진 ${cnt('위키 사진')}</span> <span class="st st3">우리 사진 ${cnt('우리 사진')}</span>
&nbsp; <label><input type="checkbox" id="onlyNeed"> 우리 사진 없는 곳만 보기</label></div>
${groups.map(([title, list]) => `<h2>${esc(title)} (${list.length})</h2>
<table><thead><tr><th>지금 사진</th><th>장소</th><th>상태</th><th>파일 이름 (이걸로 저장)</th><th></th></tr></thead><tbody>
${list.sort((a, b) => order[a.st] - order[b.st]).map(r => `<tr data-st="${order[r.st]}">
<td>${fs.existsSync(path.join(OUT, r.id + '.webp')) ? `<img src="../public/photos/${r.id}.webp?v=${Date.now()}" alt="">` : '<div style="width:96px;height:72px;border-radius:6px;background:#f2f2f2"></div>'}</td>
<td><b>${esc(r.name)}</b><br><span style="color:#777;font-size:12px">${esc(r.area || '')}${r.cat ? ' · ' + esc(r.cat) : ''}</span></td>
<td><span class="st st${order[r.st]}">${r.st}</span></td>
<td><span class="fn" id="fn-${r.id}">${esc(safeName(r.name.replace(/^🏨 /, '')))}</span> <button onclick="cp('fn-${r.id}',this)">복사</button><br><span style="color:#999;font-size:11px">또는 ${r.id}</span></td>
<td><a href="${gmap(r.name)}" target="_blank" rel="noopener">지도 열기 ↗</a></td>
</tr>`).join('')}
</tbody></table>`).join('')}
<script>
function cp(id,b){navigator.clipboard.writeText(document.getElementById(id).textContent).then(()=>{b.textContent='복사됨';setTimeout(()=>b.textContent='복사',1200)})}
document.getElementById('onlyNeed').addEventListener('change',e=>{document.querySelectorAll('tr[data-st]').forEach(tr=>tr.classList.toggle('hide',e.target.checked&&tr.dataset.st==='3'))})
</script>
</body></html>`
  fs.mkdirSync(INBOX, { recursive: true })
  const file = path.join(INBOX, '사진목록.html')
  fs.writeFileSync(file, html)
  console.log(`목록: ${file}`)
  return file
}

if (process.argv[1] && /photo-list\.mjs$/.test(process.argv[1])) {
  await writeList(await loadPlaces(), readCredits())
}
