import { describe, expect, it } from 'vitest'
import type { Option, OptionStatus } from '../../../shared/types'
import type { OptionsApi } from '../api/client'
import type { FailureReporter } from './OptionListActions'
import { WishListOrder } from './WishListOrder'
import { WishListReorder } from './WishListReorder'

interface SampleSource {
  option(id: number, plannedOn: string | null): Option
}

// テスト用の項目
class Samples implements SampleSource {
  option(id: number, plannedOn: string | null): Option {
    return {
      id,
      title: `項目 ${id}`,
      status: 'pending',
      suggestionId: null,
      plannedOn,
      achievementCount: 0,
      latestPhotoUrl: null,
      completedAt: null,
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
    }
  }
}

const samples = new Samples()

// 送った ids を覚える API。failReorder で PUT を、failList で読み直しを失敗させる
class FakeApi implements Pick<OptionsApi, 'reorder' | 'list'> {
  readonly #sent: number[][] = []
  #failReorder = false
  #failList = false
  #held: Promise<void> | null = null
  #release: () => void = () => undefined
  readonly #server: Option[]

  constructor(server: Option[]) {
    this.#server = server
  }

  failReorder(): void {
    this.#failReorder = true
  }

  failList(): void {
    this.#failList = true
  }

  sent(): number[][] {
    return this.#sent
  }

  // 次の PUT を、release を呼ぶまで終わらせない
  hold(): void {
    this.#held = new Promise((resolve) => {
      this.#release = resolve
    })
  }

  release(): void {
    this.#release()
  }

  async reorder(ids: number[]): Promise<void> {
    this.#sent.push(ids)
    const held = this.#held
    this.#held = null
    if (held !== null) await held
    if (this.#failReorder) throw new Error('PUT が失敗した')
  }

  list(_status: OptionStatus): Promise<Option[]> {
    return this.#failList ? Promise.reject(new Error('GET が失敗した')) : Promise.resolve(this.#server)
  }
}

class RecordingReporter implements FailureReporter {
  readonly #messages: string[] = []

  error(message: string, _error: unknown): void {
    this.#messages.push(message)
  }

  messages(): string[] {
    return this.#messages
  }
}

interface ListState {
  update(change: (list: Option[]) => Option[]): void
  current(): Option[]
}

// setList に渡された書き換えを、手元の一覧に当てる
class ListHolder implements ListState {
  #list: Option[] = []

  update(change: (list: Option[]) => Option[]): void {
    this.#list = change(this.#list)
  }

  current(): Option[] {
    return this.#list
  }
}

const list = [samples.option(1, '2026-11-23'), samples.option(2, null), samples.option(3, null), samples.option(4, null)]

describe('WishListReorder.reorder', () => {
  it('moves the card at once and saves the undated order', async () => {
    const api = new FakeApi(list)
    const holder = new ListHolder()
    await new WishListReorder(api, new RecordingReporter(), (change) => holder.update(change), new WishListOrder()).reorder(list, 4, 2)
    expect(holder.current().map((o) => o.id)).toEqual([1, 4, 2, 3])
    expect(api.sent()).toEqual([[4, 2, 3]])
  })

  it('does not call the API when nothing moves (dropped on itself or on a dated card)', async () => {
    const api = new FakeApi(list)
    const reorder = new WishListReorder(api, new RecordingReporter(), (change) => new ListHolder().update(change), new WishListOrder())
    await reorder.reorder(list, 2, 2)
    await reorder.reorder(list, 2, 1)
    expect(api.sent()).toEqual([])
  })

  it('sends the next order only after the previous save has finished', async () => {
    const api = new FakeApi(list)
    const holder = new ListHolder()
    const reorder = new WishListReorder(api, new RecordingReporter(), (change) => holder.update(change), new WishListOrder())
    api.hold()
    const first = reorder.reorder(list, 4, 2)
    const second = reorder.reorder(holder.current(), 3, 4)
    await Promise.resolve()
    expect(api.sent()).toEqual([[4, 2, 3]])
    api.release()
    await Promise.all([first, second])
    expect(api.sent()).toEqual([
      [4, 2, 3],
      [3, 4, 2],
    ])
    expect(holder.current().map((o) => o.id)).toEqual([1, 3, 4, 2])
  })

  it('drops the waiting save when the previous one fails, and shows the reloaded list', async () => {
    const server = [samples.option(3, null), samples.option(2, null), samples.option(4, null)]
    const api = new FakeApi(server)
    const reporter = new RecordingReporter()
    const holder = new ListHolder()
    const reorder = new WishListReorder(api, reporter, (change) => holder.update(change), new WishListOrder())
    api.hold()
    api.failReorder()
    const first = reorder.reorder(list, 4, 2)
    const second = reorder.reorder(holder.current(), 3, 4)
    api.release()
    await Promise.all([first, second])
    expect(api.sent()).toEqual([[4, 2, 3]])
    expect(reporter.messages()).toEqual(['並び替えを保存できませんでした'])
    expect(holder.current().map((o) => o.id)).toEqual([3, 2, 4])
  })

  it('reports a failed save and reloads the list from the server', async () => {
    const server = [samples.option(3, null), samples.option(2, null)]
    const api = new FakeApi(server)
    api.failReorder()
    const reporter = new RecordingReporter()
    const holder = new ListHolder()
    await new WishListReorder(api, reporter, (change) => holder.update(change), new WishListOrder()).reorder(list, 4, 2)
    expect(reporter.messages()).toEqual(['並び替えを保存できませんでした'])
    expect(holder.current().map((o) => o.id)).toEqual([3, 2])
  })

  it('keeps the moved list when the reload also fails', async () => {
    const api = new FakeApi(list)
    api.failReorder()
    api.failList()
    const reporter = new RecordingReporter()
    const holder = new ListHolder()
    await new WishListReorder(api, reporter, (change) => holder.update(change), new WishListOrder()).reorder(list, 4, 2)
    expect(reporter.messages()).toEqual(['並び替えを保存できませんでした', 'やりたいリストを読み込めませんでした'])
    expect(holder.current().map((o) => o.id)).toEqual([1, 4, 2, 3])
  })
})
