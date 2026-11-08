import { describe, expect, it } from 'vitest'
import { ConfettiBurst } from './ConfettiBurst'

const burst = new ConfettiBurst()

describe('ConfettiBurst.pieces', () => {
  it('spreads the pieces all around the center', () => {
    const pieces = burst.pieces(16)
    expect(pieces).toHaveLength(16)
    expect(pieces.some((p) => p.x > 0)).toBe(true)
    expect(pieces.some((p) => p.x < 0)).toBe(true)
    expect(pieces.some((p) => p.y < 0)).toBe(true)
    expect(pieces.some((p) => p.y > 0)).toBe(true)
  })

  it('starts the first piece straight up and alternates the distance', () => {
    const [first, second] = burst.pieces(4)
    expect(first).toEqual({ x: 0, y: -80, rotate: 90, delay: 0, kind: 0 })
    expect(second).toMatchObject({ x: 170, y: 40, rotate: -105, kind: 1 })
  })

  it('uses four kinds of pieces in turn', () => {
    expect(burst.pieces(6).map((p) => p.kind)).toEqual([0, 1, 2, 3, 0, 1])
  })
})
