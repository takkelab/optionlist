import { Transform } from "node:stream";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Bucket } from "@google-cloud/storage";

export interface BackupFiles {
  // name に data を書き、書いたバイト数を返す。data が壊れたら（pg_dump の失敗）ファイルを確定せずにエラーにする
  write(name: string, data: Readable): Promise<number>;
}

// 週 1 の書き出しを Cloud Storage の入れ物（BACKUP_BUCKET。optionlist-backups）に置く（data.md §6）
// サービスアカウントは objectCreator だけなので、同じ名前があれば上書きしない（ifGenerationMatch: 0）。
// 1 回の要求で送る（resumable にしない。セッションの情報を手元のフォルダに書かない）。途中で壊れたら要求ごと止まり、ファイルはできない
export class GcsBackupFiles implements BackupFiles {
  readonly #bucket: Bucket;

  constructor(bucket: Bucket) {
    this.#bucket = bucket;
  }

  async write(name: string, data: Readable): Promise<number> {
    let bytes = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        callback(null, chunk);
      },
    });
    const file = this.#bucket.file(name);
    const target = file.createWriteStream({ resumable: false, contentType: "application/octet-stream", preconditionOpts: { ifGenerationMatch: 0 } });
    await pipeline(data, counter, target);
    return bytes;
  }
}
