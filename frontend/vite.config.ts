import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// /api へのリクエストは backend に転送する（開発時に CORS 設定を不要にするため）
// E2E は普段の backend（8000）と別のポートで動かすので、転送先を BACKEND_URL で変えられるようにする（testing.md §5）
// preview.proxy を書かなければ vite preview も同じ転送先を使う
const backend = process.env.BACKEND_URL ?? 'http://localhost:8000'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': backend,
    },
  },
})
