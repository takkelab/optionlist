import { describe, expect, it } from 'vitest'
import { SuggestionLabels } from './SuggestionLabels'

const labels = new SuggestionLabels()

describe('SuggestionLabels', () => {
  it('lists sizes from small to large with their labels', () => {
    expect(labels.sizes().map((size) => labels.size(size))).toEqual(['1 時間以内', '半日', '1 日', '泊まり'])
  })

  it.each([
    [11, 12, '11〜12 月'],
    [12, 2, '12〜2 月'],
    [6, 6, '6 月'],
    [null, null, null],
  ])('formats season %s–%s as %s', (from, to, expected) => {
    expect(labels.season(from, to)).toBe(expected)
  })

  it.each([
    [11, '11 月まで'],
    [2, '2 月まで'],
    [null, null],
  ])('formats the end of season %s as %s', (to, expected) => {
    expect(labels.until(to)).toBe(expected)
  })

  it.each([
    [1, 1],
    [10, 10],
    [11, 1],
    [23, 3],
  ])('gives theme %d the color slot %d', (themeId, slot) => {
    expect(labels.colorSlot(themeId)).toBe(slot)
  })

  it.each([
    ['pending', '追加済み'],
    ['completed', 'やった'],
    [null, null],
  ] as const)('marks option status %s as %s', (status, expected) => {
    expect(labels.mark(status)).toBe(expected)
  })
})
