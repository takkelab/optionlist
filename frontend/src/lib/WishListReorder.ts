import type { Option } from '../../../shared/types'
import type { OptionsApi } from '../api/client'
import type { FailureReporter, ListUpdater } from './OptionListActions'
import type { DragOrder } from './WishListOrder'

export interface Reorder {
  // list は今画面に出ている一覧。動かなかったら API を呼ばない
  reorder(list: Option[], activeId: number, overId: number): Promise<void>
}

// やりたいリストのドラッグでの並び替え（screens.md §2）。待たずに一覧を書き換えてから保存する。
// 保存に失敗したら（別の端末で完了・削除されて 400 になったときを含む。docs/decisions/0009）、知らせて一覧を読み直す
export class WishListReorder implements Reorder {
  readonly #api: Pick<OptionsApi, 'reorder' | 'list'>
  readonly #reporter: FailureReporter
  readonly #setList: ListUpdater
  readonly #order: DragOrder
  #saving: Promise<void> = Promise.resolve()
  // 保存に失敗するたびに 1 つ進める
  #generation = 0

  constructor(api: Pick<OptionsApi, 'reorder' | 'list'>, reporter: FailureReporter, setList: ListUpdater, order: DragOrder) {
    this.#api = api
    this.#reporter = reporter
    this.#setList = setList
    this.#order = order
  }

  async reorder(list: Option[], activeId: number, overId: number): Promise<void> {
    const moved = this.#order.move(list, activeId, overId)
    if (moved === list) return
    this.#setList(() => moved)
    const ids = this.#order.undatedIds(moved)
    // 続けて並べ替えても、届く順と失敗したときの読み直しが入れ替わらないよう、前の保存が終わってから送る
    const generation = this.#generation
    const saved = this.#saving.then(() => this.#save(ids, generation))
    this.#saving = saved
    await saved
  }

  // 前の保存が失敗して読み直したら、その前に並べ替えて待っていた保存は送らない（画面は読み直した並びになっているので）
  async #save(ids: number[], generation: number): Promise<void> {
    if (generation !== this.#generation) return
    try {
      await this.#api.reorder(ids)
    } catch (error) {
      this.#generation += 1
      this.#reporter.error('並び替えを保存できませんでした', error)
      await this.#reload()
    }
  }

  async #reload(): Promise<void> {
    try {
      const loaded = await this.#api.list('pending')
      this.#setList(() => loaded)
    } catch (error) {
      this.#reporter.error('やりたいリストを読み込めませんでした', error)
    }
  }
}
