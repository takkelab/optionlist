import { expect, test } from '@playwright/test'
import { LayoutProbe } from '../support/LayoutProbe'
import { OptionSeed } from '../support/OptionSeed'
import { SuggestionData, SuggestionsScreen } from '../support/SuggestionsScreen'
import { PgTestData } from '../support/TestData'
import { WishListScreen } from '../support/WishListScreen'

// screens.md §1（docs/decisions/0024）: 広い画面では中身を 960px までの列にして中央に置き、タブバー・「＋」も列に合わせる。
// 提案のテーマの色（--theme-color）がカードと行に付く
const data = new PgTestData()
const PC = { width: 1280, height: 800 }
const COLUMN = 960
const COLUMN_LEFT = (PC.width - COLUMN) / 2
const COLUMN_RIGHT = COLUMN_LEFT + COLUMN

test.beforeEach(async () => {
  await data.reset()
})

test.afterAll(async () => {
  await data.close()
})

const probe = new LayoutProbe()
const THEME_COLOR = '--theme-color'

test.describe('PC の幅', () => {
  test.use({ viewport: PC, isMobile: false, hasTouch: false })

  test('中身・タブバー・「＋」は中央の列に収まる', async ({ page, request }) => {
    const seed = new OptionSeed(request)
    await seed.add('やりたいこと 1')
    await seed.add('やりたいこと 2')
    const wish = new WishListScreen(page)
    await wish.open()

    const cells = wish.titleCells()
    const card = await probe.edges(cells.first())
    const tabs = await probe.edges(page.getByRole('navigation', { name: '画面の切り替え' }))
    const fab = await probe.edges(page.getByRole('button', { name: 'やりたいことを追加' }))
    for (const { left, right } of [card, tabs, fab]) {
      expect(left).toBeGreaterThanOrEqual(COLUMN_LEFT)
      expect(right).toBeLessThanOrEqual(COLUMN_RIGHT)
    }
    // 列の中央に置く（タブバーは列の左右に同じだけ余白を取る）
    expect(Math.abs(tabs.left - COLUMN_LEFT - (COLUMN_RIGHT - tabs.right))).toBeLessThanOrEqual(1)
  })

  test('棚は ‹ › で横に送れる。まだ送れる側にだけ矢印が出る', async ({ page, request }) => {
    const { themes } = await new SuggestionData(request).catalog()
    const [theme] = themes
    if (theme === undefined) throw new Error('テーマがない')
    const screen = new SuggestionsScreen(page)
    await screen.openExplore()
    const prev = page.getByRole('button', { name: `${theme.name}の前へ` })
    const next = page.getByRole('button', { name: `${theme.name}の次へ` })
    await expect(next).toBeVisible()
    await expect(prev).toBeHidden()

    await next.click()
    await expect(prev).toBeVisible()
    await prev.click()
    await expect(prev).toBeHidden()
  })
})

test('スマホ（指で触る端末）では、棚の矢印を出さない', async ({ page, request }) => {
  const { themes } = await new SuggestionData(request).catalog()
  const [theme] = themes
  if (theme === undefined) throw new Error('テーマがない')
  const screen = new SuggestionsScreen(page)
  await screen.openExplore()
  await expect(page.getByRole('button', { name: `${theme.name}の次へ` })).toBeHidden()
})

test('提案のカードと行に、テーマの色が付く。今日すぐできるはテーマごとに色が違う', async ({ page }) => {
  const screen = new SuggestionsScreen(page)
  await screen.openExplore()
  const quick = screen.list('今日すぐできる')
  const quickCards = quick.getByRole('link')
  const first = await probe.customProperty(quickCards.nth(0), THEME_COLOR)
  const second = await probe.customProperty(quickCards.nth(1), THEME_COLOR)
  expect(first).not.toBe('')
  expect(second).not.toBe('')
  expect(first).not.toBe(second)

  await page.goto('/suggestions/themes/1')
  await screen.waitForRows()
  const rows = screen.rows()
  expect(await probe.customProperty(rows.first(), THEME_COLOR)).toBe(first)
})
