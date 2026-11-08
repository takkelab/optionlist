export interface ScrollTracker {
  // 今のスクロール位置を受け取り、ヘッダーを出しておくかを返す
  update(y: number): boolean
}

// ヘッダーの出し入れ（screens.md §1）。下にスクロールし始めたら隠し、上に戻し始めたら出す。一番上の近く（topZone 以内）では常に出す
// 最初の 1 回は位置を覚えるだけで、出したままにする（開いた時点で下のほうにいても、スクロールしていないのに隠さない）
// 指の小さなぶれで出たり消えたりしないよう、前に判定した位置から threshold 以上動いたときだけ判定し直す
export class ScrollVisibility implements ScrollTracker {
  readonly #topZone: number
  readonly #threshold: number
  #lastY: number | null = null
  #visible = true

  constructor(topZone: number, threshold: number) {
    this.#topZone = topZone
    this.#threshold = threshold
  }

  update(y: number): boolean {
    if (this.#lastY === null || y <= this.#topZone) {
      this.#lastY = y
      this.#visible = true
      return true
    }
    const delta = y - this.#lastY
    if (Math.abs(delta) < this.#threshold) return this.#visible
    this.#lastY = y
    this.#visible = delta < 0
    return this.#visible
  }
}
