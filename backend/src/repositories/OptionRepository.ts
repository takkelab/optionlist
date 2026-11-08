import type { Option, OptionDetail, OptionStatus } from "../../../shared/types";
import type { Database } from "../infra/PgDatabase";
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
const OPTION_COLUMNS = `o.id, o.title, o.status, o.suggestion_id, o.planned_on,
  o.completed_at, o.created_at, o.updated_at,
  (SELECT COUNT(*) FROM achievements a WHERE a.option_id = o.id) AS achievement_count,
  (SELECT a.photo_filename FROM achievements a WHERE a.option_id = o.id AND a.photo_filename IS NOT NULL
    ORDER BY a.achieved_at DESC, a.id DESC LIMIT 1) AS latest_photo_filename`;
// pending は予定日があるものを予定日の早い順に上へ、その後に予定日がないもの（同じ日は id 順、予定日なし同士は sort_order 順。
// 同じ日を id 順にするのは、sort_order を持たない画面でも同じ並びにできるようにするため。docs/decisions/0015）。
// completed は completed_at の新しい順（api.md §2）
const LIST_SQL: Record<OptionStatus, string> = {
  pending: `SELECT ${OPTION_COLUMNS} FROM options o WHERE o.status = 'pending'
    ORDER BY o.planned_on IS NULL, o.planned_on, CASE WHEN o.planned_on IS NULL THEN o.sort_order END, o.id`,
  completed: `SELECT ${OPTION_COLUMNS} FROM options o WHERE o.status = 'completed' ORDER BY o.completed_at DESC, o.id DESC`,
};

// options テーブルの SQL。詳細は達成記録を別の SQL で取り、1 リクエスト 3 本以内に収める（metrics.md §4）
export class OptionRepository implements OptionStore {
  readonly #db: Database;
  readonly #mapper: RowMapper;

  constructor(db: Database, mapper: RowMapper) {
    this.#db = db;
    this.#mapper = mapper;
  }

  async list(status: OptionStatus): Promise<Option[]> {
    const rows = (await this.#db.query(LIST_SQL[status])) as OptionRow[];
    return rows.map((row) => this.#mapper.option(row));
  }

  async find(id: number): Promise<Option | null> {
    const rows = (await this.#db.query(`SELECT ${OPTION_COLUMNS} FROM options o WHERE o.id = $1`, [id])) as OptionRow[];
    const [row] = rows;
    return row === undefined ? null : this.#mapper.option(row);
  }

  // 提案から追加した項目は、追加元の提案の最初の一歩も付ける（screens.md §3）
  async findDetail(id: number): Promise<OptionDetail | null> {
    const rows = (await this.#db.query(
      `SELECT ${OPTION_COLUMNS}, s.first_step FROM options o LEFT JOIN suggestions s ON s.id = o.suggestion_id WHERE o.id = $1`,
      [id],
    )) as (OptionRow & { first_step: string | null })[];
    const [row] = rows;
    if (row === undefined) return null;
    const achievements = (await this.#db.query(
      "SELECT id, option_id, achieved_at, photo_filename FROM achievements WHERE option_id = $1 ORDER BY achieved_at, id",
      [id],
    )) as AchievementRow[];
    return {
      ...this.#mapper.option(row),
      achievements: achievements.map((achievement) => this.#mapper.achievement(achievement)),
      firstStep: row.first_step,
    };
  }

  async minPendingSortOrder(): Promise<number | null> {
    const rows = (await this.#db.query("SELECT MIN(sort_order) AS min FROM options WHERE status = 'pending'")) as {
      min: number | null;
    }[];
    const [row] = rows;
    return row === undefined ? null : row.min;
  }

  // 同じ提案の二重追加（UNIQUE 違反）は 409、存在しない提案（外部キー違反）は 404（api.md §3）
  async insert(row: NewOptionRow): Promise<number> {
    try {
      const rows = (await this.#db.query(
        `INSERT INTO options (title, status, suggestion_id, sort_order, created_at, updated_at)
         VALUES ($1, 'pending', $2, $3, $4, $4) RETURNING id`,
        [row.title, row.suggestionId, row.sortOrder, row.now],
      )) as IdRow[];
      const [inserted] = rows;
      if (inserted === undefined) throw new Error("INSERT … RETURNING id が行を返さなかった");
      return inserted.id;
    } catch (error) {
      throw this.#translate(error);
    }
  }

  // 列名は CHANGE_COLUMNS の決まった名前だけを並べ、値はプレースホルダで渡す
  async update(id: number, changes: OptionChanges): Promise<void> {
    const entries = Object.entries(changes).filter(([, value]) => value !== undefined);
    const sets = entries.map(([key], i) => `${CHANGE_COLUMNS[key as keyof OptionChanges]} = $${i + 2}`);
    await this.#db.query(`UPDATE options SET ${sets.join(", ")} WHERE id = $1`, [id, ...entries.map(([, value]) => value)]);
  }

  // 達成記録は外部キーの ON DELETE CASCADE で消える
  async delete(id: number): Promise<boolean> {
    const rows = (await this.#db.query("DELETE FROM options WHERE id = $1 RETURNING id", [id])) as IdRow[];
    return rows.length > 0;
  }

  async photoFilenames(id: number): Promise<string[]> {
    const rows = (await this.#db.query("SELECT photo_filename FROM achievements WHERE option_id = $1 AND photo_filename IS NOT NULL", [id])) as {
      photo_filename: string;
    }[];
    return rows.map((row) => row.photo_filename);
  }

  async pendingOrder(): Promise<SortOrderEntry[]> {
    const rows = (await this.#db.query(
      "SELECT id, sort_order FROM options WHERE status = 'pending' ORDER BY sort_order, id",
    )) as { id: number; sort_order: number }[];
    return rows.map((row) => ({ id: row.id, sortOrder: row.sort_order }));
  }

  // 1 本の UPDATE で書き換える。id と sort_order を同じ順の配列で渡し、array_position で引き当てる
  async setSortOrders(entries: SortOrderEntry[]): Promise<void> {
    if (entries.length === 0) return;
    await this.#db.query(
      `UPDATE options SET sort_order = ($2::integer[])[array_position($1::bigint[], id)] WHERE id = ANY($1::bigint[])`,
      [entries.map((e) => e.id), entries.map((e) => e.sortOrder)],
    );
  }

  #translate(error: unknown): unknown {
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    if (code === UNIQUE_VIOLATION) return new AppError("CONFLICT", "この提案はすでに追加されている");
    if (code === FOREIGN_KEY_VIOLATION) return new AppError("NOT_FOUND", "提案が見つからない");
    return error;
  }
}
