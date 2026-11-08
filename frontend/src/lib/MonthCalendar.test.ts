import { describe, expect, it } from 'vitest'
import { MonthCalendar } from './MonthCalendar'

const calendar = new MonthCalendar()

describe('MonthCalendar.initial', () => {
  it('starts from the month of the planned date', () => {
    expect(calendar.initial('2027-01-05', new Date(2026, 10, 3))).toEqual({ year: 2027, month: 1 })
  })

  it('starts from this month (local time) when the date is not planned', () => {
    expect(calendar.initial(null, new Date(2026, 10, 30, 23, 59))).toEqual({ year: 2026, month: 11 })
  })
})

describe('MonthCalendar.shift', () => {
  it.each([
    [{ year: 2026, month: 11 }, 1, { year: 2026, month: 12 }],
    [{ year: 2026, month: 12 }, 1, { year: 2027, month: 1 }],
    [{ year: 2027, month: 1 }, -1, { year: 2026, month: 12 }],
    [{ year: 2026, month: 11 }, 14, { year: 2028, month: 1 }],
  ])('moves %j by %i months to %j', (view, delta, expected) => {
    expect(calendar.shift(view, delta)).toEqual(expected)
  })
})

describe('MonthCalendar.weeks', () => {
  it('lays out the days from Sunday, with blanks before and after the month', () => {
    // 2026 年 11 月 1 日は日曜、30 日は月曜
    const weeks = calendar.weeks({ year: 2026, month: 11 })
    expect(weeks).toHaveLength(5)
    const [first] = weeks
    expect(first?.at(0)).toEqual({ date: '2026-11-01', day: 1, weekday: 0 })
    const last = weeks.at(-1) ?? []
    expect(last.map((d) => (d === null ? null : d.day))).toEqual([29, 30, null, null, null, null, null])
  })

  it('starts after blanks when the first day is not Sunday, and handles leap years', () => {
    // 2028 年 2 月 1 日は火曜、うるう年なので 29 日まで
    const weeks = calendar.weeks({ year: 2028, month: 2 })
    const [first] = weeks
    expect(first?.slice(0, 3)).toEqual([null, null, { date: '2028-02-01', day: 1, weekday: 2 }])
    const days = weeks.flat().filter((d) => d !== null)
    expect(days.at(-1)).toEqual({ date: '2028-02-29', day: 29, weekday: 2 })
  })
})

describe('MonthCalendar labels', () => {
  it('formats today, the title and the spoken date', () => {
    expect(calendar.today(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
    expect(calendar.title({ year: 2026, month: 11 })).toBe('2026年11月')
    expect(calendar.spoken({ date: '2026-11-23', day: 23, weekday: 1 })).toBe('2026年11月23日（月）')
  })
})
