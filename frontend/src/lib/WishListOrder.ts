import type { Option } from '../../../shared/types'

export interface ListOrder {
  // 予定日があるものを予定日の早い順に上へ、その後に予定日がないもの。同じ日は id 順、予定日なし同士は今の順のまま（screens.md §2）
  arrange(list: Option[]): Option[]
  // 予定日を消した項目を、予定日がないものの一番上へ動かす（data.md §2 で sort_order を先頭にするのと合わせる）
  moveToTopOfUndated(list: Option[], id: number): Option[]
}

// ドラッグでの並び替え（screens.md §2）。動かせるのは予定日がないものだけ
export interface DragOrder {
  // activeId を overId の位置へ動かす。どちらかが予定日あり・見つからない・同じなら、そのままの一覧を返す
  move(list: Option[], activeId: number, overId: number): Option[]
  // PUT /api/options/order に送る、予定日がないものの id（api.md §2）
  undatedIds(list: Option[]): number[]
}

// やりたいリストの並び。サーバーの並び（api.md §2）と同じ規則で、カードを入れ替えたあとに並べ直す
export class WishListOrder implements ListOrder, DragOrder {
  arrange(list: Option[]): Option[] {
    return list.toSorted((a, b) => this.#rank(a, b))
  }

  moveToTopOfUndated(list: Option[], id: number): Option[] {
    const moved = list.filter((option) => option.id === id)
    return this.arrange([...moved, ...list.filter((option) => option.id !== id)])
  }

  move(list: Option[], activeId: number, overId: number): Option[] {
    const undated = list.filter((option) => option.plannedOn === null)
    const from = undated.findIndex((option) => option.id === activeId)
    const to = undated.findIndex((option) => option.id === overId)
    if (from < 0 || to < 0 || from === to) return list
    const rest = undated.toSpliced(from, 1)
    const moved = rest.toSpliced(to, 0, undated[from])
    return [...list.filter((option) => option.plannedOn !== null), ...moved]
  }

  undatedIds(list: Option[]): number[] {
    return list.filter((option) => option.plannedOn === null).map((option) => option.id)
  }

  #rank(a: Option, b: Option): number {
    const { plannedOn: left } = a
    const { plannedOn: right } = b
    if (left === null || right === null) return Number(left === null) - Number(right === null)
    return left.localeCompare(right) || a.id - b.id
  }
}
