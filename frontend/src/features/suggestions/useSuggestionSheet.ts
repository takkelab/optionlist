import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { Option, OptionStatus, SuggestionDetail } from '../../../../shared/types'
import { useCatalogLoader, useListLoader, useNotifier, useOptionsApi, useSuggestionsApi } from '../../app/hooks'
import { OptionListActions } from '../../lib/OptionListActions'
import type { ListActions } from '../../lib/OptionListActions'
import { WishListOrder } from '../../lib/WishListOrder'
import type { SheetOrigin } from '../options/OptionSheet'
import { useAddCelebration } from './useAddCelebration'
import type { AddCelebration } from './useAddCelebration'
import type { SuggestionDetailView } from './useSuggestionDetail'

const order = new WishListOrder()

export type SuggestionSheet = {
  // シートで開いている項目。閉じているか、取り消した・別の一覧へ移したら null
  opened: Option | null
  origin: SheetOrigin
  actions: ListActions
  close(): void
  // 追加の応答・開き直しの読み込みを待っている間は true（ボタンを押せなくする）
  busy: boolean
  // 押した直後の弾み・粒を出している間は true
  celebrating: boolean
  // [やりたいリストに追加]。押したら弾ませ、追加できたら少し待ってからシートを開く
  add(detail: SuggestionDetail): Promise<void>
  // 「やりたいリストにあります」などのボタン。その項目を読んでシートを開き直す
  reopen(detail: SuggestionDetail): Promise<void>
}

// 提案のボタン・探す画面の印を、項目の状態に合わせる
type Sync = (suggestionId: number | undefined, status: OptionStatus | null, optionId: number | null) => void
type Show = (option: Option, origin: SheetOrigin) => void
type Stay = () => () => boolean
// 応答を待っている提案の id（なければ null）
type SetBusyId = Dispatch<SetStateAction<number | null>>

// 提案 1 件の画面の追加と、提案から開くシート（screens.md §5、docs/decisions/0025）
// この画面は関連へ移っても作り直されないので、応答待ち・弾みはどの提案のものかを覚え、移った先の提案には持ち越さない
export function useSuggestionSheet(view: SuggestionDetailView): SuggestionSheet {
  const sync = useSync(view)
  const { detail } = view
  const id = detail?.id
  const { opened, origin, setList, show, close, stay } = useOpenedState(id)
  const actions = useActions(setList, sync, id)
  const [busyId, setBusyId] = useState<number | null>(null)
  const reopen = useReopen(show, stay, setBusyId)
  const celebration = useAddCelebration()
  const add = useAdd(sync, show, stay, useReloadAndReopen(view, reopen), setBusyId, celebration)
  return { opened, origin, actions, close, busy: busyId === id, celebrating: celebration.celebratingId === id, add, reopen }
}

// やりたいリスト・やったリストに戻ったときは、覚えている古い一覧を出さずに読み込みを待つ。
// 応答を待つ間に関連へ移っていたら、押した提案の印だけを直し、移った先の提案は書き換えない
function useSync(view: SuggestionDetailView): Sync {
  const catalog = useCatalogLoader()
  const lists = useListLoader()
  const { detail, replace } = view
  const current = useRef(detail)
  useEffect(() => {
    current.current = detail
  })
  return useCallback(
    (suggestionId, status, optionId) => {
      if (suggestionId === undefined) return
      const shown = current.current
      if (shown?.id === suggestionId) replace({ ...shown, optionStatus: status, optionId })
      catalog.mark(suggestionId, status)
      lists.forget('pending')
      lists.forget('completed')
    },
    [replace, catalog, lists],
  )
}

// 開いている項目を 1 件だけの一覧として持つ（取り消す・移すと空になり、シートが閉じる）。
// どの提案のシートかも覚え、関連など別の提案へ移ったら前のシートは出さない。応答を待つ間に移っていたら、開かない（戻ったときに勝手に開かないように）
function useOpenedState(suggestionId: number | undefined) {
  const latest = useRef(suggestionId)
  // 提案が変わった回数。移ってすぐ戻ると id は同じに戻るので、id だけでは離れたことが分からない
  const visit = useRef(0)
  useEffect(() => {
    if (latest.current === suggestionId) return
    latest.current = suggestionId
    visit.current += 1
  })
  // 待ち始めに呼び、返した関数で、待っている間にこの提案を離れていないかを確かめる
  const stay = useCallback(() => {
    const at = visit.current
    return () => at === visit.current
  }, [])
  const [list, setList] = useState<Option[]>([])
  const [shown, setShown] = useState<{ suggestionId: number | undefined; origin: SheetOrigin; open: boolean }>({
    suggestionId: undefined,
    origin: 'added',
    open: false,
  })
  const show = useCallback<Show>(
    (option, origin) => {
      setList([option])
      setShown({ suggestionId, origin, open: true })
    },
    [suggestionId],
  )
  const close = () => setShown((current) => ({ ...current, open: false }))
  const [first] = list
  const visible = shown.open && shown.suggestionId === suggestionId
  return { opened: visible ? (first ?? null) : null, origin: shown.origin, setList, show, close, stay }
}

