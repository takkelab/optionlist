import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

// 積んだ履歴の印
const MARK = 'sheetOpen'

type HistoryState = Record<string, unknown> | null

// 戻る（ブラウザの戻る・Android の戻るジェスチャー）でシートだけを閉じる（screens.md §3、docs/decisions/0025）
// 開いたら同じ URL の履歴を 1 つ積み、戻るで消えたら onClose で知らせる。
// 積む state は今の履歴の state（react-router の key と idx）を写して印を足す。router からは同じ項目に見えるので、戻っても画面は移らない。
// ほかの閉じ方（スワイプ・外・Esc・操作のあと）では、積んだ履歴を戻して消す（残すと、次の戻るが空振りする）
// シートの上に重ねたダイアログ（AI に相談・確認）を開いたまま戻ったら、一緒に閉じる。
// 閉じたシートの中にモーダルが残ると、見えないまま画面全体が押せなくなるため（中の状態は、次に開くときに作り直される）
export function useBackToClose(open: boolean, sheet: RefObject<HTMLDialogElement | null>, onClose: () => void): void {
  // 開いている間に onClose が作り直されても、積み直さない
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })

  useEffect(() => {
    if (!open) return undefined
    const { history } = window
    const base = history.state as HistoryState
    history.pushState({ ...base, [MARK]: true }, '')
    const back = () => {
      const { current } = sheet
      const stacked = current === null ? [] : [...current.querySelectorAll('dialog[open]')]
      for (const dialog of stacked) if (dialog instanceof HTMLDialogElement) dialog.close()
      closeRef.current()
    }
    window.addEventListener('popstate', back)
    return () => {
      window.removeEventListener('popstate', back)
      const current = history.state as HistoryState
      if (current?.[MARK] === true) history.back()
    }
  }, [open, sheet])
}
