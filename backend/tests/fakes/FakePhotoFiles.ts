import type { PhotoExtension, PhotoFiles } from "../../src/repositories/LocalPhotoFiles";

// メモリ上の写真の置き場所。failRemoving で削除を失敗させる
export class FakePhotoFiles implements PhotoFiles {
  readonly #names = new Set<string>();
  #nextId = 1;
  #removeFails = false;

  async save(_bytes: Buffer, extension: PhotoExtension): Promise<string> {
    const filename = `photo-${this.#nextId++}.${extension}`;
    this.#names.add(filename);
    return filename;
  }

  async remove(filename: string): Promise<void> {
    if (this.#removeFails) throw new Error("消せなかった");
    this.#names.delete(filename);
  }

  directory(): string {
    return "fake-photos-that-do-not-exist";
  }

  failRemoving(): void {
    this.#removeFails = true;
  }

  // 今あるファイルの名前
  names(): string[] {
    return [...this.#names];
  }
}
