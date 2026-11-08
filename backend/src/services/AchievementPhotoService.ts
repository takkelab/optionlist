import type { Achievement } from "../../../shared/types";
import type { PhotoFiles } from "../repositories/LocalPhotoFiles";
import type { AchievementStores, StoredAchievement } from "../repositories/AchievementRepository";
import { AppError } from "./errors";
import type { PhotoRemover } from "./PhotoCleanup";
import type { PhotoFormatDetector } from "./PhotoFormat";

export interface AchievementPhotoUseCases {
  // すでに写真があれば置き換える
  set(userId: number | null, achievementId: number, bytes: Buffer): Promise<Achievement>;
  // 写真がなければ何もしない
  remove(userId: number | null, achievementId: number): Promise<void>;
  // 配信してよいか。その人の達成の写真のときだけ true（名前がランダムなことには頼らない。api.md §5）
  canServe(userId: number | null, filename: string): Promise<boolean>;
}

// 達成に付ける写真（api.md §5）。1 回の達成に 1 枚
export class AchievementPhotoService implements AchievementPhotoUseCases {
  readonly #stores: AchievementStores;
  readonly #files: PhotoFiles;
  readonly #cleanup: PhotoRemover;
  readonly #format: PhotoFormatDetector;

  constructor(stores: AchievementStores, files: PhotoFiles, cleanup: PhotoRemover, format: PhotoFormatDetector) {
    this.#stores = stores;
    this.#files = files;
    this.#cleanup = cleanup;
    this.#format = format;
  }

  // 新しいファイルを書く → 行を更新 → 古いファイルを消す。途中で失敗しても、行が指すファイルが必ず残る順番にする
  // ファイルを書いている間はトランザクションを開けたままにしない（行の読み書きは短いトランザクションに分ける）
  async set(userId: number | null, achievementId: number, bytes: Buffer): Promise<Achievement> {
    const extension = this.#format.extension(bytes);
    if (extension === null) throw new AppError("VALIDATION_ERROR", "写真は JPEG・PNG・WebP のどれか");
    const previous = await this.#photoOf(userId, achievementId);
    const filename = await this.#files.save(bytes, extension);
    let saved: StoredAchievement | null;
    try {
      saved = await this.#stores.withUser(userId, async (store) => {
        await store.setPhoto(achievementId, filename);
        return store.find(achievementId);
      });
    } catch (error) {
      await this.#cleanup.remove([filename]);
      throw error;
    }
    await this.#cleanup.remove(previous === null ? [] : [previous]);
    if (saved !== null) return saved.achievement;
    // 別の端末で項目ごと消された。行がないので、書いたファイルを指すものもない
    await this.#cleanup.remove([filename]);
    throw this.#notFound(achievementId);
  }

  async remove(userId: number | null, achievementId: number): Promise<void> {
    const previous = await this.#stores.withUser(userId, async (store) => {
      const found = await this.#found(store.find(achievementId), achievementId);
      if (found !== null) await store.setPhoto(achievementId, null);
      return found;
    });
    if (previous !== null) await this.#cleanup.remove([previous]);
  }

  canServe(userId: number | null, filename: string): Promise<boolean> {
    if (userId === null) return Promise.resolve(false);
    return this.#stores.withUser(userId, (store) => store.ownsPhoto(filename));
  }

  // 今の写真のファイル名。達成がなければ 404
  #photoOf(userId: number | null, achievementId: number): Promise<string | null> {
    return this.#stores.withUser(userId, (store) => this.#found(store.find(achievementId), achievementId));
  }

  async #found(pending: Promise<StoredAchievement | null>, achievementId: number): Promise<string | null> {
    const found = await pending;
    if (found === null) throw this.#notFound(achievementId);
    return found.photoFilename;
  }

  #notFound(achievementId: number): AppError {
    return new AppError("NOT_FOUND", `達成 ${achievementId} が見つからない`);
  }
}
