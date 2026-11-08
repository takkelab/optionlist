import type { Achievement } from "../../../shared/types";
import type { PhotoFiles } from "../repositories/LocalPhotoFiles";
import type { AchievementStore } from "../repositories/AchievementRepository";
import { AppError } from "./errors";
import type { PhotoRemover } from "./PhotoCleanup";
import type { PhotoFormatDetector } from "./PhotoFormat";

export interface AchievementPhotoUseCases {
  // すでに写真があれば置き換える
  set(achievementId: number, bytes: Buffer): Promise<Achievement>;
  // 写真がなければ何もしない
  remove(achievementId: number): Promise<void>;
}

// 達成に付ける写真（api.md §5）。1 回の達成に 1 枚
export class AchievementPhotoService implements AchievementPhotoUseCases {
  readonly #store: AchievementStore;
  readonly #files: PhotoFiles;
  readonly #cleanup: PhotoRemover;
  readonly #format: PhotoFormatDetector;

  constructor(store: AchievementStore, files: PhotoFiles, cleanup: PhotoRemover, format: PhotoFormatDetector) {
    this.#store = store;
    this.#files = files;
    this.#cleanup = cleanup;
    this.#format = format;
  }

  // 新しいファイルを書く → 行を更新 → 古いファイルを消す。途中で失敗しても、行が指すファイルが必ず残る順番にする
  async set(achievementId: number, bytes: Buffer): Promise<Achievement> {
    const extension = this.#format.extension(bytes);
    if (extension === null) throw new AppError("VALIDATION_ERROR", "写真は JPEG・PNG・WebP のどれか");
    const previous = await this.#found(achievementId);
    const filename = await this.#files.save(bytes, extension);
    try {
      await this.#store.setPhoto(achievementId, filename);
    } catch (error) {
      await this.#cleanup.remove([filename]);
      throw error;
    }
    await this.#cleanup.remove(previous === null ? [] : [previous]);
    const saved = await this.#store.find(achievementId);
    if (saved !== null) return saved.achievement;
    // 別の端末で項目ごと消された。行がないので、書いたファイルを指すものもない
    await this.#cleanup.remove([filename]);
    throw this.#notFound(achievementId);
  }

  async remove(achievementId: number): Promise<void> {
    const previous = await this.#found(achievementId);
    if (previous === null) return;
    await this.#store.setPhoto(achievementId, null);
    await this.#cleanup.remove([previous]);
  }

  // 今の写真のファイル名。達成がなければ 404
  async #found(achievementId: number): Promise<string | null> {
    const found = await this.#store.find(achievementId);
    if (found === null) throw this.#notFound(achievementId);
    return found.photoFilename;
  }

  #notFound(achievementId: number): AppError {
    return new AppError("NOT_FOUND", `達成 ${achievementId} が見つからない`);
  }
}
