import type { Option } from '../../../../../shared/types'
import { DoneListOrder } from '../../../lib/DoneListOrder'
import { ReplaceList } from '../../../lib/ListMerge'
import type { ListActions } from '../../../lib/OptionListActions'
import { useStatusList } from '../useStatusList'

const order = new DoneListOrder()
const replace = new ReplaceList()

export type DoneList = {
  // 読み込みが終わるまでは null（空のときの案内を一瞬出さないため）
  options: Option[] | null
  // 項目のシート（screens.md §3）からの変更・🎉・戻す・削除
  actions: ListActions
}

// やったリスト（status = completed）を、移した日の新しい順に読み込む（screens.md §6）
export function useDoneList(): DoneList {
  const { options, actions } = useStatusList('completed', 'やったリストを読み込めませんでした', replace, order)
  return { options, actions }
}
