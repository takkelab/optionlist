import { describe, expect, it } from 'vitest'
import type { Achievement, Option, OptionDetail, OptionStatus } from '../../../shared/types'
import type { OptionsApi, OptionUpdate } from '../api/client'
import { DoneListOrder } from './DoneListOrder'
import { OptionListActions } from './OptionListActions'
import type { FailureReporter } from './OptionListActions'
import type { ListOrder } from './WishListOrder'
import { WishListOrder } from './WishListOrder'

interface SampleSource {
  option(id: number): Option
}

// テスト用の項目
class Samples implements SampleSource {
  option(id: number): Option {
    return {
      id,
      title: `項目 ${id}`,
      status: 'pending',
      suggestionId: null,
      plannedOn: null,
      achievementCount: 0,
      latestPhotoUrl: null,
      completedAt: null,
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
    }
  }
}

const samples = new Samples()

// fail を true にすると、update と remove が失敗する API
class FakeApi implements OptionsApi {
  #fail = false
  #failDetail = false
  #latestPhotoUrl: string | null = null

  failNext(): void {
    this.#fail = true
  }

  failDetail(): void {
    this.#failDetail = true
  }

  list(_status: OptionStatus): Promise<Option[]> {
    return Promise.resolve([])
  }

  // 写真を変えたあとにカードの写真を読み直す
  detail(id: number): Promise<OptionDetail> {
    if (this.#failDetail) return Promise.reject(new Error('GET が失敗した'))
    return Promise.resolve({ ...samples.option(id), latestPhotoUrl: this.#latestPhotoUrl, achievements: [], firstStep: null })
  }

  create(_title: string): Promise<Option> {
    return Promise.reject(new Error('使わない'))
  }

  update(id: number, changes: OptionUpdate): Promise<Option> {
    if (this.#fail) return Promise.reject(new Error('PATCH が失敗した'))
    return Promise.resolve({ ...samples.option(id), ...changes })
  }

  remove(_id: number): Promise<void> {
    if (this.#fail) return Promise.reject(new Error('DELETE が失敗した'))
    return Promise.resolve()
  }

  achieve(id: number): Promise<Achievement> {
    if (this.#fail) return Promise.reject(new Error('POST が失敗した'))
    return Promise.resolve({ id: 1, optionId: id, achievedAt: '2026-11-03T01:00:00.000Z', photoUrl: null })
  }

  setPhoto(achievementId: number, _photo: Blob): Promise<Achievement> {
    if (this.#fail) return Promise.reject(new Error('PUT が失敗した'))
    this.#latestPhotoUrl = '/api/photos/a.jpg'
    return Promise.resolve({ id: achievementId, optionId: 1, achievedAt: '2026-11-03T01:00:00.000Z', photoUrl: this.#latestPhotoUrl })
  }

  removePhoto(_achievementId: number): Promise<void> {
    if (this.#fail) return Promise.reject(new Error('DELETE が失敗した'))
    this.#latestPhotoUrl = null
    return Promise.resolve()
  }

  reorder(_ids: number[]): Promise<void> {
    return Promise.reject(new Error('使わない'))
  }
}

class RecordingReporter implements FailureReporter {
  readonly #messages: string[] = []

  error(message: string, _error: unknown): void {
    this.#messages.push(message)
  }

  messages(): string[] {
    return [...this.#messages]
  }
}

interface ListState {
  update(change: (list: Option[]) => Option[]): void
  current(): Option[]
}

// 画面の一覧の代わり
class ListHolder implements ListState {
  #list: Option[] = [samples.option(1), samples.option(2)]

  update(change: (list: Option[]) => Option[]): void {
    this.#list = change(this.#list)
  }

  current(): Option[] {
    return this.#list
  }
}

type Parts = { api: FakeApi; reporter: RecordingReporter; holder: ListHolder; actions: OptionListActions }

interface PartsFactory {
  create(order?: ListOrder): Parts
}

class Fixture implements PartsFactory {
  create(order: ListOrder = new WishListOrder()): Parts {
    const api = new FakeApi()
    const reporter = new RecordingReporter()
    const holder = new ListHolder()
    const actions = new OptionListActions(api, reporter, (change) => holder.update(change), order)
    return { api, reporter, holder, actions }
  }
}

const fixture = new Fixture()

describe('OptionListActions.update', () => {
  it('replaces the card with the response', async () => {
    const { holder, actions } = fixture.create()
    expect(await actions.update(2, { title: 'b' }, '失敗')).toBe(true)
    const [first, second] = holder.current()
    expect(first).toEqual(samples.option(1))
    expect(second).toMatchObject({ id: 2, title: 'b' })
  })

  it('moves the card up when a plan date is set, and to the top of the undated ones when it is cleared', async () => {
    const { holder, actions } = fixture.create()
    await actions.update(2, { plannedOn: '2026-11-23' }, '失敗')
    expect(holder.current().map((o) => o.id)).toEqual([2, 1])
    await actions.update(1, { plannedOn: '2026-11-24' }, '失敗')
    expect(holder.current().map((o) => o.id)).toEqual([2, 1])
    await actions.update(2, { plannedOn: null }, '失敗')
    expect(holder.current().map((o) => o.id)).toEqual([1, 2])
  })

  it('reports a failure with the given message and keeps the list', async () => {
    const { api, reporter, holder, actions } = fixture.create()
    api.failNext()
    expect(await actions.update(2, { title: 'b' }, 'タイトルを保存できませんでした')).toBe(false)
    expect(reporter.messages()).toEqual(['タイトルを保存できませんでした'])
    expect(holder.current()).toEqual([samples.option(1), samples.option(2)])
  })
})

describe('OptionListActions.remove', () => {
  it('removes the card', async () => {
    const { holder, actions } = fixture.create()
    expect(await actions.remove(1)).toBe(true)
    expect(holder.current()).toEqual([samples.option(2)])
  })

  it('reports a failure and keeps the card', async () => {
    const { api, reporter, holder, actions } = fixture.create()
    api.failNext()
    expect(await actions.remove(1)).toBe(false)
    expect(reporter.messages()).toEqual(['削除できませんでした'])
    expect(holder.current()).toHaveLength(2)
  })
})

describe('OptionListActions.achieve', () => {
  it('counts up the card', async () => {
    const { holder, actions } = fixture.create()
    expect(await actions.achieve(2)).toMatchObject({ id: 1, optionId: 2 })
    await actions.achieve(2)
    expect(holder.current().map((o) => o.achievementCount)).toEqual([0, 2])
  })

  it('reports a failure and keeps the count', async () => {
    const { api, reporter, holder, actions } = fixture.create()
    api.failNext()
    expect(await actions.achieve(1)).toBeNull()
    expect(reporter.messages()).toEqual(['達成を記録できませんでした'])
    expect(holder.current().map((o) => o.achievementCount)).toEqual([0, 0])
  })
})

describe('OptionListActions.setPhoto and removePhoto', () => {
  const photo = new Blob(['x'])

  it('shows the photo on the card, and takes it off again', async () => {
    const { holder, actions } = fixture.create()
    expect(await actions.setPhoto(2, 7, photo)).toBe(true)
    expect(holder.current().map((o) => o.latestPhotoUrl)).toEqual([null, '/api/photos/a.jpg'])
    expect(await actions.removePhoto(2, 7)).toBe(true)
    expect(holder.current().map((o) => o.latestPhotoUrl)).toEqual([null, null])
  })

  it('reports a failed save and leaves the card', async () => {
    const { api, reporter, holder, actions } = fixture.create()
    api.failNext()
    expect(await actions.setPhoto(2, 7, photo)).toBe(false)
    expect(reporter.messages()).toEqual(['写真を保存できませんでした'])
    expect(holder.current().map((o) => o.latestPhotoUrl)).toEqual([null, null])
  })

  it('reports a failed removal', async () => {
    const { api, reporter, actions } = fixture.create()
    api.failNext()
    expect(await actions.removePhoto(2, 7)).toBe(false)
    expect(reporter.messages()).toEqual(['写真を消せませんでした'])
  })

  // 保存は済んでいるので、保存の失敗にはしない
  it('still counts as saved when the card cannot be read again', async () => {
    const { api, reporter, actions } = fixture.create()
    api.failDetail()
    expect(await actions.setPhoto(2, 7, photo)).toBe(true)
    expect(reporter.messages()).toEqual(['写真の表示を更新できませんでした'])
  })
})

describe('OptionListActions.move', () => {
  it('takes the card out of the list', async () => {
    const { holder, actions } = fixture.create()
    expect(await actions.move(1, 'completed')).toBe(true)
    expect(holder.current().map((o) => o.id)).toEqual([2])
  })

  it('tells which list the card moved to, only when it moved', async () => {
    const api = new FakeApi()
    const holder = new ListHolder()
    const moved: string[] = []
    const actions = new OptionListActions(api, new RecordingReporter(), (change) => holder.update(change), new WishListOrder(), (status) => moved.push(status))
    await actions.move(1, 'completed')
    api.failNext()
    await actions.move(2, 'completed')
    expect(moved).toEqual(['completed'])
  })

  it.each([
    ['completed', 'やったリストに移せませんでした'],
    ['pending', 'やりたいリストに戻せませんでした'],
  ] as const)('reports a failure to move to %s and keeps the card', async (status, message) => {
    const { api, reporter, holder, actions } = fixture.create()
    api.failNext()
    expect(await actions.move(1, status)).toBe(false)
    expect(reporter.messages()).toEqual([message])
    expect(holder.current()).toHaveLength(2)
  })
})

describe('OptionListActions with the done list order', () => {
  it('keeps the cards in the moved order when a plan date is set or cleared', async () => {
    const { holder, actions } = fixture.create(new DoneListOrder())
    await actions.update(1, { plannedOn: '2026-11-23' }, '失敗')
    await actions.update(1, { plannedOn: null }, '失敗')
    expect(holder.current().map((o) => o.id)).toEqual([2, 1])
  })
})
