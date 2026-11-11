import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { PhotoFiles } from "./PhotoFiles";

// 写真をフォルダ（UPLOAD_DIR）に置く（手元と CI。api.md §5）
export class LocalPhotoFiles implements PhotoFiles {
  readonly #directory: string;

  constructor(directory: string) {
    this.#directory = resolve(directory);
  }

  async save(bytes: Buffer): Promise<string> {
    await mkdir(this.#directory, { recursive: true });
    const filename = `${randomUUID()}.jpg`;
    await writeFile(join(this.#directory, filename), bytes, { flag: "wx" });
    return filename;
  }

  async read(filename: string): Promise<Buffer | null> {
    try {
      return await readFile(join(this.#directory, filename));
    } catch (error) {
      if (this.#isMissing(error)) return null;
      throw error;
    }
  }

  async remove(filename: string): Promise<void> {
    await rm(join(this.#directory, filename), { force: true });
  }

  // 置いた時刻は更新日時（mtime）で見る（ファイルは書いたあと書き換えない）。フォルダがまだなければ空
  async listOlderThan(cutoff: Date): Promise<string[]> {
    let entries: string[];
    try {
      entries = await readdir(this.#directory);
    } catch (error) {
      if (this.#isMissing(error)) return [];
      throw error;
    }
    const old: string[] = [];
    for (const filename of entries) {
      if (await this.#isOlderFile(filename, cutoff)) old.push(filename);
    }
    return old;
  }

  // 並べてから調べるまでに消えたファイルは数えない
  async #isOlderFile(filename: string, cutoff: Date): Promise<boolean> {
    try {
      const info = await stat(join(this.#directory, filename));
      return info.isFile() && info.mtime < cutoff;
    } catch (error) {
      if (this.#isMissing(error)) return false;
      throw error;
    }
  }

  #isMissing(error: unknown): boolean {
    return error instanceof Error && "code" in error && error.code === "ENOENT";
  }
}
