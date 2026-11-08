import { useState } from 'react'
import type { ChangeEvent, KeyboardEvent } from 'react'
import { TitleRule } from '../../lib/TitleRule'
import styles from './TitleField.module.css'

const titleRule = new TitleRule()

type Props = { title: string; onSave: (title: string) => Promise<boolean> }

// screens.md §3: 項目のシートの見出し。押すとその場で入力欄になり、Enter かほかを押したら保存する。
// 空・長すぎるとき、変わっていないときは保存せずに戻す。Esc は変えずに戻す（シートは閉じない）
export function TitleField({ title, onSave }: Props) {
  // 入力中の文字。null なら見出しを出している
  const [draft, setDraft] = useState<string | null>(null)

  const finish = () => {
    if (draft === null) return
    const next = titleRule.normalize(draft)
    setDraft(null)
    if (next !== null && next !== title) void onSave(next)
  }
  const change = (event: ChangeEvent<HTMLInputElement>) => {
    const { value } = event.currentTarget
    setDraft(value)
  }
  const key = (event: KeyboardEvent<HTMLInputElement>) => {
    const { key: pressed, nativeEvent } = event
    // 日本語の変換を確定する Enter では保存しない
    if (pressed === 'Enter' && !nativeEvent.isComposing) finish()
    if (pressed === 'Escape') {
      // Esc で dialog が閉じないように止める
      event.preventDefault()
      setDraft(null)
    }
  }

  if (draft === null) {
    return (
      <h2 className={styles.heading}>
        <button type="button" className={styles.title} onClick={() => setDraft(title)} aria-label={`タイトル「${title}」を編集`}>
          {title}
        </button>
      </h2>
    )
  }
  return (
    <input
      className={styles.input}
      value={draft}
      onChange={change}
      onKeyDown={key}
      onBlur={finish}
      aria-label="タイトル"
      enterKeyHint="done"
      autoFocus
    />
  )
}
