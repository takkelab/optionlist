import { Storage } from "@google-cloud/storage";
import { PgDatabase } from "../infra/PgDatabase";
import { PgPoolFactory } from "../infra/PgPoolFactory";
import type { Logger } from "../middleware/Middleware";
import { PromMetrics } from "../metrics/PromMetrics";
import { GcsPhotoFiles } from "../repositories/GcsPhotoFiles";
import { LocalPhotoFiles } from "../repositories/LocalPhotoFiles";
import type { PhotoFiles } from "../repositories/PhotoFiles";
import { SystemClock } from "../services/Clock";
import { PhotoCleanup } from "../services/PhotoCleanup";
import { CleanupJob } from "./CleanupJob";
import { CleanupRepository } from "./CleanupRepository";

export interface CleanupProcess {
  // 終了コードを返す（0: 成功、1: 失敗）
  run(): Promise<number>;
}

// 削除のジョブを組み立てて流す（data.md §5）。エントリーポイント（cleanup.ts）はこれを呼んで終了コードで終わるだけ
// 組み立ての失敗（接続先がないなど）も含めて、失敗はすべて cleanup_failed に出して 1 を返す
// 写真の置き場所は server.ts と同じ（PHOTO_BUCKET があれば Cloud Storage、なければ UPLOAD_DIR）。ただし APP_ENV が
// staging・production で PHOTO_BUCKET がなければ止める（手元のフォルダを見て、入れ物の写真を残したまま成功に見えないように。docs/decisions/0059）
// メトリクスは /api/metrics がないので読まれない（PromMetrics はメモリに数えるだけ）
export class CleanupEntry implements CleanupProcess {
  readonly #env: NodeJS.ProcessEnv;
  readonly #logger: Logger;

  constructor(env: NodeJS.ProcessEnv, logger: Logger) {
    this.#env = env;
    this.#logger = logger;
  }

  async run(): Promise<number> {
    // 終わったら閉じる（pg は infra/ の外で import しない。L13）
    let pool: { end(): Promise<void> } | null = null;
    try {
      const files = this.#photoFiles();
      const created = new PgPoolFactory(this.#env, this.#logger, "CLEANUP_DATABASE_URL").create();
      pool = created;
      const metrics = new PromMetrics();
      await new CleanupJob({
        store: new CleanupRepository(new PgDatabase(created, metrics)),
        files,
        photos: new PhotoCleanup(files, metrics, this.#logger),
        clock: new SystemClock(),
        log: this.#logger,
      }).run();
      return 0;
    } catch (error) {
      this.#logger.error({ kind: "cleanup_failed", message: "削除のジョブが失敗した", error });
      return 1;
    } finally {
      await pool?.end();
    }
  }

  #photoFiles(): PhotoFiles {
    const bucket = this.#env.PHOTO_BUCKET ?? "";
    const appEnv = this.#env.APP_ENV ?? "";
    if (bucket === "" && (appEnv === "staging" || appEnv === "production")) {
      throw new Error(`APP_ENV=${appEnv} では PHOTO_BUCKET が必要です`);
    }
    if (bucket === "") return new LocalPhotoFiles(this.#env.UPLOAD_DIR ?? "uploads");
    // 手元で GCS_EMULATOR_URL があれば fake-gcs-server へつなぐ（server.ts と同じ。docs/decisions/0051）
    const emulator = this.#env.GCS_EMULATOR_URL ?? "";
    const storage = new Storage(emulator === "" ? {} : { apiEndpoint: emulator, projectId: "optionlist-local" });
    return new GcsPhotoFiles(storage.bucket(bucket));
  }
}
