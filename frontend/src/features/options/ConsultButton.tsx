import { useEffect, useId, useState } from 'react'
import type { ChangeEvent, MouseEvent } from 'react'
import { useNotifier } from '../../app/hooks'
import { Clipboard } from '../../components/Clipboard'
import dialog from '../../components/Dialog.module.css'
import { useModal } from '../../components/useModal'
import { useRetained } from '../../components/useRetained'
import { ConsultPrompt } from '../../lib/ConsultPrompt'
import styles from './ConsultButton.module.css'

const prompt = new ConsultPrompt()
const clipboard = new Clipboard()
// コピーした結果をボタンに出しておく時間
const RESULT_MS = 3000
const COPY_LABEL = { idle: 'コピー', copied: '✓ コピーしました', failed: 'コピーできませんでした' } as const

// 提案から追加した項目（firstStep あり）は「AI に聞く」として最初の一歩を聞く（docs/decisions/0025）
const WORDING = {
  plan: { label: '💬 AI に相談', heading: 'AI に相談', note: 'ChatGPT などに貼り付けると、実現までの段取りを一緒に考えてくれます' },
  firstStep: { label: '💬 AI に聞く', heading: 'AI に聞く', note: 'ChatGPT などに貼り付けると、最初の一歩を一緒に考えてくれます' },
} as const

type Wording = (typeof WORDING)[keyof typeof WORDING]

type Props = { title: string; plannedOn: string | null; firstStep?: string | null }

// screens.md §3 の「AI に相談」「AI に聞く」。押すとシートの上に中央のダイアログで相談文を出し、その場で直してからコピーする。直した文は保存しない
export function ConsultButton({ title, plannedOn, firstStep = null }: Props) {
  const wording = firstStep === null ? WORDING.plan : WORDING.firstStep
  // 入力欄の文。null なら閉じている
  const [text, setText] = useState<string | null>(null)
  const close = () => setText(null)
  const modal = useModal(text !== null, close)
  // 閉じる動きの間は、直前の文を出しておく
  const shown = useRetained(text)
  // 開いた回数。閉じたあとも中身を残すので、開くたびに作り直す（コピーの結果の表示を持ち越さない）
  const [round, setRound] = useState(0)
  const openEditor = () => {
    setText(prompt.build(title, plannedOn, firstStep))
    setRound(round + 1)
  }
  const headingId = useId()
  // ダイアログの外（背景）を押したら閉じる
  const closeOutside = (event: MouseEvent<HTMLDialogElement>) => {
    const { target, currentTarget } = event
    if (target === currentTarget) close()
  }
  return (
    <>
      <button type="button" className={styles.open} onClick={openEditor}>
        {wording.label}
      </button>
      <dialog {...modal} className={dialog.dialog} aria-labelledby={headingId} onClick={closeOutside}>
        {shown !== null && <PromptEditor key={round} headingId={headingId} wording={wording} text={shown} onChange={setText} onClose={close} />}
      </dialog>
    </>
  )
}

type EditorProps = { headingId: string; wording: Wording; text: string; onChange: (text: string) => void; onClose: () => void }

function PromptEditor({ headingId, wording, text, onChange, onClose }: EditorProps) {
  const notifier = useNotifier()
  const [result, setResult] = useState<keyof typeof COPY_LABEL>('idle')

  useEffect(() => {
    if (result === 'idle') return undefined
    const timer = setTimeout(() => setResult('idle'), RESULT_MS)
    return () => clearTimeout(timer)
  }, [result])

  const change = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const { value } = event.currentTarget
    onChange(value)
  }
  // コピーに使う一時的な入力欄は、押したボタンのそば（開いているダイアログの中）に置く
  const copy = async (event: MouseEvent<HTMLButtonElement>) => {
    const { currentTarget } = event
    const { parentElement } = currentTarget
    try {
      const copied = await clipboard.copy(text, parentElement ?? currentTarget)
      if (!copied) throw new Error('execCommand("copy") が false を返した')
      setResult('copied')
    } catch (error) {
      notifier.error('コピーできませんでした', error)
      setResult('failed')
    }
  }

  return (
    <div className={dialog.form}>
      <h2 id={headingId} className={dialog.heading}>
        {wording.heading}
      </h2>
      <p className={styles.note}>{wording.note}</p>
      <textarea className={styles.text} value={text} onChange={change} aria-label="相談文" rows={6} />
      <div className={dialog.actions}>
        <button type="button" className={dialog.cancel} onClick={onClose}>
          閉じる
        </button>
        <button type="button" className={result === 'failed' ? `${dialog.submit} ${styles.failed}` : dialog.submit} onClick={(event) => void copy(event)} aria-live="polite" data-autofocus>
          {COPY_LABEL[result]}
        </button>
      </div>
    </div>
  )
}
