import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useAccountApi } from '../../../app/hooks'
import styles from '../../../components/Dialog.module.css'

// 追加ダイアログの下の注記（screens.md §2、docs/decisions/0039）。この端末にアカウントがないときだけ、
// 追加で保存場所が作られることと、プライバシーポリシーへのリンクを出す。
// アカウントの有無は、ダイアログを開くたびに読む（最初の追加でアカウントができる・すべて消すとなくなるため）。
// 読めなければ出さない（追加の操作は止めない。失敗は console に残す）
export function AddDialogNote({ open }: { open: boolean }) {
  const noAccount = useNoAccount(open)
  if (!noAccount) return null
  return (
    <p className={styles.note}>
      追加すると、この端末用の保存場所が作られます。
      <Link to="/privacy" className={styles.noteLink}>
        プライバシーポリシー
      </Link>
    </p>
  )
}

function useNoAccount(open: boolean): boolean {
  const api = useAccountApi()
  const [noAccount, setNoAccount] = useState(false)
  // 開き直したら、読み終えるまで前の答えを出さない（最初の追加のあとに開き直すと、一瞬注記が出てしまうため）
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setNoAccount(false)
  }
  useEffect(() => {
    if (!open) return undefined
    let active = true
    api
      .status()
      .then((status) => {
        if (active) setNoAccount(!status.hasAccount)
      })
      .catch((error: unknown) => console.warn('アカウントの状態を読めませんでした', error))
    return () => {
      active = false
    }
  }, [api, open])
  return noAccount
}
