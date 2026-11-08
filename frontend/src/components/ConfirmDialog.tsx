import { useId } from 'react'
import type { ReactNode } from 'react'
import styles from './Dialog.module.css'
import { useModal } from './useModal'

type Props = {
  open: boolean
  message: string
  // message の下に出す補足
  note?: string
  confirmLabel: string
  // やめるほうのボタン。「このまま残す」のように、やめたら何が起きるかを書く
  cancelLabel?: string
  // 消すなど、取り消せない操作なら true（ボタンを危険の色にする）
  danger?: boolean
  // 中の操作を待っている間は true。答えられないようにする（Esc も効かない）
  busy?: boolean
  // 文とボタンの間に出す
  children?: ReactNode
  // true なら文を中央に寄せ、2 つの答えを同じ幅の大きなボタンで並べる（どちらも同じくらい選ぶ答え。§4 の移動）
  split?: boolean
  onConfirm: () => void
  onCancel: () => void
}

// 「〇〇しますか？」の確認（screens.md §3 の削除、§4 の移動）
export function ConfirmDialog(props: Props) {
  const { open, message, note, confirmLabel, cancelLabel = 'キャンセル', danger = false, busy = false, children, split = false, onConfirm, onCancel } = props
  const modal = useModal(open, () => {
    if (!busy) onCancel()
  })
  const messageId = useId()
  return (
    <dialog {...modal} className={styles.dialog} aria-labelledby={messageId}>
      <div className={styles.form}>
        <p id={messageId} className={split ? styles.centered : undefined}>
          {message}
        </p>
        {note !== undefined && <p className={styles.note}>{note}</p>}
        {children}
        <div className={split ? styles.split : styles.actions}>
          {/* 中に足したボタン（写真を付ける）へフォーカスを当てない。PC の Enter でファイルの選択が開かないように */}
          <button type="button" className={styles.cancel} disabled={busy} data-autofocus onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className={danger ? styles.danger : styles.submit} disabled={busy} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  )
}
