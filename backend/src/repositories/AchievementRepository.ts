import type { Achievement } from "../../../shared/types";
import type { Database } from "../infra/MySqlDatabase";
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

type WriteResult = { insertId: number };

// achievements テーブルの SQL。達成の記録は書いた値がわかっているので、読み直さずに返す（1 リクエスト 1 本）
export class AchievementRepository implements AchievementStore {
  readonly #db: Database;
  readonly #mapper: RowMapper;

  constructor(db: Database, mapper: RowMapper) {
    this.#db = db;
    this.#mapper = mapper;
  }

  async find(id: number): Promise<StoredAchievement | null> {
    const rows = (await this.#db.query("SELECT id, option_id, achieved_at, photo_filename FROM achievements WHERE id = ?", [id])) as AchievementRow[];
    const [row] = rows;
    return row === undefined ? null : { achievement: this.#mapper.achievement(row), photoFilename: row.photo_filename };
  }

  async setPhoto(id: number, filename: string | null): Promise<void> {
    await this.#db.query("UPDATE achievements SET photo_filename = ? WHERE id = ?", [filename, id]);
  }

  // 存在しない option は外部キー違反になる（api.md §3 の 404）
  async insert(optionId: number, achievedAt: Date): Promise<Achievement> {
    try {
      const result = (await this.#db.query("INSERT INTO achievements (option_id, achieved_at) VALUES (?, ?)", [
        optionId,
        achievedAt,
      ])) as WriteResult;
      return { id: result.insertId, optionId, achievedAt: achievedAt.toISOString(), photoUrl: null };
    } catch (error) {
      const code = error instanceof Error && "code" in error ? error.code : undefined;
      if (code === "ER_NO_REFERENCED_ROW_2") throw new AppError("NOT_FOUND", `option ${optionId} が見つからない`);
      throw error;
    }
  }
}
