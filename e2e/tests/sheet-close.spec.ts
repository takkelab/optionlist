import { expect, test } from '@playwright/test'
import { OptionSeed } from '../support/OptionSeed'
import { OptionSheetScreen } from '../support/OptionSheetScreen'
import { PgTestData } from '../support/TestData'
import { WishListScreen } from '../support/WishListScreen'

// screens.md §3 の項目のシートの閉じ方（外・Esc・下へのスワイプ。docs/decisions/0016・0017）
const data = new PgTestData()

test.beforeEach(async () => {
  await data.reset()
})

test.afterAll(async () => {
  await data.close()
})

test('戻るではシートだけが閉じ、一覧の画面に残る。Esc で閉じたあとの戻るは、前の画面へ戻る（docs/decisions/0025）', async ({ page, request }) => {
  await new OptionSeed(request).add('朝日を見に行く')
  await page.goto('/suggestions')
  const list = new WishListScreen(page)
  await list.open()
  const sheet = new OptionSheetScreen(page)
  const opened = await sheet.openFromCard('朝日を見に行く')

  await page.goBack()
  await expect(opened).toBeHidden()
  await expect(page).toHaveURL('/')

  // ほかの閉じ方では積んだ履歴を消すので、次の戻るは空振りせずに前の画面へ戻る
  await sheet.openFromCard('朝日を見に行く')
  await sheet.close()
  await page.goBack()
  await expect(page).toHaveURL('/suggestions')
})

test('AI に相談を開いたまま戻ると、シートごと閉じて一覧を操作できる（docs/decisions/0025）', async ({ page, request }) => {
  await new OptionSeed(request).add('朝日を見に行く')
  await page.goto('/suggestions')
  const list = new WishListScreen(page)
  await list.open()
  const sheet = new OptionSheetScreen(page)
  const opened = await sheet.openFromCard('朝日を見に行く')
  const dialog = await sheet.openConsult()

  await page.goBack()
  await expect(dialog).toBeHidden()
  await expect(opened).toBeHidden()
  await expect(page).toHaveURL('/')
  // 見えないモーダルが残っていると、ここが押せない
  await sheet.openFromCard('朝日を見に行く')
  await expect(opened).toBeVisible()
})

