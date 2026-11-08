import { expect, test } from '@playwright/test'
import { OptionSeed } from '../support/OptionSeed'
import { PlanDates } from '../support/PlanDates'
import { MySqlTestData } from '../support/TestData'
import { WishListScreen } from '../support/WishListScreen'

const data = new MySqlTestData()

test.beforeEach(async () => {
  await data.reset()
})

test.afterAll(async () => {
  await data.close()
})

test('空のときは案内と提案画面へのリンクを出す', async ({ page }) => {
  const screen = new WishListScreen(page)
  await screen.open()
  const link = page.getByRole('link', { name: '提案から追加してみよう' })
  await link.click()
  await expect(page).toHaveURL('/suggestions')
})

test('追加したものはリストの先頭に入り、再読み込みしても残る', async ({ page }) => {
  const screen = new WishListScreen(page)
  await screen.open()
  await screen.add('朝日を見に行く')
  await screen.add('  陶芸体験  ')
  expect(await screen.titles()).toEqual(['陶芸体験', '朝日を見に行く'])

  await screen.open()
  expect(await screen.titles()).toEqual(['陶芸体験', '朝日を見に行く'])
})

test('空白だけのタイトルでは追加できず、キャンセルすると何も増えない', async ({ page }) => {
  const screen = new WishListScreen(page)
  await screen.open()
  const dialog = await screen.openAddDialog()
  const input = dialog.getByRole('textbox', { name: 'タイトル' })
  const submit = dialog.getByRole('button', { name: '追加', exact: true })
  await expect(submit).toBeDisabled()
  await input.fill(' 　 ')
  await expect(submit).toBeDisabled()

  const cancel = dialog.getByRole('button', { name: 'キャンセル' })
  await cancel.click()
  await expect(dialog).toBeHidden()
  await expect(page.getByText('まだ何もありません')).toBeVisible()
})

test('「今日はこれどう？」に自分のリストから 1 件が出て、引き直すと別のものに変わる', async ({ page }) => {
  const screen = new WishListScreen(page)
  await screen.open()
  await screen.add('朝日を見に行く')
  await expect(page.getByRole('region', { name: '今日はこれどう？' })).toBeHidden()
  await screen.add('陶芸体験')
  await screen.add('カヌーに乗る')

  // 追加しても選び直さないので、開き直して選ばせる
  await screen.open()
  const first = await screen.todayPick()
  expect(await screen.titles()).toContain(first)
  await screen.pickAnother()
  await expect(page.locator('[data-today-pick]')).not.toHaveText(first)
})

test('予定日がないカードを取っ手で並べ替えると、再読み込みしても順番が保たれる。予定日があるカードには取っ手がない', async ({ page, request }) => {
  const seed = new OptionSeed(request)
  for (const title of ['陶芸', '登山', '温泉', '釣り']) await seed.add(title)
  await seed.plan(await seed.firstPendingId(), new PlanDates().nextYear(1, 10))
  const screen = new WishListScreen(page)
  await screen.open()
  expect(await screen.titles()).toEqual(['釣り', '温泉', '登山', '陶芸'])
  await expect(screen.dragHandle('釣り')).toHaveCount(0)

  await screen.drag('陶芸', '温泉')
  await expect(screen.titleCells()).toHaveText(['釣り', '陶芸', '温泉', '登山'])
  const saved = expect.poll(() => seed.pendingTitles())
  await saved.toEqual(['釣り', '陶芸', '温泉', '登山'])

  await screen.open()
  expect(await screen.titles()).toEqual(['釣り', '陶芸', '温泉', '登山'])
})

test('取っ手はキーボードでも動かせ、予定日があるカードは飛び越えない', async ({ page, request }) => {
  const seed = new OptionSeed(request)
  for (const title of ['陶芸', '登山', '温泉', '釣り']) await seed.add(title)
  await seed.plan(await seed.firstPendingId(), new PlanDates().nextYear(1, 10))
  const screen = new WishListScreen(page)
  await screen.open()
  const { keyboard } = page

  const handle = screen.dragHandle('陶芸')
  await handle.focus()
  // dnd-kit は持ち上げと 1 段ごとの移動を次のコマで行うので、持ち上がったこと・動いたこと（読み上げの文）を待ってから次のキーを押す
  const announcer = page.locator('[id^="DndLiveRegion"]')
  await keyboard.press('Space')
  await expect(handle).toHaveAttribute('aria-pressed', 'true')
  // 持ち上げた直後は、印が付いてもキーの受け口がまだ付いていないことがある（遅い CI で 1 回目の矢印が消えた）。動くまで押し直す
  const firstMove = expect(async () => {
    await keyboard.press('ArrowUp')
    await expect(announcer).toContainText('「登山」の位置へ', { timeout: 1000 })
  })
  await firstMove.toPass()
  await keyboard.press('ArrowUp')
  await expect(announcer).toContainText('「温泉」の位置へ')
  // 予定日がある「釣り」の上へは動かない
  await keyboard.press('ArrowUp')
  await keyboard.press('Space')
  await expect(screen.titleCells()).toHaveText(['釣り', '陶芸', '温泉', '登山'])
  const saved = expect.poll(() => seed.pendingTitles())
  await saved.toEqual(['釣り', '陶芸', '温泉', '登山'])
})
