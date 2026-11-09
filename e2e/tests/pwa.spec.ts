import { expect, test } from '@playwright/test'
import { OptionSeed } from '../support/OptionSeed'
import { PgTestData } from '../support/TestData'
import { WishListScreen } from '../support/WishListScreen'

// testing.md §5 のシナリオ 14（screens.md §7・§10、docs/decisions/0032・0052）
// ほかのテストは Service Worker を止めている（playwright.config.ts）ので、ここでだけ許す
test.use({ serviceWorkers: 'allow' })

const data = new PgTestData()
const OFFLINE = '通信できませんでした。電波のよいところでもう一度お試しください'

test.beforeEach(async () => {
  await data.reset()
})

test.afterAll(async () => {
  await data.close()
})

test('SW は画面の移動を通信で取り直し、オフラインでは画面だけを出す。/api はキャッシュしない', async ({ page, context }) => {
  // 種まきの API はブラウザと同じ Cookie（同じ人）で呼ぶ（api.md §6）
  await new OptionSeed(page.request).add('海を見に行く')
  const list = new WishListScreen(page)
  await list.open()
  // SW が入り、この画面を受け持つまで待つ（初めて入ったときも clientsClaim で受け持つ）
  await page.waitForFunction(() => {
    const { serviceWorker } = navigator
    return serviceWorker.controller !== null
  })

  // 通信できるときの再読み込みでは、SW が画面（/）を通信で取り直す（キャッシュを先に出さない）
  const fromWorker: string[] = []
  context.on('request', (request) => {
    if (request.serviceWorker() !== null) fromWorker.push(new URL(request.url()).pathname)
  })
  await list.open()
  expect(fromWorker).toContain('/')
  await expect(list.titleCells()).toHaveText(['海を見に行く'])

  // オフラインで再読み込みすると、画面の殻はキャッシュから出て、一覧は出ず、トーストが出る
  await context.setOffline(true)
  try {
    await page.reload()
    await expect(page.getByRole('heading', { name: 'やりたいこと', level: 1 })).toBeAttached()
    await expect(page.getByText(OFFLINE)).toBeVisible()
    await expect(list.titleCells()).toHaveCount(0)
  } finally {
    await context.setOffline(false)
  }

  const cached = await page.evaluate(async () => {
    const paths: string[] = []
    for (const name of await caches.keys()) {
      const cache = await caches.open(name)
      for (const request of await cache.keys()) paths.push(new URL(request.url).pathname)
    }
    return paths
  })
  expect(cached).toContain('/')
  // index.html は先にキャッシュしない（通信を先に試す。先にキャッシュするとキーは /index.html になる）
  expect(cached).not.toContain('/index.html')
  expect(cached.filter((path) => path.startsWith('/api/'))).toEqual([])
})

test('manifest に名前・standalone・アイコン（192・512・maskable）がある', async ({ page }) => {
  const { request } = page
  const res = await request.get('/manifest.webmanifest')
  expect(res.status()).toBe(200)
  const manifest = (await res.json()) as { name: string; display: string; start_url: string; icons: { sizes: string; purpose?: string }[] }
  expect(manifest).toMatchObject({ name: 'OptionList', display: 'standalone', start_url: '/' })
  const { icons } = manifest
  const kinds = icons.map((icon) => `${icon.sizes} ${icon.purpose ?? 'any'}`)
  expect(kinds).toEqual(expect.arrayContaining(['192x192 any', '512x512 any', '512x512 maskable']))
})
