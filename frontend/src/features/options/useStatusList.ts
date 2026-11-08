import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { Option, OptionStatus } from '../../../../shared/types'
import { useListLoader, useNotifier, useOptionsApi } from '../../app/hooks'
import type { ListMerge } from '../../lib/ListMerge'
import { OptionListActions } from '../../lib/OptionListActions'
import type { ListActions } from '../../lib/OptionListActions'
import type { ListOrder } from '../../lib/WishListOrder'

const OTHER: Record<OptionStatus, OptionStatus> = { pending: 'completed', completed: 'pending' }

export type StatusList = {
  // 最近読んだ一覧も読み込みもまだなら null（空のときの案内を一瞬出さないため）
  options: Option[] | null
  // 読み込みが届いたら true（届くまでは最近読んだ一覧のことがある）
  loaded: boolean
  setOptions: Dispatch<SetStateAction<Option[] | null>>
  // 項目のシート（screens.md §3）からの変更・🎉・移す・削除
  actions: ListActions
}

// やりたいリスト・やったリストの読み込み（screens.md §2・§6）。切り替えで待たずに滑らせるため（lib/ListPrefetch.ts、docs/decisions/0019）、
// 最近読んだ一覧があればまずそれを出し、読み込みが届いたら merge で置き換える。開いたときにもう片方の一覧も裏で読んでおき、
// 画面で書き換えた一覧は覚えておく（切り替えて戻ってきたときにすぐ出す）。シートの操作のあとは order で並べ直す
export function useStatusList(status: OptionStatus, failure: string, merge: ListMerge, order: ListOrder): StatusList {
  const api = useOptionsApi()
  const notifier = useNotifier()
  const loader = useListLoader()
  const [options, setOptions] = useState<Option[] | null>(() => loader.cached(status))
  // 読み込みが届いたら true。最近読んだ一覧を出している間は、届いた一覧で置き換わるので並び替えさせない（screens.md §2）
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let active = true
    loader.prefetch(OTHER[status])
    loader
      .load(status)
      .then((list) => {
        if (!active) return
        setOptions((current) => merge.merge(current ?? [], list))
        setLoaded(true)
      })
      .catch((error: unknown) => notifier.error(failure, error))
    return () => {
      active = false
    }
  }, [loader, notifier, status, failure, merge])

  useEffect(() => {
    if (options !== null) loader.remember(status, options)
  }, [loader, status, options])

  const setList = useCallback((change: (list: Option[]) => Option[]) => setOptions((list) => change(list ?? [])), [])
  // 別の一覧へ移したら、覚えている移した先の一覧を捨てる（古い中身を出さずに、次は読み込みを待つ）
  const actions = useMemo(
    () => new OptionListActions(api, notifier, setList, order, (moved) => loader.forget(moved)),
    [api, notifier, setList, order, loader],
  )

  return { options, loaded, setOptions, actions }
}
