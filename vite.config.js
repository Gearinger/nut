import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // 本地 dev 用 /nut/；线上构建由 build:live 用 --base=./ 覆盖
  // （沿用 GitHub Pages 时期的子路径配置，直接上线会因资源 404 白屏）
  base: '/nut/',
  build: {
    // 分包：把稳定的第三方库拆出去，业务代码改动时这些 chunk 的 hash 不变，
    // 浏览器缓存能继续命中；maplibre 单独成块，配合按需加载不进首屏。
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('maplibre')) return 'maplibre'
          if (id.includes('@supabase')) return 'supabase'
          if (id.includes('react')) return 'react'
          return 'vendor'
        },
      },
    },
    // maplibre 单块本来就大（已按需加载、不在首屏），不必为此告警
    chunkSizeWarningLimit: 700,
  },
})
