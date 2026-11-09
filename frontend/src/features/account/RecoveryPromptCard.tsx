import { useEffect, useState } from 'react'
import { useAccountApi, useAccountChanges, useAccountMemo } from '../../app/hooks'
import { RecoveryPrompt } from '../../lib/RecoveryPrompt'
import type { PromptAccount } from '../../lib/RecoveryPrompt'
import styles from './Account.module.css'
import { RecoveryCodeDialog } from './RecoveryCodeDialog'
import { useRecoveryCode } from './useRecoveryCode'

const rule = new RecoveryPrompt()

type Props = { pendingCount: number; sheetOpen: boolean }

// screens.md §9 の「復旧コードを控えるよう勧める」。やりたいリストの一番上（「今日はこれどう？」の上）に出す小さなカード。
// [控える] でも [あとで] でも、設定のシートでコードを発行しても、二度と出さない（端末に覚える）。
// アカウントの状態は、ほかの条件がそろったときだけ読む（引き継いだ・すべて消したあとは読み直す）
export function RecoveryPromptCard({ pendingCount, sheetOpen }: Props) {
  const api = useAccountApi()
  const memo = useAccountMemo()
  // 設定のシートでコードを発行すると、この値（issues）が変わって描き直され、答えたかを端末から読み直す
  const { version } = useAccountChanges()
  const recovery = useRecoveryCode()
  const [answeredHere, setAnsweredHere] = useState(false)
  // 写真を保存したかは、シートを閉じたとき（写真を保存しうる流れが終わったとき）に読み直す
  const [photoSaved, setPhotoSaved] = useState(() => memo.photoSaved())
  const [wasSheetOpen, setWasSheetOpen] = useState(sheetOpen)
  if (sheetOpen !== wasSheetOpen) {
    setWasSheetOpen(sheetOpen)
    if (!sheetOpen) setPhotoSaved(memo.photoSaved())
  }
  const [account, setAccount] = useState<PromptAccount | null>(null)
  const answered = answeredHere || memo.promptAnswered()
  const state = { pendingCount, photoSaved, answered, account, sheetOpen }
  const needsStatus = rule.needsStatus(state)

  useEffect(() => {
    if (!needsStatus) return undefined
    let active = true
    api
      .status()
      .then((status) => {
        if (active) setAccount(status)
      })
      // 読めなくても画面の操作は止めない（カードを出さないだけ）。失敗は console に残す
      .catch((error: unknown) => console.warn('アカウントの状態を読めませんでした', error))
    return () => {
      active = false
    }
  }, [api, needsStatus, version])

  const later = () => {
    memo.answerPrompt()
    setAnsweredHere(true)
  }
  return (
    <>
      {rule.shows(state) && (
        <section className={styles.prompt} aria-label="復旧コードを控える">
          <p>機種変更やブラウザの掃除に備えて、復旧コードを控えておきませんか？</p>
          <div className={styles.promptActions}>
            <button type="button" className={styles.later} onClick={later}>
              あとで
            </button>
            {/* 発行できたら useRecoveryCode が「答えた」と覚える */}
            <button type="button" className={styles.keep} disabled={recovery.busy} onClick={() => void recovery.issue()}>
              控える
            </button>
          </div>
        </section>
      )}
      <RecoveryCodeDialog code={recovery.code} onClose={recovery.close} />
    </>
  )
}
