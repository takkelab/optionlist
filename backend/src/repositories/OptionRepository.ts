import type { Option, OptionDetail, OptionStatus } from "../../../shared/types";
import type { Queryable, UserScopes } from "../infra/PgDatabase";
import { AppError } from "../services/errors";
import type { AchievementRow, OptionRow, RowMapper } from "./OptionRowMapper";

export type SortOrderEntry = { id: number; sortOrder: number };

export type NewOptionRow = { title: string; suggestionId: number | null; sortOrder: number; now: Date };

// 変える列だけを入れる（undefined の列はそのまま）
export type OptionChanges = {
  title?: string;
  status?: OptionStatus;
  // null で消す
  plannedOn?: string | null;
  completedAt?: Date | null;
  sortOrder?: number;
  updatedAt: Date;
};

// 1 人分の options の SQL。withUser の中でだけ使える
export interface OptionStore {
  list(status: OptionStatus): Promise<Option[]>;
  find(id: number): Promise<Option | null>;
  findDetail(id: number): Promise<OptionDetail | null>;
  // pending の sort_order の最小値。pending がなければ null
  minPendingSortOrder(): Promise<number | null>;
  insert(row: NewOptionRow): Promise<number>;
  update(id: number, changes: OptionChanges): Promise<void>;
  delete(id: number): Promise<boolean>;
  // その option の達成に付いている写真のファイル名（削除のあとで消すために、先に読む）
  photoFilenames(id: number): Promise<string[]>;
  // pending の id と sort_order（sort_order 順）
  pendingOrder(): Promise<SortOrderEntry[]>;
  setSortOrders(entries: SortOrderEntry[]): Promise<void>;
}

// fn の中の SQL を、その人の 1 つのトランザクションで流す（data.md §4）。fn が投げたら全部取り消す
export interface OptionStores {
  withUser<T>(userId: number | null, fn: (store: OptionStore) => Promise<T>): Promise<T>;
}

type IdRow = { id: number };

// UPDATE で書き換えてよい列（OptionChanges のキー → 列名）。値はプレースホルダで渡す
const CHANGE_COLUMNS: Record<keyof OptionChanges, string> = {
  title: "title",
  status: "status",
  plannedOn: "planned_on",
  completedAt: "completed_at",
  sortOrder: "sort_order",
  updatedAt: "updated_at",
};

// SQLSTATE（https://www.postgresql.org/docs/17/errcodes-appendix.html）
const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";

// 達成回数は achievements の件数から求める（data.md §2）。planned_on は pg が 2026-11-23 の文字列で返す（infra/PgPoolFactory.ts）
// どの SQL も $1 をその人の user_id にする。RLS（data.md §4）に加えて、SQL でも絞り込む（docs/decisions/0034）
const OPTION_COLUMNS = `o.id, o.title, o.status, o.suggestion_id, o.planned_on,
  o.completed_at, o.created_at, o.updated_at,
  (SELECT COUNT(*) FROM achievements a WHERE a.option_id = o.id AND a.user_id = $1) AS achievement_count,
  (SELECT a.photo_filename FROM achievements a WHERE a.option_id = o.id AND a.user_id = $1 AND a.photo_filename IS NOT NULL
    ORDER BY a.achieved_at DESC, a.id DESC LIMIT 1) AS latest_photo_filename`;
// pending は予定日があるものを予定日の早い順に上へ、その後に予定日がないもの（同じ日は id 順、予定日なし同士は sort_order 順。
// 同じ日を id 順にするのは、sort_order を持たない画面でも同じ並びにできるようにするため。docs/decisions/0015）。
// completed は completed_at の新しい順（api.md §2）
const LIST_SQL: Record<OptionStatus, string> = {
  pending: `SELECT ${OPTION_COLUMNS} FROM options o WHERE o.user_id = $1 AND o.status = 'pending'
    ORDER BY o.planned_on IS NULL, o.planned_on, CASE WHEN o.planned_on IS NULL THEN o.sort_order END, o.id`,
  completed: `SELECT ${OPTION_COLUMNS} FROM options o WHERE o.user_id = $1 AND o.status = 'completed' ORDER BY o.completed_at DESC, o.id DESC`,
};

// options テーブルの SQL。詳細は達成記録を別の SQL で取り、1 リクエスト 3 本以内に収める（metrics.md §4）
export class OptionRepository implements OptionStores {
  readonly #db: UserScopes;
  readonly #mapper: RowMapper;

  constructor(db: UserScopes, mapper: RowMapper) {
    this.#db = db;
    this.#mapper = mapper;
  }

