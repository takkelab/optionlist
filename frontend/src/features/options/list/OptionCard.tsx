import { useState } from 'react'
import type { ReactNode } from 'react'
import type { Option } from '../../../../../shared/types'
import { AchievementLabel } from '../../../lib/AchievementLabel'
import { MonthCalendar } from '../../../lib/MonthCalendar'
import { PlannedDateLabel } from '../../../lib/PlannedDateLabel'
import styles from '../OptionCard.module.css'

const achievements = new AchievementLabel()
const dates = new PlannedDateLabel()
const calendar = new MonthCalendar()

type Props = {
  option: Option
  onOpen: (option: Option) => void
  // 左端の並び替えの取っ手（予定日がないものだけ）。ないときも同じ幅を空けて、タイトルの始まりをそろえる（screens.md §2）
  handle?: ReactNode
}

// やりたいリストのカード。ふと見て「やってみようかな」と探せるよう、タイトルと予定日・達成回数だけを出す。タップで項目のシートを開く（screens.md §2・§3）
export function OptionCard({ option, onOpen, handle }: Props) {
  const count = achievements.format(option.achievementCount)
  const { plannedOn } = option
  // 「あと何日」の基準の日。描画のたびに時刻を読まないよう、最初に 1 回だけ読む
  const [today] = useState(() => calendar.today(new Date()))
  return (
    <div className={styles.card}>
      {handle ?? <span className={styles.handleSpace} />}
      <button type="button" className={styles.open} onClick={() => onOpen(option)}>
        <span className={styles.title} data-option-title>
          {option.title}
        </span>
        {plannedOn !== null && (
          <span className={styles.plan} data-planned-on>
            <span className={styles.until}>{dates.until(plannedOn, today)}</span>
            <span className={styles.date}>{dates.long(plannedOn)}</span>
          </span>
        )}
        {count !== null && <span className={styles.count}>{count}</span>}
      </button>
    </div>
  )
}
