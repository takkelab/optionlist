import { useId, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import type { AccountStatus } from '../../../../shared/types'
import { useAccountApi, useNotifier } from '../../app/hooks'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import dialog from '../../components/Dialog.module.css'
import { useModal } from '../../components/useModal'
import { useRetained } from '../../components/useRetained'
import { RecoveryCodeFormat } from '../../lib/RecoveryCodeFormat'
import styles from './Account.module.css'

const format = new RecoveryCodeFormat()
const ERRORS = { wrong: 'コードが違います', limited: '少し時間をおいてから、もう一度お試しください' } as const

// onRestored には移った先のアカウントの状態を渡す
type Props = { open: boolean; onClose: () => void; onRestored: (account: AccountStatus) => void }

// screens.md §9 の「復旧コードを入れる」。サーバーが「確認が要る」（409）と答えたときだけ、置き換えてよいかを確かめて送り直す
export function RestoreDialog({ open, onClose, onRestored }: Props) {
  const modal = useModal(open, onClose)
  const [round, setRound] = useState(0)
  const [wasOpen, setWasOpen] = useState(open)
  // 開くたびに入力と結果を作り直す
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setRound(round + 1)
  }
  return (
    <dialog {...modal} className={dialog.dialog} aria-label="復旧コードを入れる">
      <RestoreForm key={round} onClose={onClose} onRestored={onRestored} />
    </dialog>
  )
}

function RestoreForm({ onClose, onRestored }: Omit<Props, 'open'>) {
  const api = useAccountApi()
  const notifier = useNotifier()
  const [code, setCode] = useState('')
  const [error, setError] = useState<keyof typeof ERRORS | null>(null)
  const [busy, setBusy] = useState(false)
  // 置き換えの確認に出す、この端末の項目の件数。null なら確認を出していない
  const [conflict, setConflict] = useState<number | null>(null)
  // 確認が閉じる動きの間も、件数を出しておく
  const shownConflict = useRetained(conflict)
  const inputId = useId()

  const send = async (replace: boolean) => {
    setBusy(true)
    try {
      const outcome = await api.restore(code, replace)
      setConflict(outcome.kind === 'conflict' ? outcome.localItemCount : null)
      if (outcome.kind === 'restored') onRestored(outcome.account)
      else if (outcome.kind !== 'conflict') setError(outcome.kind)
    } catch (caught) {
      setConflict(null)
      notifier.error('引き継げませんでした', caught)
    } finally {
      setBusy(false)
    }
  }
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (format.complete(code) && !busy) void send(false)
  }
  const change = (event: ChangeEvent<HTMLInputElement>) => {
    const { value } = event.currentTarget
    setCode(format.display(value))
    setError(null)
  }

  return (
    <form className={dialog.form} onSubmit={submit}>
      <label htmlFor={inputId} className={dialog.heading}>
        復旧コードを入れる
      </label>
      <input
        id={inputId}
        className={styles.codeInput}
        value={code}
        onChange={change}
        placeholder="ABCD-EFGH-JKMN-PQRS"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        enterKeyHint="go"
        aria-invalid={error !== null}
        data-autofocus
      />
      {error !== null && (
        <p className={styles.error} role="alert">
          {ERRORS[error]}
        </p>
      )}
      <div className={dialog.actions}>
        <button type="button" className={dialog.cancel} disabled={busy} onClick={onClose}>
          キャンセル
        </button>
        <button type="submit" className={dialog.submit} disabled={busy || !format.complete(code)}>
          引き継ぐ
        </button>
      </div>
      <ConfirmDialog
        open={conflict !== null}
        message={`この端末のやりたいこと（${shownConflict ?? 0} 件）と写真は消え、復旧コードのリストに置き換わります`}
        confirmLabel="置き換える"
        cancelLabel="やめる"
        danger
        busy={busy}
        onConfirm={() => void send(true)}
        onCancel={() => setConflict(null)}
      />
    </form>
  )
}
