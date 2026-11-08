import { expect } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'

export interface OptionSeeder {
  // やりたいことを API で追加し、ID を返す
  add(title: string): Promise<number>
  // 提案から追加する（別の端末で追加したときと同じ）
  addSuggestion(suggestionId: number, title: string): Promise<number>
  // やったリストへ移す
  complete(id: number): Promise<void>
  // 🎉 の達成記録を付ける
  achieve(id: number): Promise<void>
  // 予定日（YYYY-MM-DD）を決める
  plan(id: number, plannedOn: string): Promise<void>
  // やりたいリストのタイトル（並び順）
  pendingTitles(): Promise<string[]>
  // やりたいリストの先頭の項目の id
  firstPendingId(): Promise<number>
}

// 画面を通さずに前提のデータを作る（backend の API を呼ぶ。通信は差し替えない）
export class OptionSeed implements OptionSeeder {
  readonly #request: APIRequestContext

  constructor(request: APIRequestContext) {
    this.#request = request
  }

  async add(title: string): Promise<number> {
    return this.#create({ title })
  }

  async addSuggestion(suggestionId: number, title: string): Promise<number> {
    return this.#create({ title, suggestionId })
  }

  async #create(data: { title: string; suggestionId?: number }): Promise<number> {
    const res = await this.#request.post('/api/options', { data })
    expect(res.status()).toBe(201)
    const { id } = (await res.json()) as { id: number }
    return id
  }

  async complete(id: number): Promise<void> {
    const res = await this.#request.patch(`/api/options/${id}`, { data: { status: 'completed' } })
    expect(res.status()).toBe(200)
  }

  async achieve(id: number): Promise<void> {
    const res = await this.#request.post(`/api/options/${id}/achievements`)
    expect(res.status()).toBe(201)
  }

  async plan(id: number, plannedOn: string): Promise<void> {
    const res = await this.#request.patch(`/api/options/${id}`, { data: { plannedOn } })
    expect(res.status()).toBe(200)
  }

  async pendingTitles(): Promise<string[]> {
    const pending = await this.#pending()
    return pending.map((option) => option.title)
  }

  async firstPendingId(): Promise<number> {
    const [first] = await this.#pending()
    if (first === undefined) throw new Error('やりたいリストが空')
    return first.id
  }

  async #pending(): Promise<{ id: number; title: string }[]> {
    const res = await this.#request.get('/api/options', { params: { status: 'pending' } })
    expect(res.status()).toBe(200)
    return (await res.json()) as { id: number; title: string }[]
  }
}
