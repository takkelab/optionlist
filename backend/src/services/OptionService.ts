import type { Option, OptionDetail, OptionStatus } from "../../../shared/types";
import type { OptionChanges, OptionStore, OptionStores } from "../repositories/OptionRepository";
import type { Clock } from "./Clock";
import { AppError } from "./errors";
import type { PhotoRemover } from "./PhotoCleanup";
import type { SortOrderPlan } from "./SortOrderPlanner";

export type NewOption = { title: string; suggestionId: number | null };
// plannedOn の null は「消す」、undefined は「変えない」
export type OptionPatch = { title?: string; status?: OptionStatus; plannedOn?: string | null };

// userId はその人のアカウント（null はアカウントがない人。一覧は空、:id の指定は 404。api.md §1）
export interface OptionUseCases {
  list(userId: number | null, status: OptionStatus): Promise<Option[]>;
  detail(userId: number | null, id: number): Promise<OptionDetail>;
  // アカウントは controller が先に作る（api.md §6）
  create(userId: number, input: NewOption): Promise<Option>;
  update(userId: number | null, id: number, patch: OptionPatch): Promise<Option>;
  remove(userId: number | null, id: number): Promise<void>;
  reorder(userId: number | null, ids: number[]): Promise<void>;
}

// やりたいこと（options）の処理。並び順と完了・戻すときの規則は data.md §2・api.md §2
// 1 つの操作の SQL は、その人の 1 つのトランザクション（withUser）で流す
export class OptionService implements OptionUseCases {
  readonly #stores: OptionStores;
  readonly #clock: Clock;
  readonly #planner: SortOrderPlan;
  readonly #photos: PhotoRemover;

  constructor(stores: OptionStores, clock: Clock, planner: SortOrderPlan, photos: PhotoRemover) {
    this.#stores = stores;
    this.#clock = clock;
    this.#planner = planner;
    this.#photos = photos;
  }

  list(userId: number | null, status: OptionStatus): Promise<Option[]> {
    return this.#stores.withUser(userId, (store) => store.list(status));
  }

  detail(userId: number | null, id: number): Promise<OptionDetail> {
    return this.#stores.withUser(userId, async (store) => {
      const detail = await store.findDetail(id);
      if (detail === null) throw this.#notFound(id);
      return detail;
    });
  }

  // 先頭に入れる
  create(userId: number, input: NewOption): Promise<Option> {
    return this.#stores.withUser(userId, async (store) => {
      const id = await store.insert({ ...input, sortOrder: await this.#topSortOrder(store), now: this.#clock.now() });
      return this.#found(store, id);
    });
  }

  // やったリストへ移すときは completed_at を入れる（sort_order はそのまま）。
  // やりたいリストへ戻すときは completed_at を消して先頭に入れる。status が変わらなければどちらも触らない。
  // 予定日を消したときも先頭に入れる（予定日がないものの一番上に出る。docs/decisions/0015）
  update(userId: number | null, id: number, patch: OptionPatch): Promise<Option> {
    return this.#stores.withUser(userId, async (store) => {
      const current = await this.#found(store, id);
      const now = this.#clock.now();
      const changes: OptionChanges = { title: patch.title, plannedOn: patch.plannedOn, updatedAt: now };
      const { status } = patch;
      if (status !== undefined && status !== current.status) {
        changes.status = status;
        changes.completedAt = status === "completed" ? now : null;
        if (status === "pending") changes.sortOrder = await this.#topSortOrder(store);
      }
      if (patch.plannedOn === null && current.plannedOn !== null) changes.sortOrder = await this.#topSortOrder(store);
      await store.update(id, changes);
      return this.#found(store, id);
    });
  }

  // 達成記録は CASCADE で消えるので、写真の名前は先に読む。ファイルは行を消せてから（COMMIT のあとで）消す（api.md §5）
  async remove(userId: number | null, id: number): Promise<void> {
    const photos = await this.#stores.withUser(userId, async (store) => {
      const names = await store.photoFilenames(id);
      if (!(await store.delete(id))) throw this.#notFound(id);
      return names;
    });
    await this.#photos.remove(photos);
  }

  // ids はやりたいリストの option をそれぞれ 1 回まで含む（api.md §2・§3）。書き換えるのは順番が変わった行だけ
  // ids にない pending（画面を読み直す前に別の端末で追加されたもの）は、今の順のまま先頭に残す
  reorder(userId: number | null, ids: number[]): Promise<void> {
    return this.#stores.withUser(userId, async (store) => {
      const current = await store.pendingOrder();
      const pending = new Set(current.map((e) => e.id));
      const unique = new Set(ids);
      if (unique.size !== ids.length || !ids.every((id) => pending.has(id))) {
        throw new AppError("VALIDATION_ERROR", "ids に重複か、やりたいリストにない option がある");
      }
      const unsent = current.filter((e) => !unique.has(e.id)).map((e) => e.id);
      await store.setSortOrders(this.#planner.plan(current, [...unsent, ...ids]));
    });
  }

  async #found(store: OptionStore, id: number): Promise<Option> {
    const option = await store.find(id);
    if (option === null) throw this.#notFound(id);
    return option;
  }

  // 現在の最小値より小さい値（data.md §2）
  async #topSortOrder(store: OptionStore): Promise<number> {
    return this.#planner.top(await store.minPendingSortOrder());
  }

  #notFound(id: number): AppError {
    return new AppError("NOT_FOUND", `option ${id} が見つからない`);
  }
}
