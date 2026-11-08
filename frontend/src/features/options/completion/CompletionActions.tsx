import { useCallback, useState } from 'react'
import type { Achievement, Option, OptionStatus } from '../../../../../shared/types'
import { useNotifier } from '../../../app/hooks'
import { PraiseMessages } from '../../../lib/PraiseMessages'
import type { PhotoSave } from '../photo/usePhotoSave'
import { AchievedDialog } from './AchievedDialog'
import { Celebration } from './Celebration'
import styles from './CompletionActions.module.css'
import { PhotoPrompt } from './PhotoPrompt'

const praises = new PraiseMessages()

type Props = {
  option: Option
  // シートが開いているか。閉じたあとに演出が終わっても、移動の確認は出さない
  active: boolean
  // 作った達成記録を返す。失敗したら null で、トーストで知らせる（OptionListActions）
  onAchieve: (id: number) => Promise<Achievement | null>
  // 成功したら true。失敗はトーストで知らせる（OptionListActions）
  onMove: (id: number, status: OptionStatus) => Promise<boolean>
  onClose: () => void
  photos: PhotoSave
}

// screens.md §4 の完了フロー。🎉 で達成を記録 → 労いの演出 → やりたいリストの項目なら「やったリストに移動しますか？」（写真の枠つき）、やったリストの項目なら「写真を残しますか？」
// やったリストの項目には「やりたいリストに戻す」も出す（§3）。移したら・戻したらシートを閉じてトーストで知らせる
export function CompletionActions({ option, active, onAchieve, onMove, onClose, photos }: Props) {
  const notifier = useNotifier()
  const { id, title, status } = option
  // 保存を待つ間は、もう一度押せないようにする（達成が 2 回記録されないように）
  const [saving, setSaving] = useState(false)
  // 戻す・移すの保存を待つ間も、もう一度押せないようにする
  const [moving, setMoving] = useState(false)
  const [praise, setPraise] = useState<{ message: string; round: number; achievementId: number } | null>(null)
  // 演出のあとの確認。閉じる動きの間も中身を残すよう、閉じても達成は覚えておく
  const [answering, setAnswering] = useState<{ achievementId: number; open: boolean } | null>(null)
  const closeAnswer = useCallback(() => setAnswering((last) => (last === null ? null : { ...last, open: false })), [])

  // 文言は押す前の回数で決める（初めてか 2 回目以降か）。この端末の一覧が古いと、別の端末で押した分は数えない
  const achieve = async () => {
    const message = praises.for(option.achievementCount)
    setSaving(true)
    const saved = await onAchieve(id)
    setSaving(false)
    if (saved !== null) setPraise((last) => ({ message, round: (last?.round ?? 0) + 1, achievementId: saved.id }))
  }
  const achievementId = praise?.achievementId ?? null
  const celebrated = useCallback(() => {
    setPraise(null)
    if (active && achievementId !== null) setAnswering({ achievementId, open: true })
  }, [achievementId, active])
  const move = async (to: OptionStatus) => {
    closeAnswer()
    setMoving(true)
    const moved = await onMove(id, to)
    setMoving(false)
    if (!moved) {
      // やったリストへ移す入口はこの確認だけなので、答え直せるように開き直す（🎉 を押し直すと達成が余分に増える）。
      // 戻すほうはシートのボタンから押し直せるので開かない（前の 🎉 の「写真を残しますか？」が出てしまう）
      if (to === 'completed') setAnswering((last) => (last === null ? null : { ...last, open: true }))
      return
    }
    onClose()
    notifier.info(to === 'completed' ? `『${title}』をやったリストに移しました` : `『${title}』をやりたいリストに戻しました`)
  }

  return (
    <div className={styles.actions}>
      <button type="button" className={styles.achieve} disabled={saving || photos.busy} onClick={() => void achieve()}>
        🎉 やった
      </button>
      {status === 'completed' && (
        <button type="button" className={styles.back} disabled={moving} onClick={() => void move('pending')}>
          やりたいリストに戻す
        </button>
      )}
      <Celebration message={praise === null ? null : praise.message} round={praise === null ? 0 : praise.round} onDone={celebrated} />
      {status === 'completed' && (
        <PhotoPrompt achievementId={answering?.open === true ? answering.achievementId : null} savePhoto={photos.savePhoto} onDone={closeAnswer} />
      )}
      {status === 'pending' && answering !== null && (
        <AchievedDialog
          key={answering.achievementId}
          achievementId={answering.achievementId}
          open={answering.open && active}
          savePhoto={photos.savePhoto}
          busy={photos.busy}
          onMove={() => void move('completed')}
          onStay={closeAnswer}
        />
      )}
    </div>
  )
}
