import type { Option } from '../../../shared/types'
import type { ListOrder } from './WishListOrder'

export interface ListMerge {
  // 読み込みが届いたときに、今の一覧（先に出していた最近の一覧や、この画面で追加したもの）と届いた一覧から、出す一覧を作る
  merge(current: Option[], loaded: Option[]): Option[]
}

// 届いた一覧でそのまま置き換える（やったリスト）
export class ReplaceList implements ListMerge {
  merge(_current: Option[], loaded: Option[]): Option[] {
    return loaded
  }
}

export interface AddedTracker {
  // この画面で追加した項目
  added(id: number): void
}

// 届いた一覧で置き換えるが、この画面で追加した項目が応答に入っていなければ残す（読み込みが届く前に追加したもの。やりたいリスト）。
// 先に出していた最近の一覧の項目は残さない（別の画面で移した・消したものが残らないように）
export class KeepAdded implements ListMerge, AddedTracker {
  readonly #order: ListOrder
  readonly #ids = new Set<number>()

  constructor(order: ListOrder) {
    this.#order = order
  }

  added(id: number): void {
    this.#ids.add(id)
  }

  merge(current: Option[], loaded: Option[]): Option[] {
    const kept = current.filter((option) => this.#ids.has(option.id) && !loaded.some((o) => o.id === option.id))
    return this.#order.arrange([...kept, ...loaded])
  }
}
