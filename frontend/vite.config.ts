import { minimal2023Preset } from '@vite-pwa/assets-generator/config'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// /api へのリクエストは backend に転送する（開発時に CORS 設定を不要にするため）
// E2E は普段の backend（8000）と別のポートで動かすので、転送先を BACKEND_URL で変えられるようにする（testing.md §5）
// preview.proxy を書かなければ vite preview も同じ転送先を使う
const backend = process.env.BACKEND_URL ?? 'http://localhost:8000'

// 背景の色（tokens.css の --color-surface。body の背景。docs/decisions/0024）。起動の画面とブラウザの枠の色に使う
const SURFACE = '#f2f2f7'

// PWA（screens.md §10、docs/decisions/0032・0052）
// - 先にキャッシュするのは画面の殻（JS・CSS・アイコン）だけ。index.html は入れず、画面の移動は通信を先に試す
//   （noindex の有無など、サーバーが差し込むものを古いまま残さないため）。通信できないときだけ、前に開いた画面を出す
// - /api はキャッシュしない（共有の端末に他人のリストを残さないため。0032）
// - 新しい版は、待たせて次に開いたときに切り替える（skipWaiting しない。「更新があります」は出さない）
// - アイコンの PNG は、ビルドのときに public/favicon.svg（白地に虹の輪。安全域に収めてあるので余白は足さない）から作る
const pwa = VitePWA({
  registerType: 'prompt',
  injectRegister: 'script-defer',
  pwaAssets: {
    image: 'public/favicon.svg',
    preset: {
      ...minimal2023Preset,
      transparent: { ...minimal2023Preset.transparent, padding: 0 },
      maskable: { ...minimal2023Preset.maskable, padding: 0 },
      apple: { ...minimal2023Preset.apple, padding: 0 },
    },
    overrideManifestIcons: true,
  },
  manifest: {
    name: 'OptionList',
    short_name: 'OptionList',
    lang: 'ja',
    display: 'standalone',
    start_url: '/',
    scope: '/',
    theme_color: SURFACE,
    background_color: SURFACE,
  },
  workbox: {
    globPatterns: ['**/*.{js,css,svg,png,ico,woff2}'],
    navigateFallback: null,
    clientsClaim: true,
    // /api/ 以外の要求を通信優先にする。JS・CSS・アイコンは先にキャッシュしたものが先に当たるので、
    // ここに来るのは画面の移動（/・/done・/privacy など）だけ。/api/（写真の <img> を含む）は当てず、キャッシュしない。
    // 正規表現は別のオリジンにも当たるが、画面は外のものを読まない（docs/decisions/0038）。外を読むようになったら絞る
    // 版が変わった直後は、新しい JS などもここを通って入るので、件数で古いものから消す
    runtimeCaching: [
      {
        urlPattern: /^https?:\/\/[^/]+\/(?!api\/)/,
        handler: 'NetworkFirst',
        options: { cacheName: 'pages', expiration: { maxEntries: 20 } },
      },
    ],
  },
})

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), pwa],
  server: {
    proxy: {
      // Host は書き換えない（文字列だけで書くと Vite は changeOrigin: true にする）。backend は、手元では
      // 書き込みの Origin を Host と比べるので、画面のオリジン（5173・4174・dev:lan の IP）のまま届ける（api.md §1。docs/decisions/0050）
      '/api': { target: backend, changeOrigin: false },
    },
  },
})
