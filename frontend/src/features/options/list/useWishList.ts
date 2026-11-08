import { useCallback, useMemo, useState } from 'react'
import type { Option } from '../../../../../shared/types'
import { useNotifier, useOptionsApi } from '../../../app/hooks'
import { KeepAdded } from '../../../lib/ListMerge'
import type { ListActions } from '../../../lib/OptionListActions'
import { WishListOrder } from '../../../lib/WishListOrder'
import { WishListReorder } from '../../../lib/WishListReorder'
import { useStatusList } from '../useStatusList'

const order = new WishListOrder()

export type WishList = {
  // 読み込みが終わるまでは null（空のときの案内を一瞬出さないため）
  options: Option[] | null
  // 読み込みが届くまでは false。並び替えはそれまでさせない
  loaded: boolean
  add(title: string): Promise<boolean>
  // ドラッグで activeId を overId の位置へ動かし、すぐ保存する（screens.md §2）
  reorder(activeId: number, overId: number): void
  // 項目のシート（screens.md §3）からの変更・削除
  actions: ListActions
}

// やりたいリスト（status = pending）を読み込み、追加したものを予定日がないものの先頭に入れる（screens.md §2）
export function useWishList(): WishList {
  const api = useOptionsApi()
  const notifier = useNotifier()
  // 読み込みが届く前にこの画面で追加したものが応答に入っていなければ、消さずに残す
  const [merge] = useState(() => new KeepAdded(order))
  const { options, loaded, setOptions, actions } = useStatusList('pending', 'やりたいリストを読み込めませんでした', merge, order)
  const reorderer = useMemo(
    () => new WishListReorder(api, notifier, (change) => setOptions((list) => change(list ?? [])), order),
    [api, notifier, setOptions],
  )

  const add = useCallback(
    async (title: string): Promise<boolean> => {
      try {
        const created = await api.create(title)
        merge.added(created.id)
        setOptions((list) => order.arrange([created, ...(list ?? [])]))
        return true
      } catch (error) {
        notifier.error('追加できませんでした', error)
        return false
      }
    },
    [api, notifier, merge, setOptions],
  )

  const reorder = useCallback(
    (activeId: number, overId: number) => {
      if (options !== null) void reorderer.reorder(options, activeId, overId)
    },
    [options, reorderer],
  )

  return { options, loaded, add, reorder, actions }
}
