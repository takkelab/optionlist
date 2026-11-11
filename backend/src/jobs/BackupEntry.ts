import { Storage } from "@google-cloud/storage";
import { PgConnectionParser, PgDump } from "../infra/PgDump";
import type { DumpProgram } from "../infra/PgDump";
import type { Logger } from "../middleware/Middleware";
import { GcsBackupFiles } from "../repositories/GcsBackupFiles";
import type { BackupFiles } from "../repositories/GcsBackupFiles";
import { SystemClock } from "../services/Clock";
import { BackupJob } from "./BackupJob";
import type { CleanupProcess } from "./CleanupEntry";

// 書き込み先と pg_dump の起動の方法を差し替えられる（テストはフェイクの入れ物と node を渡す）
export type BackupOverrides = { files?: BackupFiles; program?: DumpProgram };

// 週 1 の書き出しを組み立てて流す（data.md §6）。エントリーポイント（backup.ts）はこれを呼んで終了コードで終わるだけ
// DATABASE_URL（ol_migrator。確認用・本番は ol_migrator_production）と BACKUP_BUCKET が要る。
// 組み立ての失敗も含めて、失敗はすべて backup_failed に出して 1 を返す（R10c のアラートが見る。metrics.md §8）
export class BackupEntry implements CleanupProcess {
  readonly #env: NodeJS.ProcessEnv;
  readonly #logger: Logger;
  readonly #overrides: BackupOverrides;

  constructor(env: NodeJS.ProcessEnv, logger: Logger, overrides: BackupOverrides = {}) {
    this.#env = env;
    this.#logger = logger;
    this.#overrides = overrides;
  }

  async run(): Promise<number> {
    try {
      const url = this.#env.DATABASE_URL ?? "";
      if (url === "") throw new Error("DATABASE_URL が必要です");
      const connection = new PgConnectionParser().parse(url);
      await new BackupJob({
        source: new PgDump(connection, this.#overrides.program, this.#env),
        files: this.#overrides.files ?? this.#gcs(),
        clock: new SystemClock(),
        log: this.#logger,
      }).run();
      return 0;
    } catch (error) {
      this.#logger.error({ kind: "backup_failed", message: "DB の書き出しが失敗した", error });
      return 1;
    }
  }

  #gcs(): BackupFiles {
    const bucket = this.#env.BACKUP_BUCKET ?? "";
    if (bucket === "") throw new Error("BACKUP_BUCKET が必要です");
    return new GcsBackupFiles(new Storage().bucket(bucket));
  }
}
