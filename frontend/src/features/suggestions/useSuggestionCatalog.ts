import { useEffect, useState } from 'react'
import type { SuggestionCatalog } from '../../../../shared/types'
import { useCatalogLoader, useNotifier } from '../../app/hooks'

// 提案の一覧（探す画面・タグの一覧）。最近読んだものがあればまずそれを出し（戻ったときに待たずにスクロール位置を戻せる）、読み直したら置き換える
// 読み込みが終わるまでは null
export function useSuggestionCatalog(): SuggestionCatalog | null {
  const loader = useCatalogLoader()
  const notifier = useNotifier()
  const [catalog, setCatalog] = useState(() => loader.cached())

  useEffect(() => {
    let active = true
    loader
      .load()
      .then((loaded) => {
        if (active) setCatalog(loaded)
      })
      .catch((error: unknown) => notifier.error('提案を読み込めませんでした', error))
    return () => {
      active = false
    }
  }, [loader, notifier])

  return catalog
}
