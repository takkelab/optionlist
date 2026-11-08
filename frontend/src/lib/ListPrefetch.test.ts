import { describe, expect, it } from 'vitest'
import type { Achievement, Option, OptionDetail, OptionStatus } from '../../../shared/types'
import type { OptionsApi } from '../api/client'
import { ListPrefetch } from './ListPrefetch'

// list を呼んだ回数を数える API。返す一覧には、何回目に読んだかを id に入れた項目が 1 つ入る。ほかは使わない
class CountingApi implements OptionsApi {
  #calls = 0
  #fail = false

  list(status: OptionStatus): Promise<Option[]> {
    this.#calls += 1
    if (this.#fail) return Promise.reject(new Error('GET が失敗した'))
    return Promise.resolve([
      {
        id: this.#calls,
        title: `${this.#calls} 回目`,
        status,
        suggestionId: null,
        plannedOn: null,
        achievementCount: 0,
        latestPhotoUrl: null,
        completedAt: null,
        createdAt: '2026-11-03T00:00:00.000Z',
        updatedAt: '2026-11-03T00:00:00.000Z',
      },
    ])
  }

  detail(_id: number): Promise<OptionDetail> {
    return Promise.reject(new Error('使わない'))
  }

  create(_title: string): Promise<Option> {
    return Promise.reject(new Error('使わない'))
  }

  update(_id: number): Promise<Option> {
    return Promise.reject(new Error('使わない'))
  }

  remove(_id: number): Promise<void> {
    return Promise.reject(new Error('使わない'))
  }

  achieve(_id: number): Promise<Achievement> {
    return Promise.reject(new Error('使わない'))
  }

  setPhoto(_achievementId: number, _photo: Blob): Promise<Achievement> {
    return Promise.reject(new Error('使わない'))
  }

  removePhoto(_achievementId: number): Promise<void> {
    return Promise.reject(new Error('使わない'))
  }

  reorder(_ids: number[]): Promise<void> {
    return Promise.reject(new Error('使わない'))
  }

  failNext(): void {
    this.#fail = true
  }

  calls(): number {
    return this.#calls
  }
}

interface TestClock {
  now(): number
  advance(ms: number): void
}

// 進められる時計
class ManualClock implements TestClock {
  #now = 0

  now(): number {
    return this.#now
  }

  advance(ms: number): void {
    this.#now += ms
  }
}

interface LoaderFactory {
  create(): { api: CountingApi; clock: ManualClock; loader: ListPrefetch }
}

class Fixture implements LoaderFactory {
  create(): { api: CountingApi; clock: ManualClock; loader: ListPrefetch } {
    const api = new CountingApi()
    const clock = new ManualClock()
    return { api, clock, loader: new ListPrefetch(api, () => clock.now()) }
  }
}

const fixture = new Fixture()

describe('ListPrefetch.load', () => {
  // 開発中の StrictMode は、画面を開くときの読み込みを 2 回走らせる
  it('uses the prefetched list while it is fresh, then loads again', async () => {
    const { api, clock, loader } = fixture.create()
    loader.prefetch('completed')
    await loader.load('completed')
    await loader.load('completed')
    expect(api.calls()).toBe(1)
    clock.advance(2001)
    await loader.load('completed')
    expect(api.calls()).toBe(2)
  })

  it('does not use a prefetch for the other list', async () => {
    const { api, loader } = fixture.create()
    loader.prefetch('completed')
    await loader.load('pending')
    expect(api.calls()).toBe(2)
  })

  it('passes a failure to the caller', async () => {
    const { api, loader } = fixture.create()
    api.failNext()
    await expect(loader.load('pending')).rejects.toThrow('GET が失敗した')
    expect(loader.cached('pending')).toBeNull()
  })
})

describe('ListPrefetch.cached', () => {
  it('is null before the list is read', () => {
    const { loader } = fixture.create()
    expect(loader.cached('pending')).toBeNull()
  })

  it('keeps the latest list read by a prefetch or a load for a minute', async () => {
    const { clock, loader } = fixture.create()
    loader.prefetch('completed')
    await loader.load('completed')
    expect(loader.cached('completed')).toMatchObject([{ id: 1, status: 'completed' }])
    clock.advance(3000)
    await loader.load('completed')
    expect(loader.cached('completed')).toMatchObject([{ id: 2 }])
    expect(loader.cached('pending')).toBeNull()
    clock.advance(60_001)
    expect(loader.cached('completed')).toBeNull()
  })

  it('remembers the list changed on the screen', () => {
    const { loader } = fixture.create()
    loader.remember('pending', [])
    expect(loader.cached('pending')).toEqual([])
  })

  // 項目を移した先の一覧は、移す前に読み始めた古い結果で埋めない
  it('forgets a list and ignores a read started before that', async () => {
    const { clock, loader } = fixture.create()
    loader.prefetch('completed')
    const reading = loader.load('completed')
    clock.advance(10)
    loader.forget('completed')
    await reading
    expect(loader.cached('completed')).toBeNull()
    clock.advance(3000)
    await loader.load('completed')
    expect(loader.cached('completed')).toMatchObject([{ id: 2 }])
  })
})