  withUser<T>(userId: number | null, fn: (store: OptionStore) => Promise<T>): Promise<T> {
    const scoped = this.#db.forUser(userId);
    return scoped.run((tx) => fn(new OptionQueries(tx, this.#mapper, userId)));
  }
}

class OptionQueries implements OptionStore {
  readonly #tx: Queryable;
  readonly #mapper: RowMapper;
  readonly #userId: number | null;

  constructor(tx: Queryable, mapper: RowMapper, userId: number | null) {
    this.#tx = tx;
    this.#mapper = mapper;
    this.#userId = userId;
  }

  async list(status: OptionStatus): Promise<Option[]> {
    const rows = (await this.#query(LIST_SQL[status])) as OptionRow[];
    return rows.map((row) => this.#mapper.option(row));
  }

  async find(id: number): Promise<Option | null> {
    const [row] = (await this.#query(`SELECT ${OPTION_COLUMNS} FROM options o WHERE o.user_id = $1 AND o.id = $2`, [id])) as OptionRow[];
    return row === undefined ? null : this.#mapper.option(row);
  }

  // 提案から追加した項目は、追加元の提案の最初の一歩も付ける（screens.md §3）
  async findDetail(id: number): Promise<OptionDetail | null> {
    const [row] = (await this.#query(
      `SELECT ${OPTION_COLUMNS}, s.first_step FROM options o LEFT JOIN suggestions s ON s.id = o.suggestion_id WHERE o.user_id = $1 AND o.id = $2`,
      [id],
    )) as (OptionRow & { first_step: string | null })[];
    if (row === undefined) return null;
    const achievements = (await this.#query(
      "SELECT id, option_id, achieved_at, photo_filename FROM achievements WHERE user_id = $1 AND option_id = $2 ORDER BY achieved_at, id",
      [id],
    )) as AchievementRow[];
    return {
      ...this.#mapper.option(row),
      achievements: achievements.map((achievement) => this.#mapper.achievement(achievement)),
      firstStep: row.first_step,
    };
  }

  async minPendingSortOrder(): Promise<number | null> {
    const [row] = (await this.#query("SELECT MIN(sort_order) AS min FROM options WHERE user_id = $1 AND status = 'pending'")) as {
      min: number | null;
    }[];
    return row === undefined ? null : row.min;
  }

  // 同じ提案の二重追加（UNIQUE 違反）は 409、存在しない提案（外部キー違反）は 404（api.md §3）
  async insert(row: NewOptionRow): Promise<number> {
    try {
      const [inserted] = (await this.#query(
        `INSERT INTO options (user_id, title, status, suggestion_id, sort_order, created_at, updated_at)
         VALUES ($1, $2, 'pending', $3, $4, $5, $5) RETURNING id`,
        [row.title, row.suggestionId, row.sortOrder, row.now],
      )) as IdRow[];
      if (inserted === undefined) throw new Error("INSERT … RETURNING id が行を返さなかった");
      return inserted.id;
    } catch (error) {
      throw this.#translate(error);
    }
  }

  // 列名は CHANGE_COLUMNS の決まった名前だけを並べ、値はプレースホルダで渡す
  async update(id: number, changes: OptionChanges): Promise<void> {
    const entries = Object.entries(changes).filter(([, value]) => value !== undefined);
    const sets = entries.map(([key], i) => `${CHANGE_COLUMNS[key as keyof OptionChanges]} = $${i + 3}`);
    await this.#query(`UPDATE options SET ${sets.join(", ")} WHERE user_id = $1 AND id = $2`, [id, ...entries.map(([, value]) => value)]);
  }

  // 達成記録は外部キーの ON DELETE CASCADE で消える
  async delete(id: number): Promise<boolean> {
    const rows = (await this.#query("DELETE FROM options WHERE user_id = $1 AND id = $2 RETURNING id", [id])) as IdRow[];
    return rows.length > 0;
  }

  // 写真がまだない行も FOR UPDATE で押さえる（消す間に写真が付け替えられて、新しいファイルが残らないように。docs/decisions/0051）
  async photoFilenames(id: number): Promise<string[]> {
    const rows = (await this.#query("SELECT photo_filename FROM achievements WHERE user_id = $1 AND option_id = $2 FOR UPDATE", [
      id,
    ])) as { photo_filename: string | null }[];
    return rows.flatMap((row) => (row.photo_filename === null ? [] : [row.photo_filename]));
  }

  async pendingOrder(): Promise<SortOrderEntry[]> {
    const rows = (await this.#query(
      "SELECT id, sort_order FROM options WHERE user_id = $1 AND status = 'pending' ORDER BY sort_order, id",
    )) as { id: number; sort_order: number }[];
    return rows.map((row) => ({ id: row.id, sortOrder: row.sort_order }));
  }

  // 1 本の UPDATE で書き換える。id と sort_order を同じ順の配列で渡し、array_position で引き当てる
  async setSortOrders(entries: SortOrderEntry[]): Promise<void> {
    if (entries.length === 0) return;
    await this.#query(
      `UPDATE options SET sort_order = ($3::integer[])[array_position($2::bigint[], id)] WHERE user_id = $1 AND id = ANY($2::bigint[])`,
      [entries.map((e) => e.id), entries.map((e) => e.sortOrder)],
    );
  }

  // $1 はいつもその人の user_id（null なら 1 行も当たらない）
  #query(sql: string, params: unknown[] = []): Promise<unknown> {
    return this.#tx.query(sql, [this.#userId, ...params]);
  }

  #translate(error: unknown): unknown {
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    if (code === UNIQUE_VIOLATION) return new AppError("CONFLICT", "この提案はすでに追加されている");
    if (code === FOREIGN_KEY_VIOLATION) return new AppError("NOT_FOUND", "提案が見つからない");
    return error;
  }
}
