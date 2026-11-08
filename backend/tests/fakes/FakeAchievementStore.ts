import type { Achievement } from "../../../shared/types";
import type { AchievementStore, StoredAchievement } from "../../src/repositories/AchievementRepository";
import { AppError } from "../../src/services/errors";

// メモリ上の AchievementStore。options に当たるのは、コンストラクタで渡した ID だけ
export class FakeAchievementStore implements AchievementStore {
  readonly #optionIds: Set<number>;
  readonly #photos = new Map<number, string>();
  #rows: Achievement[] = [];
  #failWrites = false;
  #vanishAfterWrite = false;
  #written = false;

  constructor(optionIds: number[]) {
    this.#optionIds = new Set(optionIds);
  }

  async insert(optionId: number, achievedAt: Date): Promise<Achievement> {
    if (!this.#optionIds.has(optionId)) throw new AppError("NOT_FOUND", `option ${optionId} が見つからない`);
    const achievement = { id: this.#rows.length + 1, optionId, achievedAt: achievedAt.toISOString(), photoUrl: null };
    this.#rows.push(achievement);
    return achievement;
  }

  async find(id: number): Promise<StoredAchievement | null> {
    if (this.#vanishAfterWrite && this.#written) return null;
    const achievement = this.#rows.find((row) => row.id === id);
    if (achievement === undefined) return null;
    return { achievement, photoFilename: this.#photos.get(id) ?? null };
  }

  async setPhoto(id: number, filename: string | null): Promise<void> {
    if (this.#failWrites) throw new Error("UPDATE が失敗した");
    this.#written = true;
    if (filename === null) {
      this.#photos.delete(id);
      this.#rows = this.#rows.map((row) => (row.id === id ? { ...row, photoUrl: null } : row));
      return;
    }
    this.#photos.set(id, filename);
    this.#rows = this.#rows.map((row) => (row.id === id ? { ...row, photoUrl: `/api/photos/${filename}` } : row));
  }

  // setPhoto を失敗させる
  failWrites(): void {
    this.#failWrites = true;
  }

  // setPhoto のあとに読むと行がない（別の端末で項目ごと消された）
  vanishAfterWrite(): void {
    this.#vanishAfterWrite = true;
  }

  saved(): Achievement[] {
    return [...this.#rows];
  }
}
