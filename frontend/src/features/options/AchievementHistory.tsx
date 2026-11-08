import { useRef, useState } from 'react'
import type { Achievement } from '../../../../shared/types'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { AchievementDates } from '../../lib/AchievementDates'
import styles from './AchievementHistory.module.css'
import { usePhotoPicker } from './photo/usePhotoPicker'
import type { PhotoSave } from './photo/usePhotoSave'

const dates = new AchievementDates()

type Props = {
  achievements: Achievement[] | null
  photos: PhotoSave
}

// screens.md §3 の「達成した日」。🎉 を押した日を新しい順に出す（1 回以上のとき）。日ごとに写真を付ける・付け替える・消す
// 達成記録はシートが詳細（useOptionDetail）から渡す。読む間（null）は何も出さない
export function AchievementHistory({ achievements, photos }: Props) {
  const { savePhoto, removePhoto, busy } = photos
  // 「保存しています…」を出す行
  const [saving, setSaving] = useState<number | null>(null)
  const [removing, setRemoving] = useState<number | null>(null)
  // 選択の画面を開いている間に覚えておく、写真を付ける先
  const target = useRef<number | null>(null)
  const picker = usePhotoPicker((file) => {
    const { current: achievementId } = target
    if (achievementId === null) return
    setSaving(achievementId)
    void savePhoto(achievementId, file).finally(() => setSaving(null))
  })
  const pick = (achievementId: number) => {
    target.current = achievementId
    picker.open()
  }
  const remove = () => {
    if (removing === null) return
    setRemoving(null)
    void removePhoto(removing)
  }

  if (achievements === null) return null
  const rows = dates.history(achievements)
  if (rows.length === 0) return null
  return (
    <section className={styles.history} aria-label="達成した日">
      <h3 className={styles.heading}>達成した日</h3>
      <ul className={styles.list}>
        {rows.map(({ achievement, label }) => {
          const { id, photoUrl } = achievement
          const savingHere = busy && saving === id
          return (
            <li key={id} className={styles.row}>
              <div className={styles.line}>
                <span data-history-date>{label}</span>
                {photoUrl === null && (
                  <button type="button" className={styles.action} disabled={busy} onClick={() => pick(id)}>
                    {savingHere ? '保存しています…' : '写真を付ける'}
                  </button>
                )}
              </div>
              {photoUrl !== null && (
                <>
                  <img className={styles.photo} src={photoUrl} alt={`${label}の写真`} loading="lazy" />
                  <div className={styles.photoActions}>
                    <button type="button" className={styles.action} disabled={busy} onClick={() => pick(id)}>
                      {savingHere ? '保存しています…' : '付け替える'}
                    </button>
                    <button type="button" className={styles.remove} disabled={busy} onClick={() => setRemoving(id)}>
                      写真を消す
                    </button>
                  </div>
                </>
              )}
            </li>
          )
        })}
      </ul>
      {picker.input}
      <ConfirmDialog
        open={removing !== null}
        message="この写真を消しますか？"
        confirmLabel="消す"
        danger
        onConfirm={remove}
        onCancel={() => setRemoving(null)}
      />
    </section>
  )
}
