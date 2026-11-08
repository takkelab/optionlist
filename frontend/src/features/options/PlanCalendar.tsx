import { useState } from 'react'
import { MonthCalendar } from '../../lib/MonthCalendar'
import type { CalendarDay, YearMonth } from '../../lib/MonthCalendar'
import styles from './PlanCalendar.module.css'

const calendar = new MonthCalendar()
const WEEKDAY_HEADINGS = ['日', '月', '火', '水', '木', '金', '土']
const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

type Props = { value: string | null; onChange: (date: string | null) => void }

// screens.md §3 の予定日のカレンダー。日付を押せばその日に決め、選んでいる日をもう一度押すと未定に戻す。
// 遠い月へは「2026年11月」を押して、12 か月のボタン（年は ‹ ›）で移る
export function PlanCalendar({ value, onChange }: Props) {
  const [view, setView] = useState<YearMonth>(() => calendar.initial(value, new Date()))
  // 描画のたびに時刻を読まないよう、最初に 1 回だけ読む
  const [today] = useState(() => calendar.today(new Date()))
  // 12 か月のボタンを出しているか。出している間は ‹ › で年を移る
  const [picking, setPicking] = useState(false)
  const step = picking ? 12 : 1
  const unit = picking ? '年' : '月'
  const pickMonth = (month: number) => {
    setView({ year: view.year, month })
    setPicking(false)
  }
  const choose = (day: CalendarDay) => onChange(day.date === value ? null : day.date)
  const dayClass = (day: CalendarDay) =>
    [styles.day, day.weekday === 0 && styles.sunday, day.weekday === 6 && styles.saturday, day.date === today && styles.today]
      .filter(Boolean)
      .join(' ')

  return (
    <div className={styles.calendar}>
      <div className={styles.header}>
        <button type="button" className={styles.move} onClick={() => setView(calendar.shift(view, -step))} aria-label={`前の${unit}`}>
          ‹
        </button>
        <button type="button" className={styles.title} onClick={() => setPicking(!picking)} aria-expanded={picking}>
          {picking ? `${view.year}年` : calendar.title(view)}
        </button>
        <button type="button" className={styles.move} onClick={() => setView(calendar.shift(view, step))} aria-label={`次の${unit}`}>
          ›
        </button>
      </div>
      {picking ? (
        <div className={styles.months}>
          {MONTHS.map((month) => (
            <button key={month} type="button" className={styles.month} aria-pressed={month === view.month} onClick={() => pickMonth(month)}>
              {month}月
            </button>
          ))}
        </div>
      ) : (
        <table className={styles.grid}>
          <thead>
            <tr>
              {WEEKDAY_HEADINGS.map((weekday, i) => (
                <th key={weekday} className={i === 0 ? styles.sunday : i === 6 ? styles.saturday : undefined}>
                  {weekday}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {calendar.weeks(view).map((week, w) => (
              <tr key={w}>
                {week.map((day, d) => (
                  <td key={d}>
                    {day !== null && (
                      <button
                        type="button"
                        className={dayClass(day)}
                        aria-label={calendar.spoken(day)}
                        aria-pressed={day.date === value}
                        onClick={() => choose(day)}
                      >
                        {day.day}
                      </button>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
