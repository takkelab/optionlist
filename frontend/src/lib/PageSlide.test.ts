import { describe, expect, it } from 'vitest'
import { PageSlide } from './PageSlide'
import type { TransitionHost } from './PageSlide'

// 呼ばれた順を記録する。animate を false にすると動かせない場所になる
class FakeHost implements TransitionHost {
  readonly #animate: boolean
  readonly #calls: string[] = []

  constructor(animate: boolean) {
    this.#animate = animate
  }

  canAnimate(): boolean {
    return this.#animate
  }

  setDirection(side: string | null): void {
    this.#calls.push(`direction ${String(side)}`)
  }

  // 本物と同じく、update が終わってから（後の見た目を撮ってから）動き出す
  async transition(update: () => Promise<void>): Promise<void> {
    this.#calls.push('transition')
    await update()
    this.#calls.push('snapshot')
  }

  async ready(selector: string): Promise<void> {
    this.#calls.push(`ready ${selector}`)
  }

  calls(): string[] {
    return [...this.#calls]
  }

  // 待っている Promise をすべて進める
  settle(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0))
  }
}

describe('PageSlide.slide', () => {
  it('switches, waits for the list before the snapshot, and clears the direction afterwards', async () => {
    const host = new FakeHost(true)
    const updates: string[] = []
    expect(new PageSlide(host).slide('done', () => updates.push('navigated'), '[data-list-ready]')).toBe(true)
    await host.settle()
    expect(updates).toEqual(['navigated'])
    expect(host.calls()).toEqual(['direction done', 'transition', 'ready [data-list-ready]', 'snapshot', 'direction null'])
  })

  it('keeps the direction of the latest switch when an earlier one finishes later', async () => {
    const host = new FakeHost(true)
    const slide = new PageSlide(host)
    slide.slide('done', () => undefined, '[data-list-ready]')
    slide.slide('wish', () => undefined, '[data-list-ready]')
    await host.settle()
    expect(host.calls().filter((call) => call.startsWith('direction'))).toEqual(['direction done', 'direction wish', 'direction null'])
  })

  it('leaves the switch to the caller when it cannot animate', () => {
    const host = new FakeHost(false)
    const updates: string[] = []
    expect(new PageSlide(host).slide('done', () => updates.push('navigated'), '[data-list-ready]')).toBe(false)
    expect(updates).toEqual([])
    expect(host.calls()).toEqual([])
  })
})
