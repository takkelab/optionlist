import type { Achievement, Option, OptionStatus } from '../../../shared/types'
import type { OptionsApi } from '../api/client'
import type { ListOrder } from './WishListOrder'

// 失敗を知らせる先（画面では app/contexts の Notifier。lib は app を読めないので、使う形だけをここに書く）
export interface FailureReporter {
  error(message: string, error: unknown): void
}

// 項目のシート（screens.md §3）で変えるもの。plannedOn は null で未定に戻す
export type OptionChanges = { title?: string; plannedOn?: string | null }

// 一覧を書き換える
export type ListUpdater = (change: (list: Option[]) => Option[]) => void

export interface ListActions {
  // 成功したら true。失敗は failure の文言で知らせる
  update(id: number, changes: OptionChanges, failure: string): Promise<boolean>
  remove(id: number): Promise<boolean>
  // 🎉 の達成記録。成功したらカードの達成回数を 1 つ増やす（screens.md §4）
  // 作った達成記録を返す（🎉 のあとでその達成に写真を付けるため）。失敗したら null
  achieve(id: number): Promise<Achievement | null>
  // 達成の写真を付ける・外す。成功したら true で、カードの写真もそろえる（screens.md §3・§6）
  setPhoto(id: number, achievementId: number, photo: Blob): Promise<boolean>
  removePhoto(id: number, achievementId: number): Promise<boolean>
  // やったリストへ移す・やりたいリストへ戻す。今の一覧からは外れる（screens.md §4・§6）
  move(id: number, status: OptionStatus): Promise<boolean>
}

const MOVE_FAILURE: Record<OptionStatus, string> = {
  completed: 'やったリストに移せませんでした',
  pending: 'やりたいリストに戻せませんでした',
}

// 一覧のカードから開いたシートの操作。API を呼び、成功したら一覧を書き換える（画面に依存しないので lib に置いて UT を書く）
// 並べ方は一覧ごとに違う（やりたいリストは予定日の順、やったリストは移した日の順）ので order で受け取る
export class OptionListActions implements ListActions {
  readonly #api: OptionsApi
  readonly #reporter: FailureReporter
  readonly #setList: ListUpdater
  readonly #order: ListOrder
  // 項目を移したあとに、移した先の一覧（status）を知らせる。覚えている一覧を捨てるのに使う（lib/ListPrefetch.ts）
  readonly #moved: (status: OptionStatus) => void

  constructor(api: OptionsApi, reporter: FailureReporter, setList: ListUpdater, order: ListOrder, moved: (status: OptionStatus) => void = () => undefined) {
    this.#api = api
    this.#reporter = reporter
    this.#setList = setList
    this.#order = order
    this.#moved = moved
  }

  // PATCH の応答でカードを入れ替え、並べ直す。予定日を消したものは予定日がないものの一番上へ（screens.md §2）
  update(id: number, changes: OptionChanges, failure: string): Promise<boolean> {
    return this.#run(failure, async () => {
      const updated = await this.#api.update(id, changes)
      this.#setList((list) => {
        const cleared = updated.plannedOn === null && list.some((option) => option.id === id && option.plannedOn !== null)
        const replaced = list.map((option) => (option.id === id ? updated : option))
        return cleared ? this.#order.moveToTopOfUndated(replaced, id) : this.#order.arrange(replaced)
      })
    })
  }

  remove(id: number): Promise<boolean> {
    return this.#run('削除できませんでした', async () => {
      await this.#api.remove(id)
      this.#setList((list) => list.filter((option) => option.id !== id))
    })
  }

  async achieve(id: number): Promise<Achievement | null> {
    try {
      const achievement = await this.#api.achieve(id)
      this.#setList((list) => list.map((option) => (option.id === id ? { ...option, achievementCount: option.achievementCount + 1 } : option)))
      return achievement
    } catch (error) {
      this.#reporter.error('達成を記録できませんでした', error)
      return null
    }
  }

  async setPhoto(id: number, achievementId: number, photo: Blob): Promise<boolean> {
    const saved = await this.#run('写真を保存できませんでした', async () => {
      await this.#api.setPhoto(achievementId, photo)
    })
    if (saved) await this.#refreshCard(id)
    return saved
  }

  async removePhoto(id: number, achievementId: number): Promise<boolean> {
    const removed = await this.#run('写真を消せませんでした', () => this.#api.removePhoto(achievementId))
    if (removed) await this.#refreshCard(id)
    return removed
  }

  // カードに出す写真は「写真がある中でいちばん新しい達成」のものなので、backend に聞き直す。
  // 写真の保存はもう済んでいるので、読めなくても保存の失敗にはしない
  async #refreshCard(id: number): Promise<void> {
    await this.#run('写真の表示を更新できませんでした', async () => {
      const { latestPhotoUrl } = await this.#api.detail(id)
      this.#setList((list) => list.map((option) => (option.id === id ? { ...option, latestPhotoUrl } : option)))
    })
  }

  move(id: number, status: OptionStatus): Promise<boolean> {
    return this.#run(MOVE_FAILURE[status], async () => {
      await this.#api.update(id, { status })
      this.#setList((list) => list.filter((option) => option.id !== id))
      this.#moved(status)
    })
  }

  async #run(failure: string, action: () => Promise<void>): Promise<boolean> {
    try {
      await action()
      return true
    } catch (error) {
      this.#reporter.error(failure, error)
      return false
    }
  }
}
