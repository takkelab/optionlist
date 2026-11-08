import { useCallback, useEffect, useState } from 'react'
import type { SuggestionDetail } from '../../../../shared/types'
import { useCatalogLoader, useNotifier, useSuggestionsApi } from '../../app/hooks'
import { SuggestionBrowse } from '../../lib/SuggestionBrowse'

const browse = new SuggestionBrowse()

// 読み込みが終わるまでは undefined、存在しない提案なら null
export type DetailState = SuggestionDetail | null | undefined

type Loaded = { param: string | undefined; detail: SuggestionDetail | null }

export type SuggestionDetailView = {
  detail: DetailState
  // 書き換え（追加したあと）
  replace(detail: SuggestionDetail): void
  // 読み直す（別の端末で先に追加されていたとき）
  reload(): void
}

// 提案 1 件（screens.md §5）。:id が変わったら（関連から移ったら）読み直す
export function useSuggestionDetail(param: string | undefined): SuggestionDetailView {
  const api = useSuggestionsApi()
  const catalog = useCatalogLoader()
  const notifier = useNotifier()
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let active = true
    const id = browse.routeId(param)
    const reading = id === null ? Promise.resolve(null) : api.suggestion(id)
    reading
      .then((detail) => {
        if (!active) return
        // 探す画面に戻ったときの印を、いま読んだ状態に合わせる
        if (detail !== null) catalog.mark(detail.id, detail.optionStatus)
        setLoaded({ param, detail })
      })
      .catch((error: unknown) => notifier.error('提案を読み込めませんでした', error))
    return () => {
      active = false
    }
  }, [api, catalog, notifier, param, version])

  // 追加の応答を待つ間に関連へ移っていたら、移った先の提案を上書きしない
  const replace = useCallback(
    (detail: SuggestionDetail) =>
      setLoaded((current) => (current !== null && browse.routeId(current.param) === detail.id ? { ...current, detail } : current)),
    [],
  )
  const reload = useCallback(() => setVersion((v) => v + 1), [])
  return { detail: loaded !== null && loaded.param === param ? loaded.detail : undefined, replace, reload }
}
