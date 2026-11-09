import type { Achievement } from "../../../shared/types";
import type {
  AchievementStore,
  AchievementStores,
  PhotoChange,
  PhotoUsage,
  StoredAchievement,
  StoredPhoto,
} from "../../src/repositories/AchievementRepository";
import { AppError } from "../../src/services/errors";

// メモリ上の AchievementStore。options に当たるのは、コンストラクタで渡した ID だけ
// withUser は人を覚えて自分を渡すだけ（人ごとに分けるのは RLS と SQL の仕事なので、API テストで確かめる）
export class FakeAchievementStore implements AchievementStore, AchievementStores {
  readonly #users: (number | null)[] = [];
  readonly #optionIds: Set<number>;
  readonly #photos = new Map<number, StoredPhoto>();
  #rows: Achievement[] = [];
  #failWrites = false;
  #vanishAfterWrite = false;
  #written = false;

  constructor(optionIds: number[]) {
    this.#optionIds = new Set(optionIds);
  }

  withUser<T>(userId: number | null, fn: (store: AchievementStore) => Promise<T>): Promise<T> {
    this.#users.push(userId);
    return fn(this);
  }

  // withUser に渡された人（呼ばれた順）
  users(): (number | null)[] {
    return [...this.#users];
  }

  async ownsPhoto(filename: string): Promise<boolean> {
    return [...this.#photos.values()].some((photo) => photo.filename === filename);
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
    const photo = this.#photos.get(id);
    return { achievement, photoFilename: photo === undefined ? null : photo.filename };
  }

  async setPhoto(id: number, photo: StoredPhoto | null): Promise<PhotoChange | null> {
    if (this.#failWrites) throw new Error("UPDATE が失敗した");
    if (!this.#rows.some((row) => row.id === id)) return null;
    this.#written = true;
    const before = this.#photos.get(id);
    const previous = before === undefined ? null : before.filename;
    if (photo === null) {
      this.#photos.delete(id);
      this.#rows = this.#rows.map((row) => (row.id === id ? { ...row, photoUrl: null } : row));
      return { previous };
    }
    this.#photos.set(id, photo);
    this.#rows = this.#rows.map((row) => (row.id === id ? { ...row, photoUrl: `/api/photos/${photo.filename}` } : row));
    return { previous };
  }

  async photoUsage(exceptId: number): Promise<PhotoUsage> {
    const others = [...this.#photos].filter(([id]) => id !== exceptId);
    return { count: others.length, bytes: others.reduce((sum, [, photo]) => sum + photo.bytes, 0) };
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
