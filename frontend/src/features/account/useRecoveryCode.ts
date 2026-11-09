import { useCallback, useState } from 'react'
import { useAccountApi, useAccountChanges, useAccountMemo, useNotifier } from '../../app/hooks'

export type RecoveryCodeIssue = {
  // 表示している復旧コード。null なら閉じている
  code: string | null
  // 発行して表示する。発行できたら true
  issue(): Promise<boolean>
  busy: boolean
  close(): void
}

// 復旧コードを発行して、表示するダイアログに渡す（screens.md §9）。作り直すと前のコードは使えなくなる
export function useRecoveryCode(): RecoveryCodeIssue {
  const api = useAccountApi()
  const memo = useAccountMemo()
  const changes = useAccountChanges()
  const notifier = useNotifier()
  const [code, setCode] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const issue = useCallback(async (): Promise<boolean> => {
    setBusy(true)
    try {
      setCode(await api.issueRecoveryCode())
      // 新しいコードを控えたので、シートの印を外し、勧めるカードも二度と出さない（screens.md §9）
      memo.setNeedsNewCode(false)
      memo.answerPrompt()
      changes.issued()
      return true
    } catch (error) {
      notifier.error('復旧コードを作れませんでした', error)
      return false
    } finally {
      setBusy(false)
    }
  }, [api, memo, changes, notifier])
  const close = useCallback(() => setCode(null), [])
  return { code, issue, busy, close }
}
