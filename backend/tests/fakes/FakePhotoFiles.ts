import type { PhotoFiles } from "../../src/repositories/PhotoFiles";

// メモリ上の写真の置き場所。failRemoving で削除を失敗させる
export class FakePhotoFiles implements PhotoFiles {
  readonly #files = new Map<string, Buffer>();
  #nextId = 1;
  #removeFails = false;

  async save(bytes: Buffer): Promise<string> {
    const filename = `photo-${this.#nextId++}.jpg`;
    this.#files.set(filename, bytes);
    return filename;
  }

  async read(filename: string): Promise<Buffer | null> {
    return this.#files.get(filename) ?? null;
  }

  async remove(filename: string): Promise<void> {
    if (this.#removeFails) throw new Error("消せなかった");
    this.#files.delete(filename);
  }

  failRemoving(): void {
    this.#removeFails = true;
  }

  // 今あるファイルの名前
  names(): string[] {
    return [...this.#files.keys()];
  }
}
