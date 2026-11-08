import { expect, test } from '@playwright/test'
import { ConsultText } from '../support/ConsultText'
import { OptionSeed } from '../support/OptionSeed'
import { OptionSheetScreen } from '../support/OptionSheetScreen'
import { PlanDates } from '../support/PlanDates'
import { MySqlTestData } from '../support/TestData'
import { WishListScreen } from '../support/WishListScreen'

// screens.md §3: カードから開く項目のシート（タイトル・予定日のカレンダー・AI に相談・削除）。testing.md §5 のシナリオ 1・7
const data = new MySqlTestData()
const dates = new PlanDates()
const texts = new ConsultText()

test.beforeEach(async () => {
  await data.reset()
})

test.afterAll(async () => {
  await data.close()
})

test('手動で追加 → シートのカレンダーで予定日を決める → カードに出て、再読み込みしても残る。同じ日をもう一度押すと未定', async ({ page }) => {
  const list = new WishListScreen(page)
  await list.open()
  await list.add('富士山に登る')
  const sheet = new OptionSheetScreen(page)
  await sheet.openFromCard('富士山に登る')
  await expect(sheet.plannedOn()).toHaveText('未定')

  const date = dates.nextYear(1, 5)
  await sheet.pickDay(date, dates.spoken(date))
  await expect(sheet.plannedOn()).toHaveText(dates.long(date))
  await expect(sheet.dayButton(dates.spoken(date))).toHaveAttribute('aria-pressed', 'true')
  // カードには「あと何日」と、年・曜日入りの日付を出す（screens.md §2）
  const cardDate = page.locator('[data-planned-on]')
  const nextYear = new Date().getFullYear() + 1
  const cardText = new RegExp(`^あと \\d+ 日${dates.long(date)}$`)
  await expect(cardDate).toHaveText(cardText)
  await sheet.close()

  await list.open()
  await expect(cardDate).toHaveText(cardText)
  await sheet.openFromCard('富士山に登る')
  // 開いたときは予定日の月を出す
  await expect(sheet.calendarTitle()).toHaveText(`${nextYear}年1月`)
  const day = sheet.dayButton(dates.spoken(date))
  await day.click()
  await expect(sheet.plannedOn()).toHaveText('未定')
  await expect(cardDate).toHaveCount(0)
})

test('カレンダーは ‹ › で月を移り、年月を押して出す 12 か月のボタン（‹ › で年）で遠い月へ行ける', async ({ page, request }) => {
  await new OptionSeed(request).add('富士山に登る')
  const list = new WishListScreen(page)
  await list.open()
  const sheet = new OptionSheetScreen(page)
  const opened = await sheet.openFromCard('富士山に登る')
  const now = new Date()
  const year = now.getFullYear()
  const title = sheet.calendarTitle()
  await expect(title).toHaveText(`${year}年${now.getMonth() + 1}月`)

  await sheet.showMonth(year + 2, 12)
  await expect(title).toHaveText(`${year + 2}年12月`)
  const next = opened.getByRole('button', { name: '次の月' })
  await next.click()
  await expect(title).toHaveText(`${year + 3}年1月`)
  const previous = opened.getByRole('button', { name: '前の月' })
  await previous.click()
  await previous.click()
  await expect(title).toHaveText(`${year + 2}年11月`)

  // 12 か月のボタンでは今の月が選ばれていて、年月をもう一度押すとカレンダーに戻る
  await title.click()
  await expect(opened.getByRole('button', { name: '11月', exact: true })).toHaveAttribute('aria-pressed', 'true')
  const previousYear = opened.getByRole('button', { name: '前の年' })
  await expect(title).toHaveText(`${year + 2}年`)
  await previousYear.click()
  await expect(title).toHaveText(`${year + 1}年`)
  await title.click()
  await expect(opened.getByRole('button', { name: '前の月' })).toBeVisible()
  await expect(title).toHaveText(`${year + 1}年11月`)
})

