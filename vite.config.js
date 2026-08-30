import { defineConfig } from 'vite'

// 빌드마다 바뀌는 값. 앱이 이 값과 version.json 을 비교해 새 버전을 감지한다.
const BUILD_ID = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14)

export default defineConfig({
  // base './' → GitHub Pages 하위 경로(/repo-name/)에서도 동작
  base: './',
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [
    {
      name: 'emit-version',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'version.json',
          source: JSON.stringify({ build: BUILD_ID }),
        })
      },
    },
  ],
})
