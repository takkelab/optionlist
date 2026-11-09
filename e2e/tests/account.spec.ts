import { expect, test } from '@playwright/test'
import { AccountScreen } from '../support/AccountScreen'
import { PgTestData } from '../support/TestData'
import { WishListScreen } from '../support/WishListScreen'

// testing.md §5 のシナリオ 12・13（screens.md §9）。復旧コードで別のブラウザに引き継ぐ・すべてのデータを消す
const data = new PgTestData()

test.beforeEach(async () => {
  await data.reset()
})

test.afterAll(async () => {
  await data.close()
})

test('A の復旧コードを B が入れると、B に A の一覧が出て、A は空になる', async ({ page, browser, baseURL, viewport }) => {
  const aList = new WishListScreen(page)
  await aList.open()
  await aList.add('A のやりたいこと')
  const code = await new AccountScreen(page).showRecoveryCode()
  expect(code).toMatch(/^[2-9A-HJKMNP-Z]{4}(-[2-9A-HJKMNP-Z]{4}){3}$/)

  const other = await browser.newContext({ baseURL, viewport, isMobile: true, hasTouch: true, locale: 'ja-JP' })
  try {
    const bPage = await other.newPage()
    const bList = new WishListScreen(bPage)
    await bList.open()
    // B にも自分の項目があるので、置き換えの確認が出る（AccountScreen が「置き換える」を押す）
    await bList.add('B のやりたいこと')
    const bAccount = new AccountScreen(bPage)
    await bAccount.restore(code.toLowerCase())
    await expect(bList.titleCells()).toHaveText(['A のやりたいこと'])
    await expect(bAccount.toast()).toHaveText('引き継ぎました。前の端末では使えなくなりました')
    await bList.open()
    await expect(bList.titleCells()).toHaveText(['A のやりたいこと'])
  } finally {
    await other.close()
  }

  // A の Cookie は鍵が変わったので無効になり、アカウントがない状態（空の一覧）になる
  await aList.open()
  expect(await aList.titles()).toEqual([])
})

test('やりたいことが 5 件になると勧めるカードが出て、設定のシートでコードを控えると消える', async ({ page }) => {
  const list = new WishListScreen(page)
  await list.open()
  for (let i = 1; i <= 5; i++) await list.add(`やりたいこと ${i}`)
  const card = page.getByRole('region', { name: '復旧コードを控える' })
  await expect(card).toBeVisible()
  await new AccountScreen(page).showRecoveryCode()
  await expect(card).toBeHidden()
  await list.open()
  await expect(card).toBeHidden()
})

test('すべてのデータを消すと、一覧が空になり、読み直しても空のまま', async ({ page }) => {
  const list = new WishListScreen(page)
  await list.open()
  await list.add('消えるやりたいこと')
  const account = new AccountScreen(page)
  await account.removeAll()
  await expect(account.toast()).toHaveText('すべてのデータを消しました')
  await expect(page.getByText('まだ何もありません')).toBeVisible()
  await list.open()
  expect(await list.titles()).toEqual([])
  // アカウントがないので、設定のシートには「まだ何も保存されていません」が出る
  const sheet = await account.openSettings()
  await expect(sheet.getByText('まだ何も保存されていません')).toBeVisible()
})
