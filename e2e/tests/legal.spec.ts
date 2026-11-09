import { expect, test } from '@playwright/test'
import { AccountScreen } from '../support/AccountScreen'
import { OptionSeed } from '../support/OptionSeed'
import { PgTestData } from '../support/TestData'
import { WishListScreen } from '../support/WishListScreen'

// testing.md §5 のシナリオ 14 の後半（screens.md §2・§9・§10、docs/decisions/0039・0052）
const data = new PgTestData()
const NOTE = '追加すると、この端末用の保存場所が作られます。'

test.beforeEach(async () => {
  await data.reset()
})

test.afterAll(async () => {
  await data.close()
})

test.describe('URL を直接開く', () => {
  for (const [path, title] of [
    ['/privacy', 'プライバシーポリシー'],
    ['/terms', '利用規約'],
  ] as const) {
    test(`${path} が開け、タブバーがなく、戻るでやりたいリストへ移る`, async ({ page }) => {
      await page.goto(path)
      await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible()
      // 運営者の欄（本文にも名前が出るので、欄の値だけに当てる）
      await expect(page.getByText('takkelab', { exact: true })).toBeVisible()
      await expect(page.getByRole('navigation', { name: '画面の切り替え' })).toHaveCount(0)
      const back = page.getByRole('button', { name: '戻る' })
      await back.click()
      await expect(page).toHaveURL('/')
    })
  }
})

test('一覧をスクロールしたまま設定のシートのリンクで開くと、ページは先頭から出て、ブラウザの戻る 1 回で一覧に戻る', async ({ page }) => {
  // 種まきの API はブラウザと同じ Cookie（同じ人）で呼ぶ（api.md §6）
  const seed = new OptionSeed(page.request)
  for (let i = 1; i <= 20; i++) await seed.add(`やりたいこと ${i}`)
  const list = new WishListScreen(page)
  await list.open()
  // 下までスクロールしてから少し戻し、引っ込んだヘッダー（⚙）を降ろす（screens.md §1）
  await list.scrollBy(3000)
  await list.scrollBy(-100)
  const account = new AccountScreen(page)
  const settings = await account.openSettings()
  const privacy = settings.getByRole('link', { name: 'プライバシーポリシー' })
  await privacy.click()
  await expect(page).toHaveURL('/privacy')
  await expect(page.getByRole('heading', { name: 'はじめに' })).toBeInViewport()
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
  await page.goBack()
  await expect(page).toHaveURL('/')
  await expect(page.getByRole('dialog', { name: '設定' })).toBeHidden()
  await expect(list.titleCells()).toHaveCount(20)
})

test('やったリストから開くと、ページの戻るボタンでもブラウザの戻るでも、やったリストに戻る', async ({ page }) => {
  await page.goto('/done')
  await expect(page.getByText('🎉 を押して、やったことをここに集めよう')).toBeVisible()
  const account = new AccountScreen(page)
  const settings = await account.openSettings()
  const terms = settings.getByRole('link', { name: '利用規約' })
  await terms.click()
  await expect(page.getByRole('heading', { name: '利用規約', level: 1 })).toBeVisible()
  const back = page.getByRole('button', { name: '戻る' })
  await back.click()
  await expect(page).toHaveURL('/done')
  await expect(page.getByRole('dialog', { name: '設定' })).toBeHidden()

  const again = await account.openSettings()
  const privacy = again.getByRole('link', { name: 'プライバシーポリシー' })
  await privacy.click()
  await expect(page).toHaveURL('/privacy')
  await page.goBack()
  await expect(page).toHaveURL('/done')
})

test('アカウントがないときだけ、追加ダイアログに保存場所の注記とポリシーへのリンクが出る', async ({ page }) => {
  const list = new WishListScreen(page)
  await list.open()
  const dialog = await list.openAddDialog()
  await expect(dialog.getByText(NOTE)).toBeVisible()
  await expect(dialog.getByRole('link', { name: 'プライバシーポリシー' })).toHaveAttribute('href', '/privacy')
  const cancel = dialog.getByRole('button', { name: 'キャンセル' })
  await cancel.click()
  await dialog.waitFor({ state: 'hidden' })

  // 最初の追加でアカウントができる（api.md §6）。開き直すと、アカウントの状態を読み終えても注記は出ない
  await list.add('星を見に行く')
  const read = page.waitForResponse((res) => new URL(res.url()).pathname === '/api/account')
  const reopened = await list.openAddDialog()
  await read
  await expect(reopened.getByText(NOTE)).toHaveCount(0)
})