// シートの操作は、やりたいリストと同じ OptionListActions に 1 件だけの一覧を渡して行い、成功したら提案のボタン・印もそろえる
function useActions(setList: Dispatch<SetStateAction<Option[]>>, sync: Sync, suggestionId: number | undefined): ListActions {
  const api = useOptionsApi()
  const notifier = useNotifier()
  const lists = useListLoader()
  return useMemo<ListActions>(() => {
    const base = new OptionListActions(api, notifier, (change) => setList((items) => change(items)), order)
    const after = (done: boolean, then: () => void) => {
      if (done) then()
      return done
    }
    return {
      update: async (id, changes, failure) => after(await base.update(id, changes, failure), () => lists.forget('pending')),
      remove: async (id) => after(await base.remove(id), () => sync(suggestionId, null, null)),
      achieve: async (id) => {
        const achievement = await base.achieve(id)
        if (achievement !== null) lists.forget('completed')
        return achievement
      },
      setPhoto: async (id, achievementId, photo) => after(await base.setPhoto(id, achievementId, photo), () => lists.forget('completed')),
      removePhoto: async (id, achievementId) => after(await base.removePhoto(id, achievementId), () => lists.forget('completed')),
      move: async (id, status) => after(await base.move(id, status), () => sync(suggestionId, status, id)),
    }
  }, [api, notifier, lists, setList, sync, suggestionId])
}

function useReopen(show: Show, stay: Stay, setBusyId: SetBusyId) {
  const api = useOptionsApi()
  const notifier = useNotifier()
  return useCallback(
    async (target: SuggestionDetail) => {
      const { id, optionId } = target
      if (optionId === null) return
      setBusyId(id)
      const stayed = stay()
      try {
        const option = await api.detail(optionId)
        if (stayed()) show(option, 'reopened')
      } catch (error) {
        notifier.error('読み込めませんでした', error)
      } finally {
        setBusyId((current) => (current === id ? null : current))
      }
    },
    [api, notifier, show, stay, setBusyId],
  )
}

// 提案を読み直し、読み終えたらその項目のシートを開く（別の端末で先に追加されていた 409 のとき）
function useReloadAndReopen(view: SuggestionDetailView, reopen: (detail: SuggestionDetail) => Promise<void>) {
  const { detail, reload } = view
  // シートを開く提案の id。読み終える前に別の提案へ移ったら、やめる
  const openAfterReload = useRef<number | null>(null)
  useEffect(() => {
    if (openAfterReload.current === null || detail === null || detail === undefined) return
    if (detail.id !== openAfterReload.current) openAfterReload.current = null
    else if (detail.optionId !== null) {
      openAfterReload.current = null
      void reopen(detail)
    }
  }, [detail, reopen])
  return useCallback(
    (suggestionId: number) => {
      openAfterReload.current = suggestionId
      reload()
    },
    [reload],
  )
}

// 押したらすぐ弾ませ（応答を待たない）、追加できたら弾みを見せてからシートを開く。追加できなかったら弾みをやめて戻す。
// 別の端末で先に追加されていた（409）ときは、読み直してからその項目のシートを開く
function useAdd(sync: Sync, show: Show, stay: Stay, reloadAndReopen: (suggestionId: number) => void, setBusyId: SetBusyId, celebration: AddCelebration) {
  const api = useSuggestionsApi()
  const notifier = useNotifier()
  const { start, stop } = celebration
  return useCallback(
    async (target: SuggestionDetail) => {
      const { id } = target
      setBusyId(id)
      const held = start(id)
      const stayed = stay()
      try {
        const option = await api.addSuggestion(id, target.title)
        if (option === null) {
          // 読み直すまでの間も押せないよう、先に印だけ付けておく
          sync(id, 'pending', null)
          notifier.info('もう追加してあります')
          reloadAndReopen(id)
          return
        }
        sync(id, option.status, option.id)
        await held
        if (stayed()) show(option, 'added')
      } catch (error) {
        stop()
        notifier.error('追加できませんでした', error)
      } finally {
        setBusyId((current) => (current === id ? null : current))
      }
    },
    [api, notifier, sync, show, stay, reloadAndReopen, setBusyId, start, stop],
  )
}
