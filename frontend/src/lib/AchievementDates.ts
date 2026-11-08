import type { Achievement } from '../../../shared/types'
import { WEEKDAYS } from './PlannedDateLabel'

export type AchievementRow = { achievement: Achievement; label: string }

export interface AchievementDateFormatter {
  // 項目のシートの「達成した日」。新しい順に、達成と「2026/11/3（火）」
  history(achievements: Achievement[]): AchievementRow[]
  // やったリストのカードの「10月31日に移動」
  moved(completedAt: string): string
}

// 達成・完了の日時（ISO 8601、UTC）を、端末のタイムゾーンでの日付にして出す（screens.md §3・§6）
export class AchievementDates implements AchievementDateFormatter {
  history(achievements: Achievement[]): AchievementRow[] {
    return achievements
      .toSorted((a, b) => this.#time(b) - this.#time(a) || b.id - a.id)
      .map((achievement) => ({ achievement, label: this.#long(new Date(achievement.achievedAt)) }))
  }

  moved(completedAt: string): string {
    const date = new Date(completedAt)
    return `${date.getMonth() + 1}月${date.getDate()}日に移動`
  }

  #time(achievement: Achievement): number {
    return Date.parse(achievement.achievedAt)
  }

  #long(date: Date): string {
    return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}（${WEEKDAYS[date.getDay()]}）`
  }
}
