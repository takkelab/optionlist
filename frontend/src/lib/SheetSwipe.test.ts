import { describe, expect, it } from 'vitest'
import { SheetSwipe } from './SheetSwipe'
import type { SwipeState } from './SheetSwipe'

const swipe = new SheetSwipe()
const started = swipe.start({ x: 100, y: 200, at: 0 }, false)

describe('SheetSwipe.move', () => {
  it('waits until the finger moves a little, so a tap is not a pull', () => {
    expect(swipe.move(started, { x: 103, y: 205, at: 10 }, 0)).toBe(started)
  })

  it('pulls the sheet when the finger moves down at the top of the content', () => {
    expect(swipe.move(started, { x: 102, y: 240, at: 20 }, 0)).toMatchObject({ from: 200, by: 40, at: 20, speed: 2 })
  })

  it('leaves sideways and upward moves, and moves in scrolled content, to scrolling', () => {
    expect(swipe.move(started, { x: 140, y: 220, at: 20 }, 0)).toBeNull()
    expect(swipe.move(started, { x: 100, y: 160, at: 20 }, 0)).toBeNull()
    expect(swipe.move(started, { x: 100, y: 240, at: 20 }, 30)).toBeNull()
    // 1px までは一番上とみなす
    expect(swipe.move(started, { x: 100, y: 240, at: 20 }, 0.5)).toMatchObject({ by: 40 })
  })

  it('pulls from the grip even when the content is scrolled', () => {
    const fromGrip = swipe.start({ x: 100, y: 200, at: 0 }, true)
    expect(swipe.move(fromGrip, { x: 100, y: 240, at: 20 }, 300)).toMatchObject({ by: 40 })
  })

  it('keeps following the finger once pulling, without going above the start', () => {
    const pulling = swipe.move(started, { x: 100, y: 240, at: 20 }, 0) as SwipeState
    expect(swipe.move(pulling, { x: 100, y: 230, at: 40 }, 0)).toMatchObject({ by: 30, speed: -0.5 })
    expect(swipe.move(pulling, { x: 100, y: 150, at: 40 }, 0)).toMatchObject({ by: 0 })
  })
})

describe('SheetSwipe.closes', () => {
  const pulled = (by: number, speed: number): SwipeState => ({ x: 100, y: 200, from: 200, by, at: 100, speed, fromGrip: false })

  it('closes when pulled further than 80px, even after stopping', () => {
    expect(swipe.closes(pulled(81, 0), 1000)).toBe(true)
    expect(swipe.closes(pulled(80, 0), 1000)).toBe(false)
  })

  it('closes on a quick flick, but not when the finger stopped before release', () => {
    expect(swipe.closes(pulled(40, 1), 150)).toBe(true)
    expect(swipe.closes(pulled(40, 1), 250)).toBe(false)
    expect(swipe.closes(pulled(40, 0.4), 150)).toBe(false)
  })

  it('does not close when the sheet was never pulled', () => {
    expect(swipe.closes(started, 10)).toBe(false)
  })
})
