import type { Locator, Page } from '@playwright/test'

export interface CompletionActions {
  achieve(): Promise<void>
  achieveUntilAnswer(): Promise<void>
  celebration(): Locator
  message(): Locator
  confetti(): Locator
  skipCelebration(): Promise<void>
  moveConfirm(): Locator
  answerMove(move: boolean): Promise<void>
  backToWish(): Promise<void>
  history(): Locator
  photoPrompt(): Locator
  skipPhoto(): Promise<void>
  pickPhotoFromConfirm(): Promise<void>
  pickBrokenPhotoFromConfirm(): Promise<void>
  replacePhotoFromConfirm(): Promise<void>
  confirmPhoto(): Locator
  pickPhotoFromHistory(label: string): Promise<void>
  pickBrokenPhotoFromHistory(label: string): Promise<void>
  cancelPicking(from: 'confirm' | 'prompt' | 'history'): Promise<void>
  historyPhotos(): Locator
  historyButton(label: string): Locator
  removePhoto(): Promise<void>
}

// 1px の PNG（backend の形式の検査・sharp での作り直しと、ブラウザの読み込みを本当に通す）。isolation.spec.ts も使う
export const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

// 項目のシートの 🎉（screens.md §4）と、やりたいリストに戻す・達成した日（§3）の操作
export class CompletionScreen implements CompletionActions {
  readonly #page: Page

  constructor(page: Page) {
    this.#page = page
  }

  // シートの [🎉 やった] を押す
  async achieve(): Promise<void> {
    const button = this.#sheet().getByRole('button', { name: '🎉 やった' })
    await button.click()
  }

  // やりたいリストの項目で 🎉 を押し、演出を早送りして移動の確認が出るまで進める
  async achieveUntilAnswer(): Promise<void> {
    await this.achieve()
    await this.skipCelebration()
    const confirm = this.moveConfirm()
    await confirm.waitFor()
  }

  // 画面の中央に出る労いの演出（🎉 とメッセージ）
  celebration(): Locator {
    return this.#page.locator('[data-celebration]')
  }

  // 演出の労いメッセージ
  message(): Locator {
    const celebration = this.celebration()
    return celebration.getByRole('paragraph')
  }

  // 紙吹雪の粒
  confetti(): Locator {
    const celebration = this.celebration()
    return celebration.locator('[data-confetti]')
  }

  // 演出が出るのを待ってから、押して早送りする
  async skipCelebration(): Promise<void> {
    const message = this.message()
    await message.waitFor()
    const celebration = this.celebration()
    await celebration.click()
    await message.waitFor({ state: 'hidden' })
  }

  moveConfirm(): Locator {
    return this.#page.getByRole('dialog', { name: 'やったリストに移動しますか？' })
  }

  // 移動の確認に [移動する] か [このまま残す] で答える
  async answerMove(move: boolean): Promise<void> {
    const confirm = this.moveConfirm()
    const button = confirm.getByRole('button', { name: move ? '移動する' : 'このまま残す' })
    await button.click()
    await confirm.waitFor({ state: 'hidden' })
  }

  async backToWish(): Promise<void> {
    const button = this.#sheet().getByRole('button', { name: 'やりたいリストに戻す' })
    await button.click()
    await this.#sheet().waitFor({ state: 'hidden' })
  }

  // シートの「達成した日」の日付
  history(): Locator {
    return this.#history().locator('[data-history-date]')
  }

  photoPrompt(): Locator {
    return this.#page.getByRole('dialog', { name: '写真を残しますか？' })
  }

  // やったリストの項目の 🎉 のあとの「写真を残しますか？」に [あとで] で答える
  async skipPhoto(): Promise<void> {
    const prompt = this.photoPrompt()
    const later = prompt.getByRole('button', { name: 'あとで' })
    await later.click()
    await prompt.waitFor({ state: 'hidden' })
  }

  // 移動の確認の [写真を残す] で写真を選ぶ
  async pickPhotoFromConfirm(): Promise<void> {
    const confirm = this.moveConfirm()
    await this.#choose(confirm.getByRole('button', { name: '写真を残す' }))
  }

  // 移動の確認の [写真を残す] で、画像として読めないファイルを選ぶ
  async pickBrokenPhotoFromConfirm(): Promise<void> {
    const confirm = this.moveConfirm()
    await this.#choose(confirm.getByRole('button', { name: '写真を残す' }), Buffer.from('これは画像ではない'))
  }

  // 移動の確認の、写真に重ねた [選び直す] で写真を選ぶ
  async replacePhotoFromConfirm(): Promise<void> {
    const confirm = this.moveConfirm()
    await this.#choose(confirm.getByRole('button', { name: '選び直す' }))
  }

  // 移動の確認に出る、付けた写真
  confirmPhoto(): Locator {
    const confirm = this.moveConfirm()
    return confirm.getByRole('img', { name: '付けた写真' })
  }

  // 達成した日の行のボタンから写真を選ぶ（「写真を付ける」「付け替える」）
  async pickPhotoFromHistory(label: string): Promise<void> {
    await this.#choose(this.#history().getByRole('button', { name: label }))
  }

  historyPhotos(): Locator {
    return this.#history().getByRole('img')
  }

  historyButton(label: string): Locator {
    return this.#history().getByRole('button', { name: label })
  }

  async removePhoto(): Promise<void> {
    await this.historyButton('写真を消す').click()
    const confirm = this.#page.getByRole('dialog', { name: 'この写真を消しますか？' })
    const remove = confirm.getByRole('button', { name: '消す', exact: true })
    await remove.click()
    await confirm.waitFor({ state: 'hidden' })
  }

  // 達成した日の行から、画像として読めないファイルを選ぶ
  async pickBrokenPhotoFromHistory(label: string): Promise<void> {
    await this.#choose(this.#history().getByRole('button', { name: label }), Buffer.from('これは画像ではない'))
  }

  // ファイルの選択を開いて、選ばずに閉じる（Playwright に閉じる操作がないので、ブラウザと同じ cancel を送る）
  async cancelPicking(from: 'confirm' | 'prompt' | 'history'): Promise<void> {
    const { button, scope } = this.#pickFrom(from)
    const chooser = this.#page.waitForEvent('filechooser')
    await button.click()
    await chooser
    const inputs = scope.locator('input[type="file"]')
    // シートの中では「写真を残しますか？」の input が先に並ぶ
    const input = inputs.first()
    await input.evaluate((element) => element.dispatchEvent(new Event('cancel', { bubbles: true })))
  }

  // 写真を選ぶボタンと、その input がある場所
  #pickFrom(from: 'confirm' | 'prompt' | 'history'): { button: Locator; scope: Locator } {
    if (from === 'confirm') {
      const scope = this.moveConfirm()
      return { button: scope.getByRole('button', { name: '写真を残す' }), scope }
    }
    if (from === 'prompt') return { button: this.photoPrompt().getByRole('button', { name: '写真を選ぶ' }), scope: this.#sheet() }
    return { button: this.historyButton('写真を付ける'), scope: this.#history() }
  }

  async #choose(button: Locator, content = Buffer.from(TINY_PNG, 'base64')): Promise<void> {
    const chooser = this.#page.waitForEvent('filechooser')
    await button.click()
    const opened = await chooser
    await opened.setFiles({ name: 'photo.png', mimeType: 'image/png', buffer: content })
  }

  #history(): Locator {
    return this.#sheet().getByRole('region', { name: '達成した日' })
  }

  #sheet(): Locator {
    return this.#page.getByRole('dialog', { name: '項目のシート' })
  }
}