test('シートは外を押す・Esc・下へスワイプすると閉じ、画面は一覧のまま。✕ は置かない。「今日はこれどう？」からも開ける', async ({ page, request }) => {
  const seed = new OptionSeed(request)
  await seed.add('朝日を見に行く')
  await seed.add('夕日を見に行く')
  const list = new WishListScreen(page)
  await list.open()
  const sheet = new OptionSheetScreen(page)
  const opened = await sheet.openFromCard('朝日を見に行く')
  await expect(page).toHaveURL('/')
  // パソコン（Playwright の既定は細かく指せるポインタ）でも ✕ は出さない
  await expect(opened.getByRole('button', { name: '閉じる' })).toHaveCount(0)
  const { mouse, keyboard } = page
  await mouse.click(10, 10)
  await expect(opened).toBeHidden()

  await sheet.openFromCard('朝日を見に行く')
  await keyboard.press('Escape')
  await expect(opened).toBeHidden()

  // 持ち手を 40px だけ引き、止めてから離すと閉じずに元の位置へ戻る（screens.md §3）
  await sheet.openFromCard('朝日を見に行く')
  const grip = opened.locator('[data-grip]')
  const box = await grip.boundingBox()
  const x = (box?.x ?? 0) + 20
  const y = (box?.y ?? 0) + 10
  await grip.dispatchEvent('touchstart', { touches: [{ identifier: 1, clientX: x, clientY: y }] })
  await grip.dispatchEvent('touchmove', { touches: [{ identifier: 1, clientX: x, clientY: y + 40 }] })
  // 指を止めている間は touchmove が来ない
  await page.waitForTimeout(200)
  await grip.dispatchEvent('touchend', { touches: [] })
  await expect(opened).toHaveCSS('transform', 'none')
  await expect(opened).toBeVisible()

  // 80px に届かなくても、素早く下へ払って離せば閉じる
  await grip.dispatchEvent('touchstart', { touches: [{ identifier: 1, clientX: x, clientY: y }] })
  await grip.dispatchEvent('touchmove', { touches: [{ identifier: 1, clientX: x, clientY: y + 60 }] })
  await grip.dispatchEvent('touchend', { touches: [] })
  await expect(opened).toBeHidden()

  // 持ち手を下へ 120px 引いて離す
  await sheet.openFromCard('朝日を見に行く')
  await grip.dispatchEvent('touchstart', { touches: [{ identifier: 1, clientX: x, clientY: y }] })
  await grip.dispatchEvent('touchmove', { touches: [{ identifier: 1, clientX: x, clientY: y + 120 }] })
  await page.waitForTimeout(200)
  await grip.dispatchEvent('touchend', { touches: [] })
  await expect(opened).toBeHidden()

  // 中身（予定日のあたり）からでも、下へスワイプすれば閉じる。横への動きでは引かない
  await sheet.openFromCard('朝日を見に行く')
  const plan = opened.getByRole('region', { name: '予定日' })
  const area = await plan.boundingBox()
  const px = (area?.x ?? 0) + 20
  const py = (area?.y ?? 0) + 10
  await plan.dispatchEvent('touchstart', { touches: [{ identifier: 1, clientX: px, clientY: py }] })
  await plan.dispatchEvent('touchmove', { touches: [{ identifier: 1, clientX: px + 120, clientY: py + 20 }] })
  await plan.dispatchEvent('touchmove', { touches: [{ identifier: 1, clientX: px + 120, clientY: py + 140 }] })
  await page.waitForTimeout(200)
  await plan.dispatchEvent('touchend', { touches: [] })
  await expect(opened).toHaveCSS('transform', 'none')
  await expect(opened).toBeVisible()
  await plan.dispatchEvent('touchstart', { touches: [{ identifier: 1, clientX: px, clientY: py }] })
  await plan.dispatchEvent('touchmove', { touches: [{ identifier: 1, clientX: px, clientY: py + 120 }] })
  await page.waitForTimeout(200)
  await plan.dispatchEvent('touchend', { touches: [] })
  await expect(opened).toBeHidden()

  const picked = await list.todayPick()
  const pick = page.getByRole('region', { name: '今日はこれどう？' })
  const open = pick.getByRole('button', { name: /今日はこれどう？/ })
  await open.click()
  await expect(opened.getByRole('heading', { level: 2 })).toHaveText(picked)
  await sheet.close()
  await expect(page).toHaveURL('/')
})

test('AI に相談・削除の確認の中で下へスワイプしても、後ろのシートは引かれず閉じない', async ({ page, request }) => {
  await new OptionSeed(request).add('朝日を見に行く')
  const list = new WishListScreen(page)
  await list.open()
  const sheet = new OptionSheetScreen(page)
  const opened = await sheet.openFromCard('朝日を見に行く')
  const { keyboard } = page
  for (const openDialog of [() => sheet.openConsult(), () => sheet.openDeleteConfirm()]) {
    const dialog = await openDialog()
    const box = await dialog.boundingBox()
    const x = (box?.x ?? 0) + 20
    const y = (box?.y ?? 0) + 20
    await dialog.dispatchEvent('touchstart', { touches: [{ identifier: 1, clientX: x, clientY: y }] })
    await dialog.dispatchEvent('touchmove', { touches: [{ identifier: 1, clientX: x, clientY: y + 150 }] })
    await dialog.dispatchEvent('touchend', { touches: [] })
    await expect(dialog).toBeVisible()
    await expect(opened).toHaveCSS('transform', 'none')
    await keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(opened).toBeVisible()
  }
})
