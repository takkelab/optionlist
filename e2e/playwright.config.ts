import { defineConfig } from '@playwright/test'

// E2E（testing.md §5）。backend はテスト用 DB（backend/.env.test）に向けて起動し、通信は差し替えない
// 普段の開発（backend 8000・frontend 5173）と並べて動かせるよう、別のポートを使う
// frontend は本番に近い形で LCP を測るため、ビルド済みのものを vite preview で出す（npm run test:e2e が先にビルドする）
const BACKEND_PORT = 8100
const FRONTEND_PORT = 4174

export default defineConfig({
  testDir: 'tests',
  // 不安定なテストを見逃さないよう、リトライしない（metrics.md §2）
  retries: 0,
  // テスト用 DB を共有するので 1 本ずつ流す
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  reporter: [['list'], ['json', { outputFile: 'results/report.json' }]],
  outputDir: 'test-results',
  use: {
    baseURL: `http://localhost:${FRONTEND_PORT}`,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    locale: 'ja-JP',
    // page.request の種まきは Origin を付けないので、画面と同じオリジンを付ける（backend の Origin の確認。api.md §1）
    extraHTTPHeaders: { Origin: `http://localhost:${FRONTEND_PORT}` },
    trace: 'retain-on-failure',
    // Service Worker は止めておく。画面の殻のキャッシュがほかのテストに混ざらないように。
    // 確かめるのは pwa.spec だけ（test.use で許す。docs/decisions/0052）
    serviceWorkers: 'block',
  },
  webServer: [
    {
      command: 'npx tsx --env-file=.env.test src/server.ts',
      cwd: '../backend',
      // 写真は普段の backend/uploads に混ぜない（e2e/results は git に含めない）
      env: { PORT: String(BACKEND_PORT), UPLOAD_DIR: '../e2e/results/uploads' },
      url: `http://localhost:${BACKEND_PORT}/api/health`,
      reuseExistingServer: false,
      stdout: 'pipe',
    },
    {
      command: `npx vite preview --port ${FRONTEND_PORT} --strictPort`,
      cwd: '../frontend',
      env: { BACKEND_URL: `http://localhost:${BACKEND_PORT}` },
      url: `http://localhost:${FRONTEND_PORT}`,
      reuseExistingServer: false,
    },
  ],
})
