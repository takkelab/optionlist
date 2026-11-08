export interface PlanDateSource {
  // 今年の次の年の日付（YYYY-MM-DD）。流す年によらず未来の日になる
  nextYear(month: number, day: number): string
  // シートの予定日の表示「2027/1/31（日）」
  long(date: string): string
  // カレンダーの日付のボタンの読み上げ名「2027年1月31日（日）」
  spoken(date: string): string
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

// E2E で使う予定日。曜日は流す年で変わるので、決め打ちせずに計算する
export class PlanDates implements PlanDateSource {
  nextYear(month: number, day: number): string {
    const year = new Date().getFullYear() + 1
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }

  long(date: string): string {
    const [year, month, day] = this.#parts(date)
    return `${year}/${month}/${day}（${this.#weekday(year, month, day)}）`
  }

  spoken(date: string): string {
    const [year, month, day] = this.#parts(date)
    return `${year}年${month}月${day}日（${this.#weekday(year, month, day)}）`
  }

  #weekday(year: number, month: number, day: number): string {
    return WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()] ?? ''
  }

  #parts(date: string): [number, number, number] {
    const [year = 0, month = 0, day = 0] = date.split('-').map(Number)
    return [year, month, day]
  }
}
