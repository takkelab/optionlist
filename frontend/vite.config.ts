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
      // Host は書き換えない（文字列だけで書くと Vite は changeOrigin: true にする）。backend は、手元では
      // 書き込みの Origin を Host と比べるので、画面のオリジン（5173・4174・dev:lan の IP）のまま届ける（api.md §1。docs/decisions/0050）
      '/api': { target: backend, changeOrigin: false },
    },
  },
})
