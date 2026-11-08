import { describe, expect, it } from 'vitest'
import { ShelfScroll } from './ShelfScroll'

const shelf = new ShelfScroll()

describe('ShelfScroll.edges', () => {
  it.each([
    [{ scrollLeft: 0, clientWidth: 900, scrollWidth: 1100 }, { canPrev: false, canNext: true }],
    [{ scrollLeft: 100, clientWidth: 900, scrollWidth: 1100 }, { canPrev: true, canNext: true }],
    [{ scrollLeft: 200, clientWidth: 900, scrollWidth: 1100 }, { canPrev: true, canNext: false }],
    // 端数で 0.5px 足りないだけなら端とみなす
    [{ scrollLeft: 199.5, clientWidth: 900, scrollWidth: 1100 }, { canPrev: true, canNext: false }],
    [{ scrollLeft: 0, clientWidth: 900, scrollWidth: 900 }, { canPrev: false, canNext: false }],
  ])('reads %o as %o', (box, expected) => {
    expect(shelf.edges(box)).toEqual(expected)
  })
})

describe('ShelfScroll.step', () => {
  it('moves by 80% of the visible width', () => {
    expect(shelf.step({ scrollLeft: 0, clientWidth: 928, scrollWidth: 2000 })).toBe(742)
  })
})
