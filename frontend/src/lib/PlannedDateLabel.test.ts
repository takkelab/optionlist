import { describe, expect, it } from 'vitest'
import { PlannedDateLabel } from './PlannedDateLabel'

const label = new PlannedDateLabel()

describe('PlannedDateLabel.long', () => {
  it.each([
    ['2026-11-23', '2026/11/23（月）'],
    ['2026-11-01', '2026/11/1（日）'],
    ['2028-02-29', '2028/2/29（火）'],
    ['2027-01-02', '2027/1/2（土）'],
  ])('shows %s as %s', (date, expected) => {
    expect(label.long(date)).toBe(expected)
  })
})

describe('PlannedDateLabel.until', () => {
  it.each([
    ['2026-11-03', '今日'],
    ['2026-11-04', '明日'],
    ['2026-11-23', 'あと 20 日'],
    ['2027-01-05', 'あと 63 日'],
    ['2026-11-02', '1 日前'],
    ['2025-11-03', '365 日前'],
  ])('shows %s seen from 2026-11-03 as %s', (date, expected) => {
    expect(label.until(date, '2026-11-03')).toBe(expected)
  })
})
