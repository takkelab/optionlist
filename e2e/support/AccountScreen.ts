import type { Locator, Page } from '@playwright/test'

export interface AccountActions {
  // ヘッダーの ⚙ で設定のシートを開き、シートを返す
  openSettings(): Promise<Locator>
  // 設定のシートで復旧コードを表示し、出たコードを読んでダイアログを閉じる
  showRecoveryCode(): Promise<string>
  // 設定のシートで復旧コードを入れて引き継ぐ。確認が出たら置き換える
  restore(code: string): Promise<void>
  // 設定のシートで、すべてのデータを消す（確認で「すべて消す」）
  removeAll(): Promise<void>
  toast(): Locator
  // scope（シートやダイアログ）の中の、name のボタンを押す
  press(scope: Locator, name: string): Promise<void>
}

// 設定のシート（screens.md §9）の操作
export class AccountScreen implements AccountActions {
  readonly #page: Page

  constructor(page: Page) {
    this.#page = page
  }

  async openSettings(): Promise<Locator> {
    const button = this.#page.getByRole('button', { name: '設定' })
    await button.click()
    const sheet = this.#page.getByRole('dialog', { name: '設定' })
    await sheet.waitFor()
    return sheet
  }

  async showRecoveryCode(): Promise<string> {
    const sheet = await this.openSettings()
    const show = sheet.getByRole('button', { name: '復旧コードを表示する' })
    await show.click()
    const dialog = this.#page.getByRole('dialog', { name: '復旧コード' })
    const shown = dialog.locator('[data-recovery-code]')
    const code = (await shown.textContent()) ?? ''
    const close = dialog.getByRole('button', { name: '閉じる' })
    await close.click()
    await dialog.waitFor({ state: 'hidden' })
    return code.trim()
  }

  async restore(code: string): Promise<void> {
    const sheet = await this.openSettings()
    const open = sheet.getByRole('button', { name: '復旧コードを入れる' })
    await open.click()
    const dialog = this.#page.getByRole('dialog', { name: '復旧コードを入れる' })
    const input = dialog.getByRole('textbox', { name: '復旧コードを入れる' })
    await input.fill(code)
    const submit = dialog.getByRole('button', { name: '引き継ぐ' })
    await submit.click()
    // この端末に別のアカウントの項目があるときだけ、置き換えの確認が出る（出なければ、そのままシートが閉じる）
    const replace = this.#page.getByRole('button', { name: '置き換える' })
    await Promise.race([replace.waitFor(), sheet.waitFor({ state: 'hidden' })])
    if (await replace.isVisible()) await replace.click()
    await sheet.waitFor({ state: 'hidden' })
  }

  async removeAll(): Promise<void> {
    const sheet = await this.openSettings()
    const remove = sheet.getByRole('button', { name: '🗑 すべてのデータを消す' })
    await remove.click()
    const confirm = this.#page.getByRole('button', { name: 'すべて消す', exact: true })
    await confirm.click()
    await sheet.waitFor({ state: 'hidden' })
  }

  toast(): Locator {
    return this.#page.getByRole('status', { name: 'お知らせ' })
  }

  async press(scope: Locator, name: string): Promise<void> {
    const button = scope.getByRole('button', { name, exact: true })
    await button.click()
  }
}
