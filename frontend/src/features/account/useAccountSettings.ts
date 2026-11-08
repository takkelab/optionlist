import { useCallback, useEffect, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { AccountStatus } from '../../../../shared/types'
import { useAccountApi, useAccountChanges, useAccountMemo, useNotifier } from '../../app/hooks'
import { useRecoveryCode } from './useRecoveryCode'
import type { RecoveryCodeIssue } from './useRecoveryCode'

export type AccountSettings = {
  // 開くたびに読み直す。読み終わるまでは null
  status: AccountStatus | null
  // 引き継いで使ったコードが消えたので、新しいコードを控えてほしいか（「機種変更に備える」の印）
  needsNewCode: boolean
  code: RecoveryCodeIssue
  restoring: boolean
  setRestoring(open: boolean): void
  restored(account: AccountStatus): void
  removing: boolean
  setRemoving(open: boolean): void
  removeBusy: boolean
  removeAll(): Promise<void>
}

// 設定のシート（screens.md §9）の状態と操作。引き継いだ・すべて消したら、シートを閉じて一覧を読み直す
export function useAccountSettings(open: boolean, onClose: () => void): AccountSettings {
  const memo = useAccountMemo()
  const notifier = useNotifier()
  const changes = useAccountChanges()
  const code = useRecoveryCode()
  const [status, setStatus] = useAccountStatus(open, code.code === null)
  const [restoring, setRestoring] = useState(false)
  // 引き継いだ・消したあとは、前のアカウントの状態を次に開いたときに一瞬でも出さない
  const finish = useCallback(() => {
    setStatus(null)
    onClose()
    changes.changed()
  }, [setStatus, onClose, changes])
  const remove = useRemoveAll(finish)

  // 自分のコードを自分の端末で入れたとき（作った日時が同じアカウント）は、何も消えていない（api.md §6）
  const restored = useCallback(
    (account: AccountStatus) => {
      const same = status !== null && status.hasAccount && status.createdAt === account.createdAt
      memo.setNeedsNewCode(true)
      setRestoring(false)
      finish()
      notifier.info(same ? '引き継ぎました' : '引き継ぎました。前の端末では使えなくなりました')
    },
    [status, memo, finish, notifier],
  )

  return { status, needsNewCode: memo.needsNewCode(), code, restoring, setRestoring, restored, ...remove }
}

// 開いたとき・コードの表示を閉じたとき（発行したあと）に、アカウントの状態を読み直す
function useAccountStatus(open: boolean, idle: boolean): [AccountStatus | null, Dispatch<SetStateAction<AccountStatus | null>>] {
  const api = useAccountApi()
  const notifier = useNotifier()
  const [status, setStatus] = useState<AccountStatus | null>(null)
  useEffect(() => {
    if (!open || !idle) return undefined
    let active = true
    api
      .status()
      .then((loaded) => {
        if (active) setStatus(loaded)
      })
      .catch((error: unknown) => notifier.error('設定を読み込めませんでした', error))
    return () => {
      active = false
    }
  }, [open, idle, api, notifier])
  return [status, setStatus]
}

type RemoveAll = Pick<AccountSettings, 'removing' | 'setRemoving' | 'removeBusy' | 'removeAll'>

// すべてのデータを消す（確認のあとで）
function useRemoveAll(finish: () => void): RemoveAll {
  const api = useAccountApi()
  const memo = useAccountMemo()
  const notifier = useNotifier()
  const [removing, setRemoving] = useState(false)
  const [removeBusy, setRemoveBusy] = useState(false)
  const removeAll = useCallback(async () => {
    setRemoveBusy(true)
    try {
      await api.removeAll()
      memo.setNeedsNewCode(false)
      setRemoving(false)
      finish()
      notifier.info('すべてのデータを消しました')
    } catch (error) {
      notifier.error('データを消せませんでした', error)
    } finally {
      setRemoveBusy(false)
    }
  }, [api, memo, finish, notifier])
  return { removing, setRemoving, removeBusy, removeAll }
}
