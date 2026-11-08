import { describe, expect, it } from 'vitest'
import { HistoryScroll } from './ScrollMemory'

describe('HistoryScroll', () => {
  it('restores the position saved for the same history entry', () => {
    const scroll = new HistoryScroll()
    scroll.save('a', 120)
    scroll.save('b', 0)
    scroll.save('a', 300)
    expect(scroll.restore('a')).toBe(300)
    expect(scroll.restore('b')).toBe(0)
  })

  it('returns null for an entry it has not seen', () => {
    expect(new HistoryScroll().restore('a')).toBeNull()
  })
})
