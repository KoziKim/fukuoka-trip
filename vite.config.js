import { defineConfig } from 'vite'

// base './' → GitHub Pages 하위 경로(/repo-name/)에서도 동작
export default defineConfig({
  base: './',
})
