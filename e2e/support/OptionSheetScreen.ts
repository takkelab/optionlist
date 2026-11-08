import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

export interface OptionSheetActions {
  openFromCard(title: string): Promise<Locator>
  sheet(): Locator
  plannedOn(): Locator
  calendarTitle(): Locator
  showMonth(year: number, month: number): Promise<void>
  dayButton(spoken: string): Locator
  pickDay(date: string, spoken: string): Promise<void>
  openConsult(): Promise<Locator>
  consultDialog(): Locator
  notice(): Locator
  firstStep(): Locator
  button(name: string): Locator
  openAsk(): Promise<Locator>
  copyButton(): Locator
  startRenaming(): Promise<Locator>
  rename(title: string): Promise<void>
  openDeleteConfirm(): Promise<Locator>
  close(): Promise<void>
}

// 一覧のカードから開く項目のシート（screens.md §3）の操作。テストからは画面の構造ではなく、この操作の単位で書く
export class OptionSheetScreen implements OptionSheetActions {
  readonly #page: Page

  constructor(page: Page) {
    this.#page = page
  }

  // 一覧のカードを押してシートを開き、シートを返す
  async openFromCard(title: string): Promise<Locator> {
    const items = this.#page.getByRole('listitem')
    const item = items.filter({ hasText: title })
    // やりたいリストのカードには並び替えの取っ手のボタンもある（文字はなく aria-label だけ）ので、タイトルの入ったボタンを押す
    const card = item.getByRole('button').filter({ hasText: title })
    await card.click()
    const sheet = this.sheet()
    await sheet.waitFor()
    return sheet
  }

  sheet(): Locator {
    return this.#page.getByRole('dialog', { name: '項目のシート' })
  }

  // 予定日の見出しの横の表示（「2026/11/23（月）」か「未定」）
  plannedOn(): Locator {
    const sheet = this.sheet()
    return sheet.locator('[data-sheet-planned-on]')
  }

  // カレンダーの「2026年11月」（押すと 12 か月のボタンになり、見出しは「2026年」）
  calendarTitle(): Locator {
    const plan = this.sheet().getByRole('region', { name: '予定日' })
    return plan.getByRole('button', { name: /^\d+年(\d+月)?$/ })
  }

  // 「2026年11月」を押して 12 か月のボタンを出し、‹ › で年を合わせてから月を押す
  async showMonth(year: number, month: number): Promise<void> {
    const title = this.calendarTitle()
    await title.click()
    const plan = this.sheet().getByRole('region', { name: '予定日' })
    const text = (await title.textContent()) ?? ''
    const match = /^(\d+)年/.exec(text)
    const shown = Number(match?.[1])
    const move = plan.getByRole('button', { name: year > shown ? '次の年' : '前の年' })
    for (let i = 0; i < Math.abs(year - shown); i++) await move.click()
    const button = plan.getByRole('button', { name: `${month}月`, exact: true })
    await button.click()
  }

  dayButton(spoken: string): Locator {
    return this.sheet().getByRole('button', { name: spoken, exact: true })
  }

  // その日の月を出して、選んでいない日付を押し、保存が終わるのを待つ（spoken は「2027年1月5日（火）」）
  // 選んだ印は PATCH の応答で付くので、それを待つ。待たずに AI に相談などを開くと、予定日が入る前の中身を読んでしまう
  async pickDay(date: string, spoken: string): Promise<void> {
    const [year = 0, month = 0] = date.split('-').map(Number)
    await this.showMonth(year, month)
    const day = this.dayButton(spoken)
    await day.click()
    await expect(day).toHaveAttribute('aria-pressed', 'true')
  }

  // [AI に相談] を押して相談文のダイアログを開き、ダイアログを返す
  async openConsult(): Promise<Locator> {
    const open = this.sheet().getByRole('button', { name: '💬 AI に相談' })
    await open.click()
    const consult = this.consultDialog()
    await consult.waitFor()
    return consult
  }

  consultDialog(): Locator {
    return this.#page.getByRole('dialog', { name: 'AI に相談' })
  }

  // 提案 1 件の画面から開いたときの上の文（「やりたいリストに入れました」など。screens.md §5）
  notice(): Locator {
    return this.sheet().locator('[data-sheet-notice]')
  }

  // 提案から追加した項目の最初の一歩の塊（screens.md §3）
  firstStep(): Locator {
    return this.sheet().getByRole('region', { name: '最初の一歩' })
  }

  // シートの中のボタン（名前が一致するもの）
  button(name: string): Locator {
    return this.sheet().getByRole('button', { name, exact: true })
  }

  // 最初の一歩の [AI に聞く] を押して相談文のダイアログを開き、ダイアログを返す
  async openAsk(): Promise<Locator> {
    const open = this.firstStep().getByRole('button', { name: '💬 AI に聞く' })
    await open.click()
    const ask = this.#page.getByRole('dialog', { name: 'AI に聞く' })
    await ask.waitFor()
    return ask
  }

  copyButton(): Locator {
    const consult = this.consultDialog()
    return consult.getByRole('button', { name: /^(コピー|✓ コピーしました|コピーできませんでした)$/ })
  }

  // 見出しを押して入力欄にし、入力欄を返す
  async startRenaming(): Promise<Locator> {
    const title = this.sheet().getByRole('button', { name: /^タイトル「.*」を編集$/ })
    await title.click()
    const input = this.sheet().getByRole('textbox', { name: 'タイトル' })
    await input.waitFor()
    return input
  }

  async rename(title: string): Promise<void> {
    const input = await this.startRenaming()
    await input.fill(title)
    await input.press('Enter')
    await input.waitFor({ state: 'hidden' })
  }

  // 一番下の削除を押し、確認ダイアログを返す
  async openDeleteConfirm(): Promise<Locator> {
    const remove = this.sheet().getByRole('button', { name: '🗑 この項目を削除' })
    await remove.click()
    const confirm = this.#page.getByRole('dialog', { name: /を削除しますか？/ })
    await confirm.waitFor()
    return confirm
  }

  // ✕ は置かないので、Esc で閉じる
  async close(): Promise<void> {
    const { keyboard } = this.#page
    await keyboard.press('Escape')
    await this.sheet().waitFor({ state: 'hidden' })
  }

}
