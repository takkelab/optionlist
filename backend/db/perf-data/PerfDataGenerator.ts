import type { Database } from "../../src/infra/MySqlDatabase";

export type PerfDataCounts = {
  pendingOptions: number;
  completedOptions: number;
  achievements: number;
  events: number;
};

// metrics.md §1 の件数
export const PERF_DATA_COUNTS: PerfDataCounts = {
  pendingOptions: 500,
  completedOptions: 500,
  achievements: 5_000,
  events: 100_000,
};

export interface RandomSource {
  // 0 以上 1 未満
  next(): number;
}

// 毎回同じデータになるよう、シードを固定できる乱数（mulberry32）
export class SeededRandom implements RandomSource {
  #state: number;

  constructor(seed: number) {
    this.#state = seed >>> 0;
  }

  next(): number {
    this.#state = (this.#state + 0x6d2b79f5) >>> 0;
    let t = this.#state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}

export interface TargetGuard {
  ensureSafe(databaseUrl: string | undefined): void;
}

// 生成の前にデータを消すので、名前が _test で終わる DB にしか流さない（開発用 DB の実データを守る）
export class TestDatabaseGuard implements TargetGuard {
  ensureSafe(databaseUrl: string | undefined): void {
    const { pathname } = new URL(databaseUrl === undefined || databaseUrl === "" ? "mysql://localhost/" : databaseUrl);
    const name = pathname.slice(1);
    if (!name.endsWith("_test")) {
      throw new Error(`性能用データは名前が _test で終わる DB にだけ入れる（DATABASE_URL の DB 名: "${name}"）`);
    }
  }
}

export interface DataGenerator {
  generate(): Promise<void>;
}

const CHUNK_SIZE = 1_000;
const DAY_MS = 24 * 60 * 60 * 1000;
// 作成日などを散らす期間（数年分を想定。metrics.md §1）
const SPAN_DAYS = 3 * 365;
// 提案から追加した option の数。追加済みとまだの提案が混ざるよう、全件にはしない
const ADDED_SUGGESTIONS = 50;
// client_error の発生した画面（screens.md §8。送るイベントは client_error だけ。docs/decisions/0031）
const ERROR_ROUTES = ["/", "/done", "/suggestions", "/suggestions/12"];

// metrics.md §1 の性能用データを入れる。マスターデータ（themes・tags・suggestions・suggestion_tags）以外を消してから入れ直す
export class PerfDataGenerator implements DataGenerator {
  readonly #db: Database;
  readonly #counts: PerfDataCounts;
  readonly #random: RandomSource;
  readonly #now: Date;

  constructor(db: Database, counts: PerfDataCounts, random: RandomSource, now: Date) {
    this.#db = db;
    this.#counts = counts;
    this.#random = random;
    this.#now = now;
  }

  async generate(): Promise<void> {
    for (const table of ["achievements", "events", "options"]) {
      await this.#db.query("DELETE FROM ??", [table]);
    }
    await this.#insertOptions();
    await this.#insertAchievements();
    await this.#insertEvents();
  }

  #optionCount(): number {
    return this.#counts.pendingOptions + this.#counts.completedOptions;
  }

  async #insertOptions(): Promise<void> {
    const rows: unknown[][] = [];
    for (let id = 1; id <= this.#optionCount(); id++) {
      const pending = id <= this.#counts.pendingOptions;
      const createdAt = this.#pastDate();
      const suggestionId = id <= ADDED_SUGGESTIONS ? id : null;
      const completedAt = pending ? null : this.#between(createdAt, this.#now);
      const status = pending ? "pending" : "completed";
      // 半分に予定日を入れる（日付だけ）
      const plannedOn = id % 2 === 0 ? this.#pastDate().toISOString().slice(0, 10) : null;
      const updatedAt = completedAt ?? createdAt;
      rows.push([id, `性能テスト用 ${id}`, status, suggestionId, id, plannedOn, completedAt, createdAt, updatedAt]);
    }
    const columns = ["id", "title", "status", "suggestion_id", "sort_order", "planned_on", "completed_at", "created_at", "updated_at"];
    await this.#insert("options", columns, rows);
  }

  async #insertAchievements(): Promise<void> {
    const rows: unknown[][] = [];
    for (let i = 0; i < this.#counts.achievements; i++) {
      // 一覧が写真を読む分も測れるよう、3 件に 1 件に写真を付ける（ファイルは置かない。名前を読むだけ）
      const photo = i % 3 === 0 ? `perf-${i}.jpg` : null;
      rows.push([1 + Math.floor(this.#random.next() * this.#optionCount()), this.#pastDate(), photo]);
    }
    await this.#insert("achievements", ["option_id", "achieved_at", "photo_filename"], rows);
  }

  async #insertEvents(): Promise<void> {
    const rows: unknown[][] = [];
    for (let i = 0; i < this.#counts.events; i++) {
      const occurredAt = this.#pastDate();
      const payload = JSON.stringify({ message: `性能テスト用のエラー ${i % 20}`, route: ERROR_ROUTES[i % ERROR_ROUTES.length] });
      rows.push(["client_error", payload, occurredAt, new Date(occurredAt.getTime() + 1_000)]);
    }
    await this.#insert("events", ["type", "payload", "occurred_at", "received_at"], rows);
  }

  async #insert(table: string, columns: string[], rows: unknown[][]): Promise<void> {
    for (let start = 0; start < rows.length; start += CHUNK_SIZE) {
      await this.#db.query("INSERT INTO ?? (??) VALUES ?", [table, columns, rows.slice(start, start + CHUNK_SIZE)]);
    }
  }

  #pastDate(): Date {
    return new Date(this.#now.getTime() - Math.floor(this.#random.next() * SPAN_DAYS * DAY_MS));
  }

  #between(from: Date, to: Date): Date {
    return new Date(from.getTime() + Math.floor(this.#random.next() * (to.getTime() - from.getTime())));
  }
}
