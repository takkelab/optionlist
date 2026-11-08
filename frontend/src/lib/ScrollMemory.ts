export interface ScrollMemory {
  // 画面を離れるときの位置を、その履歴の項目（location.key）ごとに覚える
  save(key: string, y: number): void
  // 戻ってきたときに戻す位置。覚えていなければ null
  restore(key: string): number | null
}

// 提案の画面で、戻るでたどってきた道を戻ったときに、離れたときのスクロール位置に戻す（screens.md §5）
export class HistoryScroll implements ScrollMemory {
  readonly #positions = new Map<string, number>()

  save(key: string, y: number): void {
    this.#positions.set(key, y)
  }

  restore(key: string): number | null {
    return this.#positions.get(key) ?? null
  }
}
