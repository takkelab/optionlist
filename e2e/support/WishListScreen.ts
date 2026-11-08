import type { Locator, Page } from '@playwright/test'

export interface WishListActions {
  open(): Promise<void>
  waitUntilLoaded(): Promise<void>
  openAddDialog(): Promise<Locator>
  add(title: string): Promise<void>
  titles(): Promise<string[]>
  drag(title: string, target: string): Promise<void>
  dragHandle(title: string): Locator
  titleCells(): Locator
  todayPick(): Promise<string>
  pickAnother(): Promise<void>
  scrollBy(dy: number): Promise<void>
  showDone(): Promise<void>
  showWish(): Promise<void>
  currentStatus(): Locator
  slideMotions(): Promise<string[]>
  slideFrame(): Promise<SlideFrame>
}

// 切り替えの動きの名前と、そのときに描かれているカードのタイトル（同じ瞬間に読む）
export type SlideFrame = { motions: string[]; titles: string[] }

// やりたいリスト（/）の操作。テストからは画面の構造ではなく、この操作の単位で書く
export class WishListScreen implements WishListActions {
  readonly #page: Page

  constructor(page: Page) {
    this.#page = page
  }

  // 一覧を開き、読み込みが終わる（カードか空の案内が出る）まで待つ。開き直すと再読み込みになる
  async open(): Promise<void> {
    await this.#page.goto('/')
    await this.waitUntilLoaded()
  }

  async waitUntilLoaded(): Promise<void> {
    const cards = this.#page.getByRole('listitem')
    const loaded = cards.or(this.#page.getByText('まだ何もありません'))
    const first = loaded.first()
    await first.waitFor()
  }

  // 追加ダイアログを開き、ダイアログを返す
  async openAddDialog(): Promise<Locator> {
    const plus = this.#page.getByRole('button', { name: 'やりたいことを追加' })
    await plus.click()
    const dialog = this.#page.getByRole('dialog', { name: 'やりたいことを追加' })
    await dialog.waitFor()
    return dialog
  }

  async add(title: string): Promise<void> {
    const dialog = await this.openAddDialog()
    const input = dialog.getByRole('textbox', { name: 'タイトル' })
    await input.fill(title)
    const submit = dialog.getByRole('button', { name: '追加', exact: true })
    await submit.click()
    await dialog.waitFor({ state: 'hidden' })
  }

  // title のカードを左端の取っ手で掴み、target のカードの位置まで動かして離す。dnd-kit が動きを拾えるよう、数回に分けて動かす
  async drag(title: string, target: string): Promise<void> {
    const handle = this.dragHandle(title)
    const from = await handle.boundingBox()
    const cell = this.titleCells().filter({ hasText: target })
    const to = await cell.boundingBox()
    if (from === null || to === null) throw new Error('カードが見えていない')
    const x = from.x + from.width / 2
    const { mouse } = this.#page
    await mouse.move(x, from.y + from.height / 2)
    await mouse.down()
    await mouse.move(x, to.y + to.height / 2, { steps: 12 })
    await mouse.up()
  }

  // title のカードの並び替えの取っ手（予定日がないカードだけにある）
  dragHandle(title: string): Locator {
    return this.#page.getByRole('button', { name: `${title}を並べ替える` })
  }

  // カードのタイトルだけ（達成回数や「今日はこれどう？」は含めない）
  async titles(): Promise<string[]> {
    const titles = this.#page.locator('[data-option-title]')
    return titles.allTextContents()
  }

  // カードのタイトルの並び。カードは縮んで消える（screens.md §1）ので、抜けたあとの並びは expect(...).toHaveText で待って確かめる
  titleCells(): Locator {
    return this.#page.locator('[data-option-title]')
  }

  // 「今日はこれどう？」に出ているタイトル
  async todayPick(): Promise<string> {
    const title = this.#page.locator('[data-today-pick]')
    return title.innerText()
  }

  // 指やホイールでのスクロールと同じく、scroll イベントを起こす。正の値で下へ
  async scrollBy(dy: number): Promise<void> {
    const { mouse } = this.#page
    await mouse.wheel(0, dy)
  }

  async pickAnother(): Promise<void> {
    const again = this.#page.getByRole('button', { name: 'ほかのを見る' })
    await again.click()
  }

  // ヘッダーの「やりたいこと｜やったこと」の切り替え
  async showDone(): Promise<void> {
    await this.#switchTo('やったこと')
  }

  async showWish(): Promise<void> {
    await this.#switchTo('やりたいこと')
  }

  // 切り替えで選ばれている側の名前（見出しの役目をする）
  // expect(...).toHaveText で、描き終わるまで待って確かめる
  currentStatus(): Locator {
    return this.#switcher().locator('[aria-current="page"]')
  }

  // 切り替えの View Transitions で今動いている、一覧（root）の CSS の動きの名前（global.css の slide-…）
  // 動きは 0.26 秒ほどなので、expect.poll で切り替えた直後に読む
  async slideMotions(): Promise<string[]> {
    return this.#page.evaluate(() =>
      document
        .getAnimations()
        .filter((animation): animation is CSSAnimation => animation instanceof CSSAnimation)
        .map((animation) => animation.animationName)
        .filter((name) => name.startsWith('slide-')),
    )
  }

  // 動きが始まったときに、切り替えた先のカードがもう描かれているか（後の見た目に写っているか）を確かめるために使う
  async slideFrame(): Promise<SlideFrame> {
    return this.#page.evaluate(() => ({
      motions: document
        .getAnimations()
        .filter((animation): animation is CSSAnimation => animation instanceof CSSAnimation)
        .map((animation) => animation.animationName)
        .filter((name) => name.startsWith('slide-')),
      titles: [...document.querySelectorAll('[data-option-title]')].map((title) => title.textContent ?? ''),
    }))
  }

  async #switchTo(name: string): Promise<void> {
    const segment = this.#switcher().getByRole('link', { name, exact: true })
    await segment.click()
  }

  #switcher(): Locator {
    return this.#page.getByRole('navigation', { name: 'やりたい・やったの切り替え' })
  }
}
