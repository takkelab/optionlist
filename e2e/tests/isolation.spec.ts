import { expect, test } from '@playwright/test'
import { PgTestData } from '../support/TestData'
import { WishListScreen } from '../support/WishListScreen'

// testing.md §5 のシナリオ 11: 2 つのブラウザのコンテキスト（別々の Cookie）で、A の項目と写真が B から見えない（docs/decisions/0046）
const data = new PgTestData()
// backend は先頭のバイトで形式を見る（api.md §5）ので、JPEG の先頭だけのバイト列でよい
const PHOTO = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100)])

test.beforeEach(async () => {
  await data.reset()
})

test.afterAll(async () => {
  await data.close()
})

test('A が追加した項目と付けた写真は、別の Cookie の B には見えない', async ({ page, browser, baseURL, viewport }) => {
  // A は画面から追加する（最初の追加でアカウントと Cookie ができる。api.md §6）
  const aList = new WishListScreen(page)
  await aList.open()
  await aList.add('A のやりたいこと')
  await expect(aList.titleCells()).toHaveText(['A のやりたいこと'])
  // 写真は API で付ける（画面からの付け方は completion.spec.ts）。page.request は A と同じ Cookie
  const { request } = page
  const [option] = (await (await request.get('/api/options?status=pending')).json()) as { id: number }[]
  const achieved = await request.post(`/api/options/${option?.id}/achievements`)
  const { id: achievementId } = (await achieved.json()) as { id: number }
  const uploaded = await request.put(`/api/achievements/${achievementId}/photo`, {
    multipart: { photo: { name: 'a.jpg', mimeType: 'image/jpeg', buffer: PHOTO } },
  })
  expect(uploaded.status()).toBe(200)
  const { photoUrl } = (await uploaded.json()) as { photoUrl: string }
  const served = await request.get(photoUrl)
  expect(served.status()).toBe(200)

  const other = await browser.newContext({ baseURL, viewport, isMobile: true, hasTouch: true, locale: 'ja-JP' })
  try {
    const bPage = await other.newPage()
    const bList = new WishListScreen(bPage)
    await bList.open()
    expect(await bList.titles()).toEqual([])
    const { request: bRequest } = bPage
    const photo = await bRequest.get(photoUrl)
    const detail = await bRequest.get(`/api/options/${option?.id}`)
    expect([photo.status(), detail.status()]).toEqual([404, 404])
  } finally {
    await other.close()
  }

  // A の側は変わらない
  await aList.open()
  await expect(aList.titleCells()).toHaveText(['A のやりたいこと'])
})
