import { useEffect, useId, useState } from 'react'
import type { MouseEvent } from 'react'
import { useNotifier } from '../../app/hooks'
import { Clipboard } from '../../components/Clipboard'
import dialog from '../../components/Dialog.module.css'
import { useModal } from '../../components/useModal'
import { useRetained } from '../../components/useRetained'
import styles from './Account.module.css'

const clipboard = new Clipboard()
// コピーした結果をボタンに出しておく時間（AI に相談と同じ）
const RESULT_MS = 3000
const COPY_LABEL = { idle: 'コピー', copied: '✓ コピーしました', failed: 'コピーできませんでした' } as const

type Props = { code: string | null; onClose: () => void }

// screens.md §9 の「復旧コードを表示する」。16 文字を 4 文字ずつ区切って大きく出し、コピーできる。閉じるときに確認は出さない
export function RecoveryCodeDialog({ code, onClose }: Props) {
  const modal = useModal(code !== null, onClose)
  // 閉じる動きの間は、直前のコードを出しておく
  const shown = useRetained(code)
  const headingId = useId()
  const closeOutside = (event: MouseEvent<HTMLDialogElement>) => {
    const { target, currentTarget } = event
    if (target === currentTarget) onClose()
  }
  return (
    <dialog {...modal} className={dialog.dialog} aria-labelledby={headingId} onClick={closeOutside}>
      {shown !== null && <CodeBody key={shown} code={shown} headingId={headingId} onClose={onClose} />}
    </dialog>
  )
}

function CodeBody({ code, headingId, onClose }: { code: string; headingId: string; onClose: () => void }) {
  const notifier = useNotifier()
  const [result, setResult] = useState<keyof typeof COPY_LABEL>('idle')

  useEffect(() => {
    if (result === 'idle') return undefined
    const timer = setTimeout(() => setResult('idle'), RESULT_MS)
    return () => clearTimeout(timer)
  }, [result])

  // コピーに使う一時的な入力欄は、押したボタンのそば（開いているダイアログの中）に置く
  const copy = async (event: MouseEvent<HTMLButtonElement>) => {
    const { currentTarget } = event
    const { parentElement } = currentTarget
    try {
      const copied = await clipboard.copy(code, parentElement ?? currentTarget)
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
        復旧コード
      </h2>
      <p className={styles.code} data-recovery-code>
        {code}
      </p>
      <p className={dialog.note}>スクリーンショットかメモに残してください。この画面を閉じると、もう一度は表示できません（作り直すことはできます）</p>
      <div className={dialog.actions}>
        <button type="button" className={dialog.cancel} onClick={onClose}>
          閉じる
        </button>
        <button
          type="button"
          className={result === 'failed' ? `${dialog.submit} ${styles.failed}` : dialog.submit}
          onClick={(event) => void copy(event)}
          aria-live="polite"
          data-autofocus
        >
          {COPY_LABEL[result]}
        </button>
      </div>
    </div>
  )
}
