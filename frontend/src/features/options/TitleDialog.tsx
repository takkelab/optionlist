import { useId, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import styles from '../../components/Dialog.module.css'
import { useModal } from '../../components/useModal'
import { TitleRule } from '../../lib/TitleRule'

const titleRule = new TitleRule()

type Props = {
  open: boolean
  heading: string
  submitLabel: string
  // 開いたときに入っているタイトル（編集なら今のタイトル）
  initialTitle?: string
  onClose: () => void
  // 成功したら true（ダイアログを閉じる）
  onSubmit: (title: string) => Promise<boolean>
}

// タイトルを入力するダイアログ。一覧の追加（screens.md §2）で使う
export function TitleDialog({ open, heading, submitLabel, initialTitle = '', onClose, onSubmit }: Props) {
  const modal = useModal(open, onClose)
  const headingId = useId()
  const [text, setText] = useState(initialTitle)
  const [sending, setSending] = useState(false)
  const [wasOpen, setWasOpen] = useState(open)
  const title = titleRule.normalize(text)

  // 開くたびに入力を最初の値に戻す（前回の入力を残さない）
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setText(initialTitle)
  }

  const change = (event: ChangeEvent<HTMLInputElement>) => {
    const { value } = event.currentTarget
    setText(value)
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (title === null || sending) return
    setSending(true)
    const done = await onSubmit(title)
    setSending(false)
    if (done) onClose()
  }

  return (
    <dialog {...modal} className={styles.dialog} aria-labelledby={headingId}>
      <form className={styles.form} onSubmit={submit}>
        <h2 id={headingId} className={styles.heading}>
          {heading}
        </h2>
        <input className={styles.input} value={text} onChange={change} placeholder="例: 朝日を見に行く" aria-label="タイトル" />
        <div className={styles.actions}>
          <button type="button" className={styles.cancel} onClick={onClose}>
            キャンセル
          </button>
          <button type="submit" className={styles.submit} disabled={title === null || sending}>
            {submitLabel}
          </button>
        </div>
      </form>
    </dialog>
  )
}
