# 후쿠오카 수첩 🏮

후쿠오카 여행 맛집·일정·이동시간·꿀팁·준비물을 한 곳에서 정리하는 여행 플래너 PWA.

## 기능

- **맛집 리스트** — 기본 맛집 33곳(인기 맛집 + 우리 픽), 분류 필터, 즐겨찾기/다녀옴, 직접 추가·수정
- **숙소·이동시간** — 숙소 좌표 기준으로 공항·맛집·명소까지 도보/지하철/택시 예상 시간 (후쿠오카 지하철 3개 노선 그래프 내장)
- **여행 계획표** — 일차·시간대별 일정, 연속 장소 간 이동시간 자동 계산, D-day
- **꿀팁** — 공항·교통·환전·면세·먹거리 정보 + 내 팁 추가
- **준비** — 준비물 체크리스트, 환율 계산기, 경비 기록, 데이터 내보내기/가져오기
- **PWA** — 폰 홈 화면에 설치 가능, 오프라인 동작 (여행 중 지하철에서도 열림)

데이터는 브라우저 localStorage에 저장됩니다. 기기 간 이동은 준비 탭의 내보내기/가져오기를 사용하세요.

## 개발

```bash
npm install
npm run dev      # 개발 서버
npm run build    # dist/ 빌드
npm run preview  # 빌드 미리보기
```

## 배포

`main`(또는 작업 브랜치)에 push하면 GitHub Actions가 자동으로 빌드해서 GitHub Pages로 배포합니다
(`.github/workflows/deploy.yml`). 저장소 Settings → Pages → Source를 **GitHub Actions**로 설정해야 합니다.

## 친구들과 함께 쓰기 (Supabase 연결)

연결하기 전까지는 데이터가 각자 브라우저에만 저장됩니다. 아래를 끝내면 일정이 실시간으로 공유되고,
일정마다 코멘트를 달 수 있으며, 코멘트가 달리면 다른 사람에게 푸시 알림이 갑니다.

**1. 프로젝트 만들기** — [supabase.com](https://supabase.com)에서 새 프로젝트 생성 (무료 플랜, 카드 불필요).

**2. 스키마 적용** — 대시보드 → SQL Editor에 `supabase/schema.sql` 전체를 붙여넣고 실행.

**3. 익명 로그인 켜기** — Authentication → Sign In / Providers → **Anonymous sign-ins** 활성화.
(이름 + 초대코드 방식이라 사용자에게는 보이지 않지만, 내부적으로 기기별 신원을 만들어 RLS로 본인 여행만 접근하게 합니다.)

**4. 키 등록** — Project Settings → API에서 값을 복사해, GitHub 저장소
Settings → Secrets and variables → **Actions → Variables**에 다음을 추가합니다.

| 이름 | 값 |
|---|---|
| `VITE_SUPABASE_URL` | Project URL |
| `VITE_SUPABASE_ANON_KEY` | anon public key |
| `VITE_VAPID_PUBLIC_KEY` | 푸시용 공개키 (아래 5단계) |

anon key는 브라우저에 노출되는 것이 정상입니다. 실제 보호는 RLS 정책이 합니다.

**5. 푸시 알림** — `npx web-push generate-vapid-keys`로 키 쌍을 만든 뒤:

```bash
supabase functions deploy notify --no-verify-jwt
supabase secrets set VAPID_PUBLIC_KEY=<공개키> VAPID_PRIVATE_KEY=<비밀키> \
  VAPID_SUBJECT=mailto:you@example.com APP_URL=https://<사용자>.github.io/fukuoka-trip/
```

그 다음 `supabase/schema.sql` 맨 아래 주석 처리된 트리거 블록에서 프로젝트 참조 id와 service_role 키를
채워 SQL Editor에서 실행하면, 코멘트가 달릴 때마다 알림이 발송됩니다.

> 아이폰은 사파리에서 **홈 화면에 추가**한 뒤에야 웹 푸시를 받을 수 있습니다 (iOS 16.4 이상).

**6. 사용** — 메뉴 탭 → 함께 쓰기 → *여행 만들기* 로 초대코드를 받고, 친구들은 *초대코드로 참가*.

## 참고

이동시간은 직선거리·노선도 기반 추정치입니다. 실제 시간은 구글맵으로 확인하세요.
