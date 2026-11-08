import type { Option } from '../../../../../shared/types'
import { AchievementDates } from '../../../lib/AchievementDates'
import { AchievementLabel } from '../../../lib/AchievementLabel'
import styles from './DoneCard.module.css'

const achievements = new AchievementLabel()
const dates = new AchievementDates()

// やったリストのタイル。写真があれば全面に敷いて文字を重ね、なければタイトルを大きく出す（写真の枠は作らない。screens.md §6）
// タップで項目のシートを開く
export function DoneCard({ option, onOpen }: { option: Option; onOpen: (option: Option) => void }) {
  const count = achievements.format(option.achievementCount)
  const { completedAt, latestPhotoUrl } = option
  const withPhoto = latestPhotoUrl !== null
  return (
    <button type="button" className={`${styles.tile} ${withPhoto ? styles.withPhoto : ''}`} onClick={() => onOpen(option)}>
      {withPhoto && <img className={styles.photo} src={latestPhotoUrl} alt="" loading="lazy" />}
      <span className={styles.content}>
        <span className={styles.title} data-option-title>
          {option.title}
        </span>
        <span className={styles.meta}>
          {completedAt !== null && <span data-completed-at>{dates.moved(completedAt)}</span>}
          {count !== null && <span>{count}</span>}
        </span>
      </span>
    </button>
  )
}
