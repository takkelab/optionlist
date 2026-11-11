import type { Readable } from "node:stream";
import type { BackupFiles } from "../../src/repositories/GcsBackupFiles";

// メモリ上の書き出しの置き場所。中身を最後まで読めたものだけを置く（壊れたら置かずにエラー）
export class FakeBackupFiles implements BackupFiles {
  readonly #files = new Map<string, Buffer>();

  async write(name: string, data: Readable): Promise<number> {
    const chunks: Buffer[] = [];
    for await (const chunk of data) chunks.push(Buffer.from(chunk as Buffer));
    const bytes = Buffer.concat(chunks);
    this.#files.set(name, bytes);
    return bytes.length;
  }

  names(): string[] {
    return [...this.#files.keys()];
  }

  read(name: string): string | null {
    return this.#files.get(name)?.toString() ?? null;
  }
}
