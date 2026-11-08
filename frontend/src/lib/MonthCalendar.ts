import { WEEKDAYS } from './PlannedDateLabel'

export type YearMonth = { year: number; month: number }
// weekday は 0 = 日曜 〜 6 = 土曜
export type CalendarDay = { date: string; day: number; weekday: number }

export interface CalendarRule {
  // 開いたときに出す月。予定日（YYYY-MM-DD）があればその月、未定なら today の月
  initial(plannedOn: string | null, today: Date): YearMonth
  // delta か月ずらす（12 月の次は翌年の 1 月）
  shift(view: YearMonth, delta: number): YearMonth
  // 日曜はじまりの週ごとの並び。月の前後の空きは null
  weeks(view: YearMonth): (CalendarDay | null)[][]
  // 端末の時計での今日（YYYY-MM-DD）
  today(now: Date): string
  // 「2026年11月」
  title(view: YearMonth): string
  // 読み上げ用の「2026年11月23日（月）」
  spoken(day: CalendarDay): string
}

// screens.md §3 の予定日のカレンダー。日付だけなので UTC で計算する
export class MonthCalendar implements CalendarRule {
  initial(plannedOn: string | null, today: Date): YearMonth {
    if (plannedOn === null) return { year: today.getFullYear(), month: today.getMonth() + 1 }
    const [year = 0, month = 0] = plannedOn.split('-').map(Number)
    return { year, month }
  }

  shift(view: YearMonth, delta: number): YearMonth {
    const index = view.year * 12 + (view.month - 1) + delta
    return { year: Math.floor(index / 12), month: (index % 12) + 1 }
  }

  weeks(view: YearMonth): (CalendarDay | null)[][] {
    const { year, month } = view
    const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay()
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
    const cells: (CalendarDay | null)[] = Array.from({ length: first }, () => null)
    for (let day = 1; day <= last; day++) {
      cells.push({ date: this.#format(year, month, day), day, weekday: (first + day - 1) % 7 })
    }
    while (cells.length % 7 !== 0) cells.push(null)
    return Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7))
  }

  today(now: Date): string {
    return this.#format(now.getFullYear(), now.getMonth() + 1, now.getDate())
  }

  title(view: YearMonth): string {
    return `${view.year}年${view.month}月`
  }

  spoken(day: CalendarDay): string {
    const { date } = day
    const [year, month] = date.split('-').map(Number)
    return `${year}年${month}月${day.day}日（${WEEKDAYS[day.weekday]}）`
  }

  #format(year: number, month: number, day: number): string {
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }
}
