import type { Option } from '../../../shared/types'
import type { ListOrder } from './WishListOrder'

// やったリストの並び。移した日の新しい順（screens.md §6、api.md §2 の completed と同じ）。予定日では並べ替えない
export class DoneListOrder implements ListOrder {
  arrange(list: Option[]): Option[] {
    return list.toSorted((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)) || b.id - a.id)
  }

  moveToTopOfUndated(list: Option[], _id: number): Option[] {
    return this.arrange(list)
  }
}
