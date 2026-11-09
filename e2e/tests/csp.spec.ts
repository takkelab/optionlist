import { expect, test } from '@playwright/test'
import { PgTestData } from '../support/TestData'
import { WishListScreen } from '../support/WishListScreen'

// 画面は CSP などのヘッダー（architecture.md §4.3。docs/decisions/0038）が効いた状態で動く（testing.md §5。docs/decisions/0054）
// ほかのシナリオも同じヘッダーの下で流れるが、ここでは違反が 1 件も起きないことを数える
// （Chromium は違反を「Refused to … Content Security Policy …」のコンソールのエラーで出す。ページを移っても数え続けられる）
const data = new PgTestData()

test.beforeEach(async () => {
  await data.reset()
})

test.afterAll(async () => {
  await data.close()
})

test('画面に CSP が付き、一覧・追加・提案・ポリシーを開いても CSP の違反が起きない', async ({ page }) => {
  const violations: string[] = []
  page.on('console', (message) => {
    const text = message.text()
    if (text.includes('Content Security Policy')) violations.push(text)
  })
  const response = await page.goto('/')
  const headers = response === null ? {} : response.headers()
  expect(headers).toHaveProperty('content-security-policy', expect.stringContaining("default-src 'self'"))
  const list = new WishListScreen(page)
  await list.waitUntilLoaded()
  await list.add('星を見に行く')
  await expect(list.titleCells()).toHaveText(['星を見に行く'])
  await page.goto('/suggestions')
  await expect(page.getByRole('navigation', { name: '画面の切り替え' })).toBeVisible()
  await page.goto('/privacy')
  await expect(page.getByRole('heading', { name: 'プライバシーポリシー', level: 1 })).toBeVisible()
  expect(violations).toEqual([])
})
