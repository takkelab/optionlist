import type { Option, OptionDetail, OptionStatus } from "../../../shared/types";
import type { OptionChanges, OptionStore } from "../repositories/OptionRepository";
import type { Clock } from "./Clock";
import { AppError } from "./errors";
import type { PhotoRemover } from "./PhotoCleanup";
import type { SortOrderPlan } from "./SortOrderPlanner";

export type NewOption = { title: string; suggestionId: number | null };
// plannedOn の null は「消す」、undefined は「変えない」
export type OptionPatch = { title?: string; status?: OptionStatus; plannedOn?: string | null };

export interface OptionUseCases {
  list(status: OptionStatus): Promise<Option[]>;
  detail(id: number): Promise<OptionDetail>;
  create(input: NewOption): Promise<Option>;
  update(id: number, patch: OptionPatch): Promise<Option>;
  remove(id: number): Promise<void>;
  reorder(ids: number[]): Promise<void>;
}

// やりたいこと（options）の処理。並び順と完了・戻すときの規則は data.md §2・api.md §2
export class OptionService implements OptionUseCases {
  readonly #store: OptionStore;
  readonly #clock: Clock;
  readonly #planner: SortOrderPlan;
  readonly #photos: PhotoRemover;

  constructor(store: OptionStore, clock: Clock, planner: SortOrderPlan, photos: PhotoRemover) {
    this.#store = store;
    this.#clock = clock;
    this.#planner = planner;
    this.#photos = photos;
  }

  list(status: OptionStatus): Promise<Option[]> {
    return this.#store.list(status);
  }

  async detail(id: number): Promise<OptionDetail> {
    const detail = await this.#store.findDetail(id);
    if (detail === null) throw this.#notFound(id);
    return detail;
  }

  // 先頭に入れる
  async create(input: NewOption): Promise<Option> {
    const id = await this.#store.insert({ ...input, sortOrder: await this.#topSortOrder(), now: this.#clock.now() });
    return this.#found(id);
  }

  // やったリストへ移すときは completed_at を入れる（sort_order はそのまま）。
  // やりたいリストへ戻すときは completed_at を消して先頭に入れる。status が変わらなければどちらも触らない。
  // 予定日を消したときも先頭に入れる（予定日がないものの一番上に出る。docs/decisions/0015）
  async update(id: number, patch: OptionPatch): Promise<Option> {
    const current = await this.#found(id);
    const now = this.#clock.now();
    const changes: OptionChanges = { title: patch.title, plannedOn: patch.plannedOn, updatedAt: now };
    const { status } = patch;
    if (status !== undefined && status !== current.status) {
      changes.status = status;
      changes.completedAt = status === "completed" ? now : null;
      if (status === "pending") changes.sortOrder = await this.#topSortOrder();
    }
    if (patch.plannedOn === null && current.plannedOn !== null) changes.sortOrder = await this.#topSortOrder();
    await this.#store.update(id, changes);
    return this.#found(id);
  }

  // 達成記録は CASCADE で消えるので、写真の名前は先に読む。ファイルは行を消せてから消す（api.md §5）
  async remove(id: number): Promise<void> {
    const photos = await this.#store.photoFilenames(id);
    if (!(await this.#store.delete(id))) throw this.#notFound(id);
    await this.#photos.remove(photos);
  }

  // ids はやりたいリストの option をそれぞれ 1 回まで含む（api.md §2・§3）。書き換えるのは順番が変わった行だけ
  // ids にない pending（画面を読み直す前に別の端末で追加されたもの）は、今の順のまま先頭に残す
  async reorder(ids: number[]): Promise<void> {
    const current = await this.#store.pendingOrder();
    const pending = new Set(current.map((e) => e.id));
    const unique = new Set(ids);
    if (unique.size !== ids.length || !ids.every((id) => pending.has(id))) {
      throw new AppError("VALIDATION_ERROR", "ids に重複か、やりたいリストにない option がある");
    }
    const unsent = current.filter((e) => !unique.has(e.id)).map((e) => e.id);
    await this.#store.setSortOrders(this.#planner.plan(current, [...unsent, ...ids]));
  }

  async #found(id: number): Promise<Option> {
    const option = await this.#store.find(id);
    if (option === null) throw this.#notFound(id);
    return option;
  }

  // 現在の最小値より小さい値（data.md §2）
  async #topSortOrder(): Promise<number> {
    return this.#planner.top(await this.#store.minPendingSortOrder());
  }

  #notFound(id: number): AppError {
    return new AppError("NOT_FOUND", `option ${id} が見つからない`);
  }
}
