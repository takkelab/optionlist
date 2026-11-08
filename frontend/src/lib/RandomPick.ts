export interface Picker {
  // items から 1 つ選ぶ。previous と同じものは（ほかに候補があれば）選ばない。items が空なら null
  pick<T>(items: T[], previous?: T): T | null
}

// 「今日はこれどう？」の 1 件を選ぶ（screens.md §2）。乱数は差し替えられるようにする（testing.md §4）
export class RandomPick implements Picker {
  readonly #random: () => number

  constructor(random: () => number = Math.random) {
    this.#random = random
  }

  pick<T>(items: T[], previous?: T): T | null {
    const candidates = items.length > 1 ? items.filter((item) => item !== previous) : items
    if (candidates.length === 0) return null
    const index = Math.min(Math.floor(this.#random() * candidates.length), candidates.length - 1)
    return candidates[index] ?? null
  }
}
