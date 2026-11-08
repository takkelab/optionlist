import { isAxiosError } from 'axios'
import type { AxiosInstance } from 'axios'
import type { Achievement, Event, Option, OptionDetail, OptionStatus, SuggestionCatalog, SuggestionDetail } from '../../../shared/types'

// PATCH /api/options/:id で変えるもの。plannedOn は null で消す（api.md §2）
export type OptionUpdate = { title?: string; status?: OptionStatus; plannedOn?: string | null }

// backend への通信はすべて frontend/src/api/ のクラス経由で行う（architecture.md §3.1）
export interface OptionsApi {
  list(status: OptionStatus): Promise<Option[]>
  // 達成記録を含む（項目のシートの「達成した日」）
  detail(id: number): Promise<OptionDetail>
  create(title: string): Promise<Option>
  update(id: number, changes: OptionUpdate): Promise<Option>
  remove(id: number): Promise<void>
  // やりたいリストの予定日がないものを、ids の順に並べ直す（api.md §2）
  reorder(ids: number[]): Promise<void>
  // 🎉 を押したときの達成記録（screens.md §4）
  achieve(id: number): Promise<Achievement>
  // 達成に写真を付ける。すでにあれば置き換える（api.md §5）
  setPhoto(achievementId: number, photo: Blob): Promise<Achievement>
  removePhoto(achievementId: number): Promise<void>
}

// 提案（screens.md §5）。見つからない（404）・追加済み（409）は画面で出し分けるので、例外ではなく null で返す
export interface SuggestionsApi {
  catalog(): Promise<SuggestionCatalog>
  // 存在しない提案なら null
  suggestion(id: number): Promise<SuggestionDetail | null>
  // 提案をやりたいリストに追加する。別の端末で先に追加されていたら null
  addSuggestion(id: number, title: string): Promise<Option | null>
}

// 利用イベント（screens.md §8）
export interface EventsApi {
  send(events: Event[]): Promise<void>
}

export class HttpApiClient implements OptionsApi, SuggestionsApi, EventsApi {
  readonly #http: AxiosInstance

  constructor(http: AxiosInstance) {
    this.#http = http
  }

  async list(status: OptionStatus): Promise<Option[]> {
    const res = await this.#http.get<Option[]>('/options', { params: { status } })
    return res.data
  }

  async detail(id: number): Promise<OptionDetail> {
    const res = await this.#http.get<OptionDetail>(`/options/${id}`)
    return res.data
  }

  async create(title: string): Promise<Option> {
    const res = await this.#http.post<Option>('/options', { title })
    return res.data
  }

  async update(id: number, changes: OptionUpdate): Promise<Option> {
    const res = await this.#http.patch<Option>(`/options/${id}`, changes)
    return res.data
  }

  async remove(id: number): Promise<void> {
    await this.#http.delete(`/options/${id}`)
  }

  async reorder(ids: number[]): Promise<void> {
    await this.#http.put('/options/order', { ids })
  }

  async achieve(id: number): Promise<Achievement> {
    const res = await this.#http.post<Achievement>(`/options/${id}/achievements`)
    return res.data
  }

  async setPhoto(achievementId: number, photo: Blob): Promise<Achievement> {
    const form = new FormData()
    form.append('photo', photo, 'photo.jpg')
    const res = await this.#http.put<Achievement>(`/achievements/${achievementId}/photo`, form)
    return res.data
  }

  async removePhoto(achievementId: number): Promise<void> {
    await this.#http.delete(`/achievements/${achievementId}/photo`)
  }

  async catalog(): Promise<SuggestionCatalog> {
    const res = await this.#http.get<SuggestionCatalog>('/suggestions')
    return res.data
  }

  async suggestion(id: number): Promise<SuggestionDetail | null> {
    try {
      const res = await this.#http.get<SuggestionDetail>(`/suggestions/${id}`)
      return res.data
    } catch (error) {
      if (this.#statusOf(error) === 404) return null
      throw error
    }
  }

  async addSuggestion(id: number, title: string): Promise<Option | null> {
    try {
      const res = await this.#http.post<Option>('/options', { title, suggestionId: id })
      return res.data
    } catch (error) {
      if (this.#statusOf(error) === 409) return null
      throw error
    }
  }

  async send(events: Event[]): Promise<void> {
    await this.#http.post('/events', { events })
  }

  #statusOf(error: unknown): number | undefined {
    if (!isAxiosError(error)) return undefined
    const { response } = error
    return response?.status
  }
}
