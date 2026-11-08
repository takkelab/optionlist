import { describe, expect, it } from 'vitest'
import type { Option, OptionStatus, SuggestionCatalog, SuggestionDetail } from '../../../shared/types'
import type { SuggestionsApi } from '../api/client'
import { CatalogCache } from './CatalogCache'

// catalog の応答を、テストが respond を呼んだときに返す API（読み込みが追い越し合う順番を作るため）。
// 応答は読み始めた順に並び、respond(i, …) で i 番目に読み始めたものに応える。提案は 2 件で、印は states で決める
class ManualCatalogApi implements SuggestionsApi {
  readonly #waiting: ((catalog: SuggestionCatalog) => void)[] = []

  catalog(): Promise<SuggestionCatalog> {
    return new Promise((resolve) => this.#waiting.push(resolve))
  }

  respond(index: number, name: string, states: [OptionStatus | null, OptionStatus | null] = [null, null]): void {
    const resolve = this.#waiting[index]
    if (resolve === undefined) throw new Error(`${index} 番目の読み込みはない`)
    resolve({
      themes: [{ id: 1, name }],
      tags: [],
      suggestions: states.map((optionStatus, i) => ({
        id: i + 1,
        hook: '',
        title: '',
        size: 'hour' as const,
        seasonFrom: null,
        seasonTo: null,
        themeId: 1,
        tagIds: [],
        optionStatus,
      })),
    })
  }

  suggestion(_id: number): Promise<SuggestionDetail | null> {
    return Promise.reject(new Error('使わない'))
  }

  addSuggestion(_id: number, _title: string): Promise<Option | null> {
    return Promise.reject(new Error('使わない'))
  }
}

describe('CatalogCache', () => {
  it('has nothing cached before the first load', () => {
    const cache = new CatalogCache(new ManualCatalogApi())
    expect(cache.cached()).toBeNull()
    cache.mark(1, 'pending')
    expect(cache.cached()).toBeNull()
  })

  it('remembers the latest loaded catalog', async () => {
    const api = new ManualCatalogApi()
    const cache = new CatalogCache(api)
    const first = cache.load()
    api.respond(0, '1 回目')
    await first
    const second = cache.load()
    api.respond(1, '2 回目')
    const loaded = await second
    expect(cache.cached()).toBe(loaded)
    expect(cache.cached()).toMatchObject({ themes: [{ name: '2 回目' }] })
  })

  it('marks an added suggestion without touching the others', async () => {
    const api = new ManualCatalogApi()
    const cache = new CatalogCache(api)
    const loading = cache.load()
    api.respond(0, '一覧')
    const loaded = await loading
    cache.mark(2, 'pending')
    expect(cache.cached()).toMatchObject({ suggestions: [{ optionStatus: null }, { optionStatus: 'pending' }] })
    // 読んだときのオブジェクトは書き換えない（画面が持っている state を壊さない）
    expect(loaded).toMatchObject({ suggestions: [{ optionStatus: null }, { optionStatus: null }] })
  })

  // 状態が変わらなければ作り直さない（探す画面が同じ一覧を描き直さないように）
  it('keeps the same catalog when the mark does not change', async () => {
    const api = new ManualCatalogApi()
    const cache = new CatalogCache(api)
    const loading = cache.load()
    api.respond(0, '一覧')
    const loaded = await loading
    cache.mark(1, null)
    expect(cache.cached()).toBe(loaded)
  })

  // 探す画面を読み込んでいる間に提案を開いて追加し、そのあとで古い状態の一覧が届いても「追加済み」を外さない
  it('keeps a mark made while a load was in flight', async () => {
    const api = new ManualCatalogApi()
    const cache = new CatalogCache(api)
    const loading = cache.load()
    cache.mark(2, 'pending')
    api.respond(0, '追加の前に読んだ一覧')
    const loaded = await loading
    expect(loaded).toMatchObject({ suggestions: [{ optionStatus: null }, { optionStatus: 'pending' }] })
    expect(cache.cached()).toBe(loaded)
  })

  // 印を付けたあとに読み始めた一覧は、その時点の正しい状態（ほかの画面で削除したなど）をそのまま使う
  it('does not reapply marks made before a load started', async () => {
    const api = new ManualCatalogApi()
    const cache = new CatalogCache(api)
    const first = cache.load()
    api.respond(0, '1 回目')
    await first
    cache.mark(1, 'pending')
    const second = cache.load()
    api.respond(1, '削除したあと', [null, null])
    expect(await second).toMatchObject({ suggestions: [{ optionStatus: null }, { optionStatus: null }] })
  })

  it('does not let an older load overwrite a newer one that arrived first', async () => {
    const api = new ManualCatalogApi()
    const cache = new CatalogCache(api)
    const older = cache.load()
    const newer = cache.load()
    api.respond(1, '新しい')
    await newer
    api.respond(0, '古い')
    expect(await older).toMatchObject({ themes: [{ name: '新しい' }] })
    expect(cache.cached()).toMatchObject({ themes: [{ name: '新しい' }] })
  })
})
