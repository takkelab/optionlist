import { describe, expect, it } from 'vitest'
import { RandomPick } from './RandomPick'

describe('RandomPick.pick', () => {
  it('returns null for an empty list', () => {
    expect(new RandomPick(() => 0).pick([])).toBeNull()
  })

  it.each([
    [0, 'a'],
    [0.5, 'b'],
    [0.99, 'c'],
  ])('maps random %d to %s', (random, expected) => {
    expect(new RandomPick(() => random).pick(['a', 'b', 'c'])).toBe(expected)
  })

  // Math.random は 1 未満だが、差し替えた乱数が 1 を返しても範囲外にしない
  it('stays in range when the random value is 1', () => {
    expect(new RandomPick(() => 1).pick(['a', 'b'])).toBe('b')
  })

  it('does not pick the previous item again when there are others', () => {
    expect(new RandomPick(() => 0).pick(['a', 'b', 'c'], 'a')).toBe('b')
  })

  it('picks the only item even if it was the previous one', () => {
    expect(new RandomPick(() => 0).pick(['a'], 'a')).toBe('a')
  })
})
