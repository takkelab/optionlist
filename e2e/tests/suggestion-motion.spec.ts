import { expect, test } from '@playwright/test'
import { OptionSheetScreen } from '../support/OptionSheetScreen'
import { SuggestionsScreen } from '../support/SuggestionsScreen'
import { PgTestData } from '../support/TestData'

// 提案の画面の動き（進む・戻るの滑り、追加ボタンの弾み。screens.md §1・§5、docs/decisions/0026・0027）
const data = new PgTestData()
// 今月のおすすめは端末の日付で決まるので、12 月に固定する（提案 1 は 12 月の「ふたご座流星群を見る」）
const DECEMBER = new Date('2026-12-10T10:00:00')
const GEMINIDS = 1

test.beforeEach(async ({ page }) => {
  await data.reset()
  const { clock } = page
  await clock.setFixedTime(DECEMBER)
})

test.afterAll(async () => {
  await data.close()
})

test('追加を押すと、すぐ塗られて ♡ が弾み粒がはじけ、それからシートが開く。視差効果を減らす設定では動かさない（docs/decisions/0027）', async ({ page }) => {
  const screen = new SuggestionsScreen(page)
  await screen.openSuggestion(GEMINIDS)
  const add = screen.addButton()
  const sheet = new OptionSheetScreen(page)

  await screen.add()
  const burst = expect.poll(() => screen.addMotions(), { intervals: [0, 20, 20, 50], timeout: 2000 })
  await burst.toEqual(expect.arrayContaining([expect.stringContaining('pop'), expect.stringContaining('burst')]))
  await expect(add).toHaveText('やりたいリストにあります')
  await expect(sheet.notice()).toHaveText('✓やりたいリストに入れました')
  const undo = sheet.button('取り消す')
  await undo.click()
  await expect(add).toHaveText('やりたいリストに追加')

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await screen.add()
  await expect(sheet.notice()).toHaveText('✓やりたいリストに入れました')
  expect(await screen.addMotions()).toEqual([])
})

test('提案を開くと右から入り、［‹］で戻ると左から戻ってスクロール位置も戻る。ブラウザの戻るでは動かさない（docs/decisions/0026）', async ({ page }) => {
  const screen = new SuggestionsScreen(page)
  await screen.openExplore()
  await screen.scrollToRow(40)
  const before = await screen.scrollY()
  // 動きは 0.26 秒ほどなので、押した直後から細かく読む
  const slides = { intervals: [0, 20, 20, 20, 20, 50], timeout: 2000 }

  await screen.openRow(40)
  const forward = expect.poll(() => screen.slideMotions(), slides)
  await forward.toEqual(expect.arrayContaining(['shift-to-left', 'slide-in-from-right']))
  await expect(screen.heading()).toBeVisible()
  const opened = expect.poll(() => screen.slideMotions())
  await opened.toEqual([])

  await screen.back()
  const back = expect.poll(() => screen.slideMotions(), slides)
  await back.toEqual(expect.arrayContaining(['slide-out-to-right', 'shift-from-left']))
  await expect(page).toHaveURL('/suggestions')
  const restored = expect.poll(() => screen.scrollY())
  await restored.toBe(before)
  const settled = expect.poll(() => screen.slideMotions())
  await settled.toEqual([])

  // ブラウザの戻る（iPhone の端からのスワイプなど）は、ブラウザ自身が動かすことがあるので、アプリは動かさない
  await screen.openRow(40)
  await expect(screen.heading()).toBeVisible()
  const openedAgain = expect.poll(() => screen.slideMotions())
  await openedAgain.toEqual([])
  await page.goBack()
  await expect(page).toHaveURL('/suggestions')
  expect(await screen.slideMotions()).toEqual([])

  // 視差効果を減らす設定では動かさない
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await screen.openRow(40)
  await expect(screen.heading()).toBeVisible()
  expect(await screen.slideMotions()).toEqual([])
})
