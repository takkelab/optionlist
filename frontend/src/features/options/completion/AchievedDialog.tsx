import { useEffect, useRef, useState } from 'react'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { Icon } from '../../../components/Icon'
import { usePhotoPicker } from '../photo/usePhotoPicker'
import type { SavePhoto } from '../photo/usePhotoSave'
import styles from './AchievedDialog.module.css'

type Props = {
  // 写真を付ける達成。達成ごとに key で作り直す
  achievementId: number
  open: boolean
  savePhoto: SavePhoto
  // 写真の保存を待っている間は true
  busy: boolean
  onMove: () => void
  onStay: () => void
}

// screens.md §4: 🎉 の演出のあとに、やったリストへの移動を聞く。写真はオプションなので、聞かずに枠のボタンだけを置く（押さなくても答えられる）。
// 選んだ写真はその場で保存する。保存が終わるまで答えられない（移した先の一覧を読むときに、写真が間に合っているように）
export function AchievedDialog({ achievementId, open, savePhoto, busy, onMove, onStay }: Props) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  useEffect(() => {
    if (photoUrl === null) return undefined
    return () => URL.revokeObjectURL(photoUrl)
  }, [photoUrl])
  // 保存を待つ間にシートを閉じると、このダイアログはもうない。解放する人がいないので、URL を作らない
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const picker = usePhotoPicker((file) => {
    void savePhoto(achievementId, file).then((saved) => {
      if (saved && mounted.current) setPhotoUrl(URL.createObjectURL(file))
    })
  })
  return (
    <ConfirmDialog
      open={open}
      message="やったリストに移動しますか？"
      confirmLabel="移動する"
      cancelLabel="このまま残す"
      busy={busy}
      split
      onConfirm={onMove}
      onCancel={onStay}
    >
      {picker.input}
      {photoUrl === null ? (
        <button type="button" className={styles.pick} disabled={busy} onClick={picker.open}>
          {busy ? (
            '保存しています…'
          ) : (
            <>
              <Icon name="camera" size={30} />
              写真を残す
              <span className={styles.hint}>なくても大丈夫です</span>
            </>
          )}
        </button>
      ) : (
        <div className={styles.filled}>
          <img className={styles.photo} src={photoUrl} alt="付けた写真" />
          <button type="button" className={styles.repick} disabled={busy} onClick={picker.open}>
            {busy ? '保存しています…' : '選び直す'}
          </button>
        </div>
      )}
    </ConfirmDialog>
  )
}
