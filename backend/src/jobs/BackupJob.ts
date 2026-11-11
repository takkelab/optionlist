import type { DumpSource } from "../infra/PgDump";
import type { Logger } from "../middleware/Middleware";
import type { BackupFiles } from "../repositories/GcsBackupFiles";
import type { Clock } from "../services/Clock";

export type BackupDeps = { source: DumpSource; files: BackupFiles; clock: Clock; log: Logger };

export interface BackupRunner {
  // 書いたファイルの名前を返す
  run(): Promise<string>;
}

// 週 1 の書き出し（data.md §6）。<DB の名前>/<UTC の日時>.dump に置き、大きさを backup_result に出す
// 失敗は投げる（BackupEntry が backup_failed に出して終了コード 1 にする）
export class BackupJob implements BackupRunner {
  readonly #deps: BackupDeps;

  constructor(deps: BackupDeps) {
    this.#deps = deps;
  }

  async run(): Promise<string> {
    const { source, files, clock, log } = this.#deps;
    // 2026-11-15T20:00:00.000Z → 2026-11-15T20-00-00Z（ファイル名に : を使わない）
    const now = clock.now();
    const stamp = now.toISOString().replace(/\.\d{3}Z$/, "Z").replaceAll(":", "-");
    const name = `${source.database()}/${stamp}.dump`;
    const bytes = await files.write(name, source.dump());
    if (bytes === 0) throw new Error("書き出しが空だった");
    log.info({ kind: "backup_result", message: `DB を書き出した（${name}）`, counts: { bytes } });
    return name;
  }
}
