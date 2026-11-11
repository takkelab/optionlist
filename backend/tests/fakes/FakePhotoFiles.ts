import type { PhotoFiles } from "../../src/repositories/PhotoFiles";
import type { Clock } from "../../src/services/Clock";

// メモリ上の写真の置き場所。failRemoving で削除を失敗させる
// 置いた時刻は、渡した時計（なければ今）で覚える（削除のジョブのテストが時計を進める）
export class FakePhotoFiles implements PhotoFiles {
  readonly #files = new Map<string, { bytes: Buffer; savedAt: Date }>();
  readonly #clock: Clock | null;
  #nextId = 1;
  #removeFails = false;

  constructor(clock: Clock | null = null) {
    this.#clock = clock;
  }

  async save(bytes: Buffer): Promise<string> {
    const filename = `photo-${this.#nextId++}.jpg`;
    this.#files.set(filename, { bytes, savedAt: this.#clock?.now() ?? new Date() });
    return filename;
  }

  async read(filename: string): Promise<Buffer | null> {
    const file = this.#files.get(filename);
    return file === undefined ? null : file.bytes;
  }

  async remove(filename: string): Promise<void> {
    if (this.#removeFails) throw new Error("消せなかった");
    this.#files.delete(filename);
  }

  async listOlderThan(cutoff: Date): Promise<string[]> {
    return [...this.#files].filter(([, file]) => file.savedAt < cutoff).map(([filename]) => filename);
  }

  failRemoving(): void {
    this.#removeFails = true;
  }

  // 今あるファイルの名前
  names(): string[] {
    return [...this.#files.keys()];
  }
}