test('予定日が昔の年でも、その月から開いて選び直せる', async ({ page, request }) => {
  const id = await new OptionSeed(request).add('富士山に登る')
  const res = await request.patch(`/api/options/${id}`, { data: { plannedOn: '2020-05-01' } })
  expect(res.status()).toBe(200)
  const list = new WishListScreen(page)
  await list.open()
  const sheet = new OptionSheetScreen(page)
  await sheet.openFromCard('富士山に登る')
  await expect(sheet.plannedOn()).toHaveText('2020/5/1（金）')
  await expect(sheet.calendarTitle()).toHaveText('2020年5月')
  await expect(sheet.dayButton('2020年5月1日（金）')).toHaveAttribute('aria-pressed', 'true')
  const day = sheet.dayButton('2020年5月2日（土）')
  await day.click()
  await expect(sheet.plannedOn()).toHaveText('2020/5/2（土）')
})

test('AI に相談を押すと中央のダイアログに相談文が出て、直してからコピーできる。閉じてもシートは残り、直した文は残らない', async ({ page, context, request }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await new OptionSeed(request).add('富士山に登る')
  const list = new WishListScreen(page)
  await list.open()
  const sheet = new OptionSheetScreen(page)
  await sheet.openFromCard('富士山に登る')

  const consult = await sheet.openConsult()
  const text = consult.getByRole('textbox', { name: '相談文' })
  // 開いたときは [コピー] にフォーカスを置き、スマホのキーボードを出さない。入力欄は iPhone で拡大しない 16px
  await expect(sheet.copyButton()).toBeFocused()
  await expect(text).toHaveCSS('font-size', '16px')
  await expect(text).toHaveValue(texts.prompt('富士山に登る', null))
  const edited = `${texts.prompt('富士山に登る', null)}予算は 3 万円までです。`
  await text.fill(edited)
  const copy = sheet.copyButton()
  await copy.click()
  await expect(copy).toHaveText('✓ コピーしました')
  const clipboard = () =>
    page.evaluate(() => {
      const { clipboard: board } = navigator
      return board.readText()
    })
  expect(await clipboard()).toBe(edited)
  // しばらくすると元の文字に戻る
  await expect(copy).toHaveText('コピー', { timeout: 5000 })

  // 閉じる・Esc で閉じるのは相談のダイアログだけで、シートは残る
  const close = consult.getByRole('button', { name: '閉じる' })
  await close.click()
  await expect(consult).toBeHidden()
  await expect(sheet.sheet()).toBeVisible()
  await sheet.openConsult()
  const { keyboard, mouse } = page
  await keyboard.press('Escape')
  await expect(consult).toBeHidden()
  await expect(sheet.sheet()).toBeVisible()
  // ダイアログの外（画面の上の方）を押しても閉じるのは相談のダイアログだけ
  await sheet.openConsult()
  await mouse.click(10, 10)
  await expect(consult).toBeHidden()
  await expect(sheet.sheet()).toBeVisible()

  // 予定日を決めてから開き直すと、元の文（予定日入り）に戻る
  const date = dates.nextYear(11, 23)
  await sheet.pickDay(date, dates.spoken(date))
  await sheet.openConsult()
  await expect(text).toHaveValue(texts.prompt('富士山に登る', dates.long(date)))
})

test('http で開いたとき（navigator.clipboard が使えない）も、ダイアログの中の入力欄を選んで相談文をコピーする', async ({ page, request }) => {
  // 安全でないコンテキストにし、execCommand('copy') のときに選ばれている文字を window.name に残す
  await page.addInitScript(() => {
    Object.defineProperty(window, 'isSecureContext', { value: false })
    const { execCommand } = document
    document.execCommand = (command: string, showUI?: boolean, value?: string) => {
      const active = document.activeElement
      if (command === 'copy' && active instanceof HTMLTextAreaElement && active.readOnly) {
        const { value: text, selectionStart, selectionEnd } = active
        window.name = text.slice(selectionStart, selectionEnd)
      }
      return execCommand.call(document, command, showUI, value)
    }
  })
  await new OptionSeed(request).add('富士山に登る')
  const list = new WishListScreen(page)
  await list.open()
  const sheet = new OptionSheetScreen(page)
  await sheet.openFromCard('富士山に登る')
  await sheet.openConsult()
  const copy = sheet.copyButton()
  await copy.click()
  await expect(copy).toHaveText('✓ コピーしました')
  expect(await page.evaluate(() => window.name)).toBe(texts.prompt('富士山に登る', null))
})

