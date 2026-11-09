import type { Achievement } from "../../../shared/types";
import type { PhotoFiles } from "../repositories/PhotoFiles";
import type { AchievementStores, StoredAchievement, StoredPhoto } from "../repositories/AchievementRepository";
import { AppError } from "./errors";
import type { PhotoRemover } from "./PhotoCleanup";
import type { PhotoExtension, PhotoFormatDetector } from "./PhotoFormat";
import type { PhotoRebuilder } from "./PhotoRebuilder";

// 配信する写真の中身と形式
export type ServedPhoto = { bytes: Buffer; contentType: string };

export interface AchievementPhotoUseCases {
  // すでに写真があれば置き換える
  set(userId: number | null, achievementId: number, bytes: Buffer): Promise<Achievement>;
  // 写真がなければ何もしない
  remove(userId: number | null, achievementId: number): Promise<void>;
  // その人の達成の写真のときだけ中身を返す。他人の・ないものは null（名前がランダムなことには頼らない。api.md §5）
  open(userId: number | null, filename: string): Promise<ServedPhoto | null>;
}

// 1 人あたりの写真の上限（data.md §3 ※仮決め。docs/decisions/0037）。大きさは作り直した後のバイト数
export type PhotoQuota = { maxCount: number; maxBytes: number };

export const DEFAULT_PHOTO_QUOTA: PhotoQuota = { maxCount: 2_000, maxBytes: 1024 * 1024 * 1024 };

export type PhotoServiceDeps = {
  stores: AchievementStores;
  files: PhotoFiles;
  cleanup: PhotoRemover;
  format: PhotoFormatDetector;
  rebuilder: PhotoRebuilder;
  quota: PhotoQuota;
};

// 置き換えたあとの達成と、置き換える前の写真の名前
type Replaced = { achievement: Achievement; previous: string | null };

// 拡張子から配信の Content-Type を決める（今保存するのは JPEG だけ。前に保存した PNG・WebP も配れるようにしておく）
const CONTENT_TYPES: Record<PhotoExtension, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

// 達成に付ける写真（api.md §5）。1 回の達成に 1 枚
export class AchievementPhotoService implements AchievementPhotoUseCases {
  readonly #stores: AchievementStores;
  readonly #files: PhotoFiles;
  readonly #cleanup: PhotoRemover;
  readonly #format: PhotoFormatDetector;
  readonly #rebuilder: PhotoRebuilder;
  readonly #quota: PhotoQuota;

  constructor(deps: PhotoServiceDeps) {
    this.#stores = deps.stores;
    this.#files = deps.files;
    this.#cleanup = deps.cleanup;
    this.#format = deps.format;
    this.#rebuilder = deps.rebuilder;
    this.#quota = deps.quota;
  }

  // 形式（400）→ 達成（404）→ 作り直し（400）→ 上限（429）→ 新しいファイルを書く → 行を更新 → 古いファイルを消す
  // 途中で失敗しても、行が指すファイルが必ず残る順番にする。ファイルを書いている間はトランザクションを開けたままにしない
  async set(userId: number | null, achievementId: number, bytes: Buffer): Promise<Achievement> {
    if (this.#format.extension(bytes) === null) throw new AppError("VALIDATION_ERROR", "写真は JPEG・PNG・WebP のどれか");
    const usage = await this.#stores.withUser(userId, async (store) => {
      await this.#found(store.find(achievementId), achievementId);
      return store.photoUsage(achievementId);
    });
    const rebuilt = await this.#rebuilder.rebuild(bytes);
    if (usage.count + 1 > this.#quota.maxCount || usage.bytes + rebuilt.length > this.#quota.maxBytes) {
      throw new AppError("PHOTO_LIMIT_REACHED", "写真はこれ以上保存できない");
    }
    const filename = await this.#files.save(rebuilt);
    const saved = await this.#point(userId, achievementId, { filename, bytes: rebuilt.length });
    if (saved === null) {
      // 別の端末で項目ごと消された。行がないので、書いたファイルを指すものもない
      await this.#cleanup.remove([filename]);
      throw this.#notFound(achievementId);
    }
    // 古いファイルは、行を押さえて置き換えたときに読んだ名前（同時に置き換えても、どれかが消し損ねることはない）
    await this.#cleanup.remove(saved.previous === null ? [] : [saved.previous]);
    return saved.achievement;
  }

  async remove(userId: number | null, achievementId: number): Promise<void> {
    const change = await this.#stores.withUser(userId, (store) => store.setPhoto(achievementId, null));
    if (change === null) throw this.#notFound(achievementId);
    if (change.previous !== null) await this.#cleanup.remove([change.previous]);
  }

  async open(userId: number | null, filename: string): Promise<ServedPhoto | null> {
    const extension = this.#extensionOf(filename);
    if (userId === null || extension === null) return null;
    const owns = await this.#stores.withUser(userId, (store) => store.ownsPhoto(filename));
    if (!owns) return null;
    // 行はあるのにファイルがない（消し損ねの逆。data.md §6）も null
    const bytes = await this.#files.read(filename);
    return bytes === null ? null : { bytes, contentType: CONTENT_TYPES[extension] };
  }

  // 行を新しいファイルに向ける。行を更新できなければ、書いたファイルを消す
  async #point(userId: number | null, achievementId: number, photo: StoredPhoto): Promise<Replaced | null> {
    try {
      return await this.#stores.withUser(userId, async (store) => {
        const change = await store.setPhoto(achievementId, photo);
        const found = change === null ? null : await store.find(achievementId);
        return change === null || found === null ? null : { achievement: found.achievement, previous: change.previous };
      });
    } catch (error) {
      await this.#cleanup.remove([photo.filename]);
      throw error;
    }
  }

  #extensionOf(filename: string): PhotoExtension | null {
    const extension = filename.slice(filename.lastIndexOf(".") + 1);
    return extension === "jpg" || extension === "png" || extension === "webp" ? extension : null;
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
