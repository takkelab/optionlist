import { describe, expect, it } from 'vitest'
import { AchievementLabel } from './AchievementLabel'

const label = new AchievementLabel()

describe('AchievementLabel.format', () => {
  it('shows nothing before the first achievement', () => {
    expect(label.format(0)).toBeNull()
  })

  it.each([
    [1, '🎉×1'],
    [3, '🎉×3'],
  ])('shows %i as %s', (count, expected) => {
    expect(label.format(count)).toBe(expected)
  })
})
