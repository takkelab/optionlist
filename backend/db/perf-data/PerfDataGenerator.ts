import { createHash } from "node:crypto";
import type { Database } from "../../src/infra/PgDatabase";

// 1 人あたりの件数と人数。データを持つ人（usersWithData）はみな同じ内訳で、先頭（id 1）が測る人
export type PerfDataCounts = {
  pendingOptions: number;
  completedOptions: number;
  achievements: number;
  events: number;
  usersWithData: number;
  // 項目のない人
  emptyUsers: number;
};

// metrics.md §1 の件数（測る人 1・データを持つほかの人 49・項目のない人 9,950）
export const PERF_DATA_COUNTS: PerfDataCounts = {
  pendingOptions: 500,
  completedOptions: 500,
  achievements: 5_000,
  events: 100_000,
  usersWithData: 50,
  emptyUsers: 9_950,
};

// 測る人（users の id 1）の Cookie の鍵。性能テストはこの鍵の ol_session で API を呼ぶ（32 バイトの base64url と同じ 43 文字）
export const PERF_SESSION_KEY = "perf-measured-user-session-key-000000000000";

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
    const { pathname } = new URL(databaseUrl === undefined || databaseUrl === "" ? "postgres://localhost/" : databaseUrl);
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
// 写真 1 枚の大きさ（長辺 1280px の JPEG のだいたいの大きさ）
const PHOTO_BYTES = 300_000;
// 作成日などを散らす期間（数年分を想定。metrics.md §1）
const SPAN_DAYS = 3 * 365;
// 1 人が提案から追加した option の数。追加済みとまだの提案が混ざるよう、全件にはしない
const ADDED_SUGGESTIONS = 50;
// client_error の発生した画面（screens.md §8。送るイベントは client_error だけ。docs/decisions/0031）
const ERROR_ROUTES = ["/", "/done", "/suggestions", "/suggestions/12"];

// metrics.md §1 の性能用データを入れる。マスターデータ（themes・tags・suggestions・suggestion_tags）以外を消してから入れ直す
// db は ol_migrator の接続（RLS の USING (true) のポリシーで、全員の行を書ける。data.md §4）
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

  // ID を 1 から振り直すので、users・options は入れた順に 1, 2, … になる（options・achievements はそれを使う）
  // 人 u（1 始まり）の options の id は (u - 1) × 1 人の件数 + 1 から続く
  async generate(): Promise<void> {
    await this.#db.query("TRUNCATE TABLE achievements, auth_attempts, events, options, users RESTART IDENTITY");
    await this.#insertUsers();
    await this.#insertOptions();
    await this.#insertAchievements();
    await this.#insertEvents();
  }

  #optionCount(): number {
    return this.#counts.pendingOptions + this.#counts.completedOptions;
  }

  // 測る人だけ鍵が分かっている。last_seen_at は今（測っている間に last_seen_at を書かない）
  async #insertUsers(): Promise<void> {
    const rows: unknown[][] = [];
    const total = this.#counts.usersWithData + this.#counts.emptyUsers;
    for (let u = 1; u <= total; u++) {
      const key = u === 1 ? PERF_SESSION_KEY : `perf-user-${u}`;
      const hash = createHash("sha256");
      hash.update(key);
      rows.push([hash.digest(), this.#pastDate(), u === 1 ? this.#now : this.#pastDate()]);
    }
    await this.#insert("users", ["session_hash", "created_at", "last_seen_at"], rows);
  }

  async #insertOptions(): Promise<void> {
    const rows: unknown[][] = [];
    for (let u = 1; u <= this.#counts.usersWithData; u++) {
      for (let n = 1; n <= this.#optionCount(); n++) rows.push(this.#option(u, n));
    }
    const columns = ["user_id", "title", "status", "suggestion_id", "sort_order", "planned_on", "completed_at", "created_at", "updated_at"];
    await this.#insert("options", columns, rows);
  }

  // 人 u の n 件目（1 始まり）。前の pendingOptions 件が pending
  #option(u: number, n: number): unknown[] {
    const pending = n <= this.#counts.pendingOptions;
    const createdAt = this.#pastDate();
    const suggestionId = n <= ADDED_SUGGESTIONS ? n : null;
    const completedAt = pending ? null : this.#between(createdAt, this.#now);
    // 半分に予定日を入れる（日付だけ）
    const plannedOn = n % 2 === 0 ? this.#pastDate().toISOString().slice(0, 10) : null;
    return [u, `性能テスト用 ${n}`, pending ? "pending" : "completed", suggestionId, n, plannedOn, completedAt, createdAt, completedAt ?? createdAt];
  }

  async #insertAchievements(): Promise<void> {
    const rows: unknown[][] = [];
    for (let u = 1; u <= this.#counts.usersWithData; u++) {
      const firstOption = (u - 1) * this.#optionCount() + 1;
      for (let i = 0; i < this.#counts.achievements; i++) {
        // 一覧が写真を読む分も測れるよう、3 件に 1 件に写真を付ける（ファイルは置かない。名前を読むだけ。名前は全員で重ならない）
        const photo = i % 3 === 0 ? `perf-${u}-${i}.jpg` : null;
        // 大きさは作り直した写真のだいたいの大きさ（1 人あたりの上限の判定に使う。data.md §3）
        const bytes = photo === null ? null : PHOTO_BYTES;
        rows.push([u, firstOption + Math.floor(this.#random.next() * this.#optionCount()), this.#pastDate(), photo, bytes]);
      }
    }
    await this.#insert("achievements", ["user_id", "option_id", "achieved_at", "photo_filename", "photo_bytes"], rows);
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

  // 表と列の名前はこのクラスの決まった値（入力ではない）。値は ($1, $2, …) のプレースホルダで渡す
  // 1 本のプレースホルダは 65,535 個までなので、1,000 行ずつに分ける（9 列でも 9,000 個）
  async #insert(table: string, columns: string[], rows: unknown[][]): Promise<void> {
    for (let start = 0; start < rows.length; start += CHUNK_SIZE) {
      const chunk = rows.slice(start, start + CHUNK_SIZE);
      const tuples = chunk.map((_, r) => `(${columns.map((_column, c) => `$${r * columns.length + c + 1}`).join(", ")})`);
      await this.#db.query(`INSERT INTO ${table} (${columns.join(", ")}) VALUES ${tuples.join(", ")}`, chunk.flat());
    }
  }

  #pastDate(): Date {
    return new Date(this.#now.getTime() - Math.floor(this.#random.next() * SPAN_DAYS * DAY_MS));
  }

  #between(from: Date, to: Date): Date {
    return new Date(from.getTime() + Math.floor(this.#random.next() * (to.getTime() - from.getTime())));
  }
}
