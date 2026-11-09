import type { Achievement } from "../../../shared/types";
import type { Queryable, UserScopes } from "../infra/PgDatabase";
import { AppError } from "../services/errors";
import type { AchievementRow, RowMapper } from "./OptionRowMapper";

// 1 人分の achievements の SQL。withUser の中でだけ使える
export interface AchievementStore {
  // 存在しない（他人のものを含む）option なら NOT_FOUND
  insert(optionId: number, achievedAt: Date): Promise<Achievement>;
  // 存在しなければ null
  find(id: number): Promise<StoredAchievement | null>;
  // null で写真を外す。前の写真の名前を返す（行を FOR UPDATE で押さえてから読むので、同時に置き換えても消し損ねない）
  // 達成がなければ null
  setPhoto(id: number, photo: StoredPhoto | null): Promise<PhotoChange | null>;
  // そのファイル名が、この人の達成の写真か（写真の配信。api.md §5）
  ownsPhoto(filename: string): Promise<boolean>;
  // この人の写真の枚数と合計の大きさ。exceptId の達成の写真は数えない（置き換える写真。1 人あたりの上限。data.md §3）
  photoUsage(exceptId: number): Promise<PhotoUsage>;
}

export type StoredPhoto = { filename: string; bytes: number };
export type PhotoUsage = { count: number; bytes: number };
export type PhotoChange = { previous: string | null };

export interface AchievementStores {
  withUser<T>(userId: number | null, fn: (store: AchievementStore) => Promise<T>): Promise<T>;
}

// photoFilename は置き換え・削除のときに古いファイルを消すために使う（API には出さない）
export type StoredAchievement = { achievement: Achievement; photoFilename: string | null };

type IdRow = { id: number };

// SQLSTATE の外部キー違反
const FOREIGN_KEY_VIOLATION = "23503";

// achievements テーブルの SQL。達成の記録は書いた値がわかっているので、読み直さずに返す（1 リクエスト 1 本）
export class AchievementRepository implements AchievementStores {
  readonly #db: UserScopes;
  readonly #mapper: RowMapper;

  constructor(db: UserScopes, mapper: RowMapper) {
    this.#db = db;
    this.#mapper = mapper;
  }

  withUser<T>(userId: number | null, fn: (store: AchievementStore) => Promise<T>): Promise<T> {
    const scoped = this.#db.forUser(userId);
    return scoped.run((tx) => fn(new AchievementQueries(tx, this.#mapper, userId)));
  }
}

// どの SQL も $1 をその人の user_id にする（RLS に加えて SQL でも絞り込む。docs/decisions/0034）
class AchievementQueries implements AchievementStore {
  readonly #tx: Queryable;
  readonly #mapper: RowMapper;
  readonly #userId: number | null;

  constructor(tx: Queryable, mapper: RowMapper, userId: number | null) {
    this.#tx = tx;
    this.#mapper = mapper;
    this.#userId = userId;
  }

  async find(id: number): Promise<StoredAchievement | null> {
    const [row] = (await this.#query(
      "SELECT id, option_id, achieved_at, photo_filename FROM achievements WHERE user_id = $1 AND id = $2",
      [id],
    )) as AchievementRow[];
    return row === undefined ? null : { achievement: this.#mapper.achievement(row), photoFilename: row.photo_filename };
  }

  // 副問い合わせの FOR UPDATE で行を押さえる。同時に来た別の置き換えは、前のものが COMMIT するまで待ち、その新しい名前を前の写真として受け取る
  async setPhoto(id: number, photo: StoredPhoto | null): Promise<PhotoChange | null> {
    const [row] = (await this.#query(
      `UPDATE achievements a SET photo_filename = $2, photo_bytes = $3
       FROM (SELECT id, photo_filename FROM achievements WHERE user_id = $1 AND id = $4 FOR UPDATE) old
       WHERE a.id = old.id AND a.user_id = $1
       RETURNING old.photo_filename AS previous`,
      [photo === null ? null : photo.filename, photo === null ? null : photo.bytes, id],
    )) as { previous: string | null }[];
    return row === undefined ? null : { previous: row.previous };
  }

  // COUNT・SUM は BIGINT・NUMERIC なので文字列で返る
  async photoUsage(exceptId: number): Promise<PhotoUsage> {
    const [row] = (await this.#query(
      "SELECT COUNT(photo_filename) AS count, COALESCE(SUM(photo_bytes), 0) AS bytes FROM achievements WHERE user_id = $1 AND id <> $2",
      [exceptId],
    )) as { count: string; bytes: string }[];
    return { count: Number(row?.count ?? 0), bytes: Number(row?.bytes ?? 0) };
  }

  async ownsPhoto(filename: string): Promise<boolean> {
    const rows = await this.#query("SELECT 1 FROM achievements WHERE user_id = $1 AND photo_filename = $2", [filename]);
    return Array.isArray(rows) && rows.length > 0;
  }

  // 項目の持ち主と達成の持ち主は複合外部キー（option_id, user_id）で同じになる。他人の option は外部キー違反（api.md §3 の 404）
  async insert(optionId: number, achievedAt: Date): Promise<Achievement> {
    if (this.#userId === null) throw this.#notFound(optionId);
    try {
      const [inserted] = (await this.#query("INSERT INTO achievements (user_id, option_id, achieved_at) VALUES ($1, $2, $3) RETURNING id", [
        optionId,
        achievedAt,
      ])) as IdRow[];
      if (inserted === undefined) throw new Error("INSERT … RETURNING id が行を返さなかった");
      return { id: inserted.id, optionId, achievedAt: achievedAt.toISOString(), photoUrl: null };
    } catch (error) {
      const code = error instanceof Error && "code" in error ? error.code : undefined;
      if (code === FOREIGN_KEY_VIOLATION) throw this.#notFound(optionId);
      throw error;
    }
  }

  #query(sql: string, params: unknown[] = []): Promise<unknown> {
    return this.#tx.query(sql, [this.#userId, ...params]);
  }

  #notFound(optionId: number): AppError {
    return new AppError("NOT_FOUND", `option ${optionId} が見つからない`);
  }
}
