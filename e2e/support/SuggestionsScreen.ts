import { expect } from '@playwright/test'
import type { APIRequestContext, Locator, Page } from '@playwright/test'
import type { SuggestionCatalog, SuggestionDetail } from '../../shared/types'

export interface SuggestionsActions {
  openExplore(): Promise<void>
  waitForRows(): Promise<void>
  openSuggestion(id: number): Promise<void>
  rows(): Locator
  list(name: string): Locator
  row(hook: string): Locator
  rowTexts(): Promise<string[]>
  openRow(index: number): Promise<void>
  scrollToRow(index: number): Promise<void>
  openTag(name: string): Promise<void>
  add(): Promise<void>
  toggleFilter(): Promise<void>
  chip(label: string): Locator
  addButton(): Locator
  heading(): Locator
  tagLink(name: string): Locator
  back(): Promise<void>
  toast(): Locator
  scrollY(): Promise<number>
  slideMotions(): Promise<string[]>
  addMotions(): Promise<string[]>
}

// 提案の画面（探す画面・提案 1 件・タグの一覧）の操作。テストからは画面の構造ではなく、この操作の単位で書く
export class SuggestionsScreen implements SuggestionsActions {
  readonly #page: Page

  constructor(page: Page) {
    this.#page = page
  }

  // 探す画面を開き、行が出るまで待つ
  async openExplore(): Promise<void> {
    await this.#page.goto('/suggestions')
    await this.waitForRows()
  }

  // 提案の行が出るまで待つ（見出しは API の応答より先に出る）
  async waitForRows(): Promise<void> {
    const rows = this.rows()
    const first = rows.first()
    await first.waitFor()
  }

  // 提案 1 件を URL で開き、見出しか「見つかりません」が出るまで待つ
  async openSuggestion(id: number): Promise<void> {
    await this.#page.goto(`/suggestions/${id}`)
    const loaded = this.heading().or(this.#page.getByText('この提案は見つかりません'))
    await loaded.waitFor()
  }

  // 画面に出ている提案の行（リンク）すべて
  rows(): Locator {
    return this.#page.locator('[data-suggestion-hook]')
  }

  // 名前の付いた行・カードの並び（「12 月のおすすめ」「今日すぐできる」「関連」、テーマ名、「#星 の提案」「夜空と天気 の提案」）
  list(name: string): Locator {
    return this.#page.getByRole('list', { name, exact: true })
  }

  // 見出しが hook の行（今月のおすすめとテーマ別の一覧の両方に出るものは、先に出る方）
  row(hook: string): Locator {
    const rows = this.rows()
    const matched = rows.filter({ hasText: hook })
    return matched.first()
  }

  async rowTexts(): Promise<string[]> {
    const rows = this.rows()
    return rows.allTextContents()
  }

  // 行を押し、その URL に移るまで待つ（画面を滑らせるので、押した次のコマで移る。useStackSlide）
  async openRow(index: number): Promise<void> {
    const rows = this.rows()
    const row = rows.nth(index)
    const href = await row.getAttribute('href')
    await row.click()
    await this.#page.waitForURL((url) => url.pathname === href)
  }

  // index 番目の行が画面に入るまでスクロールする
  async scrollToRow(index: number): Promise<void> {
    const rows = this.rows()
    const row = rows.nth(index)
    await row.scrollIntoViewIfNeeded()
  }

  async openTag(name: string): Promise<void> {
    const link = this.tagLink(name)
    await link.click()
  }

  async add(): Promise<void> {
    const button = this.addButton()
    await button.click()
  }

  // ヘッダーの「絞り込み」で、一歩の大きさのチップを出し入れする
  async toggleFilter(): Promise<void> {
    const button = this.#page.getByRole('button', { name: '絞り込み' })
    await button.click()
  }

  chip(label: string): Locator {
    const chips = this.#page.getByRole('group', { name: '一歩の大きさ' })
    return chips.getByRole('button', { name: label, exact: true })
  }

  // 提案 1 件の画面の下に固定した [やりたいリストに追加]（追加済み・やったでは文字が変わり、押すと項目のシートを開き直す）
  addButton(): Locator {
    return this.#page.locator('[data-suggestion-add]')
  }

  // 提案 1 件の見出し（ヘッダーの「提案」ではなく、提案の引き）。
  // 探す画面にも h2 があり、画面を滑らせる間は前の画面が残るので、本文の中に絞る
  heading(): Locator {
    const article = this.#page.locator('article')
    return article.getByRole('heading', { level: 2 })
  }

  tagLink(name: string): Locator {
    return this.#page.getByRole('link', { name: `#${name}`, exact: true })
  }

  async back(): Promise<void> {
    const button = this.#page.getByRole('button', { name: '戻る' })
    await button.click()
  }

  toast(): Locator {
    return this.#page.getByRole('status', { name: 'お知らせ' })
  }

  async scrollY(): Promise<number> {
    return this.#page.evaluate(() => window.scrollY)
  }

  // 進む・戻るの View Transitions で今動いている、画面（root）の CSS の動きの名前（global.css の slide-… と shift-…）
  // 動きは 0.26 秒ほどなので、expect.poll で押した直後に読む
  async slideMotions(): Promise<string[]> {
    return this.#page.evaluate(() =>
      document
        .getAnimations()
        .filter((animation): animation is CSSAnimation => animation instanceof CSSAnimation)
        .map((animation) => animation.animationName)
        .filter((name) => name.startsWith('slide-') || name.startsWith('shift-')),
    )
  }

  // 追加ボタンの中で今動いている CSS の動きの名前（AddButton.module.css の pop・ring・burst。CSS Modules で名前に印が付く）
  async addMotions(): Promise<string[]> {
    const button = this.addButton()
    return button.evaluate((element) =>
      element
        .getAnimations({ subtree: true })
        .filter((animation): animation is CSSAnimation => animation instanceof CSSAnimation)
        .map((animation) => animation.animationName),
    )
  }
}

export interface SuggestionReader {
  detail(id: number): Promise<SuggestionDetail>
  catalog(): Promise<SuggestionCatalog>
}

// テストの前提に使う提案の中身を、backend から読む（マスターデータの文言をテストに書き写さない）
export class SuggestionData implements SuggestionReader {
  readonly #request: APIRequestContext

  constructor(request: APIRequestContext) {
    this.#request = request
  }

  async detail(id: number): Promise<SuggestionDetail> {
    const res = await this.#request.get(`/api/suggestions/${id}`)
    expect(res.status()).toBe(200)
    return (await res.json()) as SuggestionDetail
  }

  async catalog(): Promise<SuggestionCatalog> {
    const res = await this.#request.get('/api/suggestions')
    expect(res.status()).toBe(200)
    return (await res.json()) as SuggestionCatalog
  }
}
