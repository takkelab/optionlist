import type { PhotoFiles } from "../repositories/PhotoFiles";
import type { OrphanFileMetrics } from "../metrics/AppMetrics";

export interface PhotoRemover {
  // 消せたファイルの数を返す（削除のジョブが件数をログに出す。data.md §5）
  remove(filenames: string[]): Promise<number>;
}

// 削除の失敗の出力先（server.ts では JsonLogger を渡す）。ファイル名・ID は message に入れない（docs/decisions/0042）
export type FailureEntry = { kind: "orphan_file_error" | "account_cleanup_error"; message: string; error: unknown };

export interface FailureLog {
  error(entry: FailureEntry): void;
}

// 行を消したあとのファイルの片付け（api.md §5）。行はもう消えているので、失敗しても API は成功のままにし、
// ログとメトリクス（orphan_file_errors_total）に残す
export class PhotoCleanup implements PhotoRemover {
  readonly #files: PhotoFiles;
  readonly #metrics: OrphanFileMetrics;
  readonly #log: FailureLog;

  constructor(files: PhotoFiles, metrics: OrphanFileMetrics, log: FailureLog) {
    this.#files = files;
    this.#metrics = metrics;
    this.#log = log;
  }

  async remove(filenames: string[]): Promise<number> {
    let removed = 0;
    for (const filename of filenames) {
      try {
        await this.#files.remove(filename);
        removed += 1;
      } catch (error) {
        this.#log.error({ kind: "orphan_file_error", message: "写真のファイルを消せなかった", error });
        this.#metrics.countOrphanFileError();
      }
    }
    return removed;
  }
}
