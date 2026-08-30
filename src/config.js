// 공유 기능 설정. 값이 비어 있으면 앱은 이 기기에만 저장하는 단독 모드로 동작한다.
// 빌드할 때 GitHub Actions의 저장소 변수(Variables)에서 주입된다.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || ''
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || ''
export const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY || ''

export const cloudConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)
export const pushConfigured = Boolean(cloudConfigured && VAPID_PUBLIC_KEY)
