import type { PhotoFiles } from "../repositories/LocalPhotoFiles";
import type { OrphanFileMetrics } from "../metrics/AppMetrics";

export interface PhotoRemover {
  remove(filenames: string[]): Promise<void>;
}

// 削除の失敗の出力先（server.ts では console を渡す）
export interface FailureLog {
  error(message: string, error: unknown): void;
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

  async remove(filenames: string[]): Promise<void> {
    for (const filename of filenames) {
      try {
        await this.#files.remove(filename);
      } catch (error) {
        this.#log.error(`写真のファイル ${filename} を消せなかった`, error);
        this.#metrics.countOrphanFileError();
      }
    }
  }
}
