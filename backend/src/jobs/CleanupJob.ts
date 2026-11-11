import type { Logger } from "../middleware/Middleware";
import type { Clock } from "../services/Clock";
import type { PhotoRemover } from "../services/PhotoCleanup";

const DAY_MS = 24 * 60 * 60 * 1000;

export type ExpiredAccounts = { inactive: number; empty: number; photoFilenames: string[] };

// 削除のジョブの DB の側（実装は CleanupRepository）
export interface CleanupStore {
  // 5 年使っていない人と、項目も達成もなく 30 日使っていない人を消し、その人たちの写真の名前を返す
  deleteExpiredAccounts(now: Date): Promise<ExpiredAccounts>;
  deleteOldEvents(now: Date): Promise<number>;
  deleteOldAuthAttempts(now: Date): Promise<number>;
  // 渡した名前のうち、achievements の行が指しているもの
  referencedPhotos(filenames: string[]): Promise<string[]>;
}

// 写真の置き場所のうち、ジョブが使う面（PhotoFiles が満たす）
export interface OldPhotoList {
  listOlderThan(cutoff: Date): Promise<string[]>;
}

export type CleanupCounts = {
  inactiveAccounts: number;
  emptyAccounts: number;
  accountPhotos: number;
  events: number;
  authAttempts: number;
  orphanPhotos: number;
};

export type CleanupDeps = { store: CleanupStore; files: OldPhotoList; photos: PhotoRemover; clock: Clock; log: Logger };

export interface CleanupRunner {
  run(): Promise<CleanupCounts>;
}

// 保存期間を過ぎたものを消す（data.md §5。Cloud Scheduler が毎日 4 時〈日本時間〉に Cloud Run Job で動かす）
// 時刻はジョブの開始時に 1 回だけ読み、すべての境目に使う。消した件数は種類ごとに cleanup_result に出す（ID・ファイル名は出さない）
// ファイルを消せなくても失敗にしない（orphan_file_error を出し、次の日の「行のない写真」で拾い直す）。DB のエラーはそのまま投げる
export class CleanupJob implements CleanupRunner {
  readonly #deps: CleanupDeps;

  constructor(deps: CleanupDeps) {
    this.#deps = deps;
  }

  async run(): Promise<CleanupCounts> {
    const { store, files, photos, clock, log } = this.#deps;
    const now = clock.now();
    // 行を消してから、その人たちの写真のファイルを消す（data.md §5）
    const accounts = await store.deleteExpiredAccounts(now);
    const accountPhotos = await photos.remove(accounts.photoFilenames);
    const events = await store.deleteOldEvents(now);
    const authAttempts = await store.deleteOldAuthAttempts(now);
    // 置いてから 1 日たった、どの行からも指されていないファイル（保存の途中で落ちたもの、前の日に消せなかったものなど）
    // 上で消そうとした名前は除く（消せなかったものは次の日に拾う。同じ実行で 2 回試して orphan_file_error を 2 回出さない）
    const tried = new Set(accounts.photoFilenames);
    const old = (await files.listOlderThan(new Date(now.getTime() - DAY_MS))).filter((filename) => !tried.has(filename));
    const referenced = new Set(await store.referencedPhotos(old));
    const orphanPhotos = await photos.remove(old.filter((filename) => !referenced.has(filename)));
    const counts: CleanupCounts = {
      inactiveAccounts: accounts.inactive,
      emptyAccounts: accounts.empty,
      accountPhotos,
      events,
      authAttempts,
      orphanPhotos,
    };
    log.info({ kind: "cleanup_result", message: "保存期間を過ぎたものを消した", counts });
    return counts;
  }
}
