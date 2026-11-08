import type { Achievement } from "../../../shared/types";
import type { Database } from "../infra/PgDatabase";
import { AppError } from "../services/errors";
import type { AchievementRow, RowMapper } from "./OptionRowMapper";

export interface AchievementStore {
  // 存在しない option なら NOT_FOUND
  insert(optionId: number, achievedAt: Date): Promise<Achievement>;
  // 存在しなければ null
  find(id: number): Promise<StoredAchievement | null>;
  // filename の null で写真を外す
  setPhoto(id: number, filename: string | null): Promise<void>;
}

// photoFilename は置き換え・削除のときに古いファイルを消すために使う（API には出さない）
export type StoredAchievement = { achievement: Achievement; photoFilename: string | null };

type IdRow = { id: number };

// SQLSTATE の外部キー違反
const FOREIGN_KEY_VIOLATION = "23503";

// achievements テーブルの SQL。達成の記録は書いた値がわかっているので、読み直さずに返す（1 リクエスト 1 本）
export class AchievementRepository implements AchievementStore {
  readonly #db: Database;
  readonly #mapper: RowMapper;

  constructor(db: Database, mapper: RowMapper) {
    this.#db = db;
    this.#mapper = mapper;
  }

  async find(id: number): Promise<StoredAchievement | null> {
    const rows = (await this.#db.query("SELECT id, option_id, achieved_at, photo_filename FROM achievements WHERE id = $1", [id])) as AchievementRow[];
    const [row] = rows;
    return row === undefined ? null : { achievement: this.#mapper.achievement(row), photoFilename: row.photo_filename };
  }

  async setPhoto(id: number, filename: string | null): Promise<void> {
    await this.#db.query("UPDATE achievements SET photo_filename = $1 WHERE id = $2", [filename, id]);
  }

  // 存在しない option は外部キー違反になる（api.md §3 の 404）
  async insert(optionId: number, achievedAt: Date): Promise<Achievement> {
    try {
      const rows = (await this.#db.query("INSERT INTO achievements (option_id, achieved_at) VALUES ($1, $2) RETURNING id", [
        optionId,
        achievedAt,
      ])) as IdRow[];
      const [inserted] = rows;
      if (inserted === undefined) throw new Error("INSERT … RETURNING id が行を返さなかった");
      return { id: inserted.id, optionId, achievedAt: achievedAt.toISOString(), photoUrl: null };
    } catch (error) {
      const code = error instanceof Error && "code" in error ? error.code : undefined;
      if (code === FOREIGN_KEY_VIOLATION) throw new AppError("NOT_FOUND", `option ${optionId} が見つからない`);
      throw error;
    }
  }
}
