import { useLayoutEffect, useRef } from 'react'
import styles from './Toast.module.css'

export type ToastKind = 'error' | 'info'

type Props = { message: string | null; kind: ToastKind }

// screens.md §7: 画面下部に出す短いメッセージ（失敗と、「相談文をコピーしました」のような操作の結果）。消すタイミングは app/AppProviders.tsx が決める
// 項目のシート（モーダルの dialog）は最前面（top layer）に出るので、トーストも popover にして、出すたびに最前面へ入れ直す
export function Toast({ message, kind }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const area = ref.current
    if (area === null) return
    if (area.matches(':popover-open')) area.hidePopover()
    if (message !== null) area.showPopover()
  }, [message])
  // 名前を付けるのは、やりたいリストの並び替え（dnd-kit）の読み上げ用の role="status" と見分けるため
  return (
    <div ref={ref} popover="manual" className={styles.area} role="status" aria-live="polite" aria-label="お知らせ">
      {message !== null && <p className={kind === 'info' ? `${styles.toast} ${styles.info}` : styles.toast}>{message}</p>}
    </div>
  )
}