test('タイトルは見出しを押してその場で直せる。Esc・空では変わらない', async ({ page, request }) => {
  await new OptionSeed(request).add('富士山に登る')
  const list = new WishListScreen(page)
  await list.open()
  const sheet = new OptionSheetScreen(page)
  const opened = await sheet.openFromCard('富士山に登る')
  const heading = opened.getByRole('heading', { level: 2 })

  // Esc は入力をやめるだけで、シートは閉じない
  const input = await sheet.startRenaming()
  await input.fill('書きかけ')
  await input.press('Escape')
  await expect(heading).toHaveText('富士山に登る')
  await expect(opened).toBeVisible()

  await sheet.rename(' 　')
  await expect(heading).toHaveText('富士山に登る')

  await sheet.rename('富士山に夜から登る')
  await expect(heading).toHaveText('富士山に夜から登る')
  await sheet.close()
  expect(await list.titles()).toEqual(['富士山に夜から登る'])
  await list.open()
  expect(await list.titles()).toEqual(['富士山に夜から登る'])
})

test('削除は確認してから行い、一覧から消えてシートも閉じる。キャンセル・Esc では残る', async ({ page, request }) => {
  const seed = new OptionSeed(request)
  await seed.add('残す')
  await seed.add('消す')
  const list = new WishListScreen(page)
  await list.open()
  const sheet = new OptionSheetScreen(page)
  await sheet.openFromCard('消す')

  const confirm = await sheet.openDeleteConfirm()
  await expect(confirm).toContainText('『消す』を削除しますか？')
  const cancel = confirm.getByRole('button', { name: 'キャンセル' })
  await cancel.click()
  await expect(confirm).toBeHidden()
  await expect(sheet.sheet()).toBeVisible()

  // Esc で閉じるのは確認だけ
  const escaped = await sheet.openDeleteConfirm()
  const { keyboard } = page
  await keyboard.press('Escape')
  await expect(escaped).toBeHidden()
  await expect(sheet.sheet()).toBeVisible()

  const again = await sheet.openDeleteConfirm()
  const remove = again.getByRole('button', { name: '削除' })
  await remove.click()
  await expect(sheet.sheet()).toBeHidden()
  await expect(page.getByRole('status', { name: 'お知らせ' })).toContainText('『消す』を削除しました')
  // カードは縮んでから消える
  await expect(list.titleCells()).toHaveText(['残す'])
  await list.open()
  expect(await list.titles()).toEqual(['残す'])
})

test('予定日があるものは一覧の上に日付の早い順に並び、過ぎたものも上に残る。予定日を消すと予定日がないものの一番上に入る', async ({ page, request }) => {
  const seed = new OptionSeed(request)
  const ids = new Map<string, number>()
  for (const title of ['a', 'b', 'c', 'd', 'e']) ids.set(title, await seed.add(title))
  const plan = async (title: string, plannedOn: string) => {
    const res = await request.patch(`/api/options/${ids.get(title)}`, { data: { plannedOn } })
    expect(res.status()).toBe(200)
  }
  await plan('b', dates.nextYear(3, 1))
  await plan('d', dates.nextYear(1, 10))
  await plan('c', '2020-05-01')
  const list = new WishListScreen(page)
  await list.open()
  expect(await list.titles()).toEqual(['c', 'd', 'b', 'e', 'a'])
  const past = page.getByRole('button', { name: /^c/ })
  await expect(past.locator('[data-planned-on]')).toContainText('日前')
  const cardTitles = page.locator('[data-option-title]')

  const sheet = new OptionSheetScreen(page)
  await sheet.openFromCard('a')
  const date = dates.nextYear(1, 5)
  await sheet.pickDay(date, dates.spoken(date))
  await sheet.close()
  await expect(cardTitles).toHaveText(['c', 'a', 'd', 'b', 'e'])

  await sheet.openFromCard('d')
  const day = sheet.dayButton(dates.spoken(dates.nextYear(1, 10)))
  await day.click()
  await expect(sheet.plannedOn()).toHaveText('未定')
  await sheet.close()
  await expect(cardTitles).toHaveText(['c', 'a', 'b', 'd', 'e'])
  await list.open()
  expect(await list.titles()).toEqual(['c', 'a', 'b', 'd', 'e'])
})
