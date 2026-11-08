export interface PlannedDateFormatter {
  // 「2026/11/23（月）」
  long(date: string): string
  // カードの「あと何日」。today（YYYY-MM-DD）から見て「今日」「明日」「あと 20 日」、過ぎていれば「3 日前」
  until(date: string, today: string): string
}

// 日曜から。予定日のカレンダー（MonthCalendar）でも使う
export const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

const DAY_MS = 24 * 60 * 60 * 1000

// 予定日（YYYY-MM-DD の日付だけ。screens.md §2・§3）の表示。日付だけなのでタイムゾーンでずらさない（曜日も UTC で求める）
export class PlannedDateLabel implements PlannedDateFormatter {
  long(date: string): string {
    const [year, month, day] = this.#parts(date)
    const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]
    return `${year}/${month}/${day}（${weekday}）`
  }

  until(date: string, today: string): string {
    const days = Math.round((this.#utc(date) - this.#utc(today)) / DAY_MS)
    if (days === 0) return '今日'
    if (days === 1) return '明日'
    return days > 0 ? `あと ${days} 日` : `${-days} 日前`
  }

  #utc(date: string): number {
    const [year, month, day] = this.#parts(date)
    return Date.UTC(year, month - 1, day)
  }

  #parts(date: string): [number, number, number] {
    const [year = 0, month = 0, day = 0] = date.split('-').map(Number)
    return [year, month, day]
  }
}
