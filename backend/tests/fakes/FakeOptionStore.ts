import type { Option, OptionDetail, OptionStatus } from "../../../shared/types";
import type { NewOptionRow, OptionChanges, OptionStore, SortOrderEntry } from "../../src/repositories/OptionRepository";
import type { Clock } from "../../src/services/Clock";
import { AppError } from "../../src/services/errors";

type StoredOption = Option & { sortOrder: number };

// メモリ上の OptionStore。並び順は sortOrder を持って OptionRepository と同じ規則で並べる
export class FakeOptionStore implements OptionStore {
  readonly #photoNames = new Map<number, string[]>();
  #rows: StoredOption[] = [];
  #nextId = 1;

  async list(status: OptionStatus): Promise<Option[]> {
    const rows = this.#rows.filter((r) => r.status === status);
    const sorted = status === "pending"
      ? rows.toSorted(
          (a, b) =>
            Number(a.plannedOn === null) - Number(b.plannedOn === null) ||
            String(a.plannedOn).localeCompare(String(b.plannedOn)) ||
            (a.plannedOn === null ? a.sortOrder - b.sortOrder : 0) ||
            a.id - b.id,
        )
      : rows.toSorted((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)) || b.id - a.id);
    return sorted.map((r) => this.#option(r));
  }

  async find(id: number): Promise<Option | null> {
    const row = this.#row(id);
    return row === undefined ? null : this.#option(row);
  }

  async findDetail(id: number): Promise<OptionDetail | null> {
    const row = this.#row(id);
    return row === undefined ? null : { ...this.#option(row), achievements: [], firstStep: null };
  }

  async minPendingSortOrder(): Promise<number | null> {
    const orders = this.#rows.filter((r) => r.status === "pending").map((r) => r.sortOrder);
    return orders.length === 0 ? null : Math.min(...orders);
  }

  async insert(row: NewOptionRow): Promise<number> {
    const { suggestionId, now } = row;
    if (suggestionId !== null && this.#rows.some((r) => r.suggestionId === suggestionId)) {
      throw new AppError("CONFLICT", "この提案はすでに追加されている");
    }
    const id = this.#nextId++;
    const at = now.toISOString();
    this.#rows.push({
      id,
      title: row.title,
      status: "pending",
      suggestionId,
      plannedOn: null,
      achievementCount: 0,
      latestPhotoUrl: null,
      completedAt: null,
      createdAt: at,
      updatedAt: at,
      sortOrder: row.sortOrder,
    });
    return id;
  }

  async update(id: number, changes: OptionChanges): Promise<void> {
    const { completedAt, updatedAt } = changes;
    this.#rows = this.#rows.map((r) =>
      r.id !== id
        ? r
        : {
            ...r,
            title: changes.title ?? r.title,
            status: changes.status ?? r.status,
            plannedOn: changes.plannedOn === undefined ? r.plannedOn : changes.plannedOn,
            completedAt: completedAt === undefined ? r.completedAt : completedAt && completedAt.toISOString(),
            updatedAt: updatedAt.toISOString(),
            sortOrder: changes.sortOrder ?? r.sortOrder,
          },
    );
  }

  async delete(id: number): Promise<boolean> {
    const before = this.#rows.length;
    this.#rows = this.#rows.filter((r) => r.id !== id);
    return this.#rows.length < before;
  }

  async photoFilenames(id: number): Promise<string[]> {
    return this.#photoNames.get(id) ?? [];
  }

  // その option の達成に写真が付いていることにする
  givePhotos(id: number, filenames: string[]): void {
    this.#photoNames.set(id, filenames);
  }

  async pendingOrder(): Promise<SortOrderEntry[]> {
    return this.#rows
      .filter((r) => r.status === "pending")
      .toSorted((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
      .map((r) => ({ id: r.id, sortOrder: r.sortOrder }));
  }

  async setSortOrders(entries: SortOrderEntry[]): Promise<void> {
    const next = new Map(entries.map((e) => [e.id, e.sortOrder]));
    this.#rows = this.#rows.map((r) => ({ ...r, sortOrder: next.get(r.id) ?? r.sortOrder }));
  }

  sortOrderOf(id: number): number | undefined {
    return this.#row(id)?.sortOrder;
  }

  #row(id: number): StoredOption | undefined {
    return this.#rows.find((r) => r.id === id);
  }

  #option(row: StoredOption): Option {
    const { sortOrder: _, ...option } = row;
    return option;
  }
}

// 固定した時刻を返す。advance で進める
export class FixedClock implements Clock {
  #now: Date;

  constructor(iso: string) {
    this.#now = new Date(iso);
  }

  now(): Date {
    return this.#now;
  }

  advance(ms: number): void {
    this.#now = new Date(this.#now.getTime() + ms);
  }
}
