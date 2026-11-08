import { describe, expect, it } from 'vitest'
import { AchievementDates } from './AchievementDates'

const dates = new AchievementDates()

// 日本時間でも UTC でも同じ日になる時刻（正午ごろ）を使う
describe('AchievementDates.history', () => {
  it('lists the dates newest first with the weekday', () => {
    const achievements = [
      { id: 1, optionId: 1, achievedAt: '2026-09-01T03:00:00.000Z', photoUrl: null },
      { id: 3, optionId: 1, achievedAt: '2026-11-03T03:00:00.000Z', photoUrl: '/api/photos/a.jpg' },
      { id: 2, optionId: 1, achievedAt: '2026-10-11T03:00:00.000Z', photoUrl: null },
    ]
    const rows = dates.history(achievements)
    expect(rows.map((row) => row.label)).toEqual(['2026/11/3（火）', '2026/10/11（日）', '2026/9/1（火）'])
    expect(rows[0]).toMatchObject({ achievement: { id: 3, photoUrl: '/api/photos/a.jpg' } })
  })

  it('is empty before the first achievement', () => {
    expect(dates.history([])).toEqual([])
  })
})

describe('AchievementDates.moved', () => {
  it('shows the month and day of the move', () => {
    expect(dates.moved('2026-10-31T03:00:00.000Z')).toBe('10月31日に移動')
  })
})
