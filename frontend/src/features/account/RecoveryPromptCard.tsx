import { useEffect, useState } from 'react'
import { useAccountApi, useAccountChanges, useAccountMemo } from '../../app/hooks'
import { RecoveryPrompt } from '../../lib/RecoveryPrompt'
import styles from './Account.module.css'
import { RecoveryCodeDialog } from './RecoveryCodeDialog'
import { useRecoveryCode } from './useRecoveryCode'

const rule = new RecoveryPrompt()

type Props = { pendingCount: number; sheetOpen: boolean }

// screens.md §9 の「復旧コードを控えるよう勧める」。やりたいリストの一番上（「今日はこれどう？」の上）に出す小さなカード。
// [控える] でも [あとで] でも二度と出さない（端末に覚える）。アカウントの状態は、ほかの条件がそろったときだけ読む
export function RecoveryPromptCard({ pendingCount, sheetOpen }: Props) {
  const api = useAccountApi()
  const memo = useAccountMemo()
  const { version } = useAccountChanges()
  const recovery = useRecoveryCode()
  const [answered, setAnswered] = useState(() => memo.promptAnswered())
  // 写真を保存したかは、シートを閉じたとき（写真を保存しうる流れが終わったとき）に読み直す
  const [photoSaved, setPhotoSaved] = useState(() => memo.photoSaved())
  const [wasSheetOpen, setWasSheetOpen] = useState(sheetOpen)
  if (sheetOpen !== wasSheetOpen) {
    setWasSheetOpen(sheetOpen)
    if (!sheetOpen) setPhotoSaved(memo.photoSaved())
  }
  const [hasRecoveryCode, setHasRecoveryCode] = useState<boolean | null>(null)
  const state = { pendingCount, photoSaved, answered, hasRecoveryCode, sheetOpen }
  const needsStatus = rule.needsStatus(state)

  useEffect(() => {
    if (!needsStatus) return undefined
    let active = true
    api
      .status()
      .then((status) => {
        if (active) setHasRecoveryCode(status.hasRecoveryCode)
      })
      // 読めなくても画面の操作は止めない（カードを出さないだけ）。失敗は console に残す
      .catch((error: unknown) => console.warn('アカウントの状態を読めませんでした', error))
    return () => {
      active = false
    }
  }, [api, needsStatus, version])

  const answer = () => {
    memo.answerPrompt()
    setAnswered(true)
  }
  const keep = async () => {
    if (await recovery.issue()) answer()
  }
  return (
    <>
      {rule.shows(state) && (
        <section className={styles.prompt} aria-label="復旧コードを控える">
          <p>機種変更やブラウザの掃除に備えて、復旧コードを控えておきませんか？</p>
          <div className={styles.promptActions}>
            <button type="button" className={styles.later} onClick={answer}>
              あとで
            </button>
            <button type="button" className={styles.keep} disabled={recovery.busy} onClick={() => void keep()}>
              控える
            </button>
          </div>
        </section>
      )}
      <RecoveryCodeDialog code={recovery.code} onClose={recovery.close} />
    </>
  )
}
