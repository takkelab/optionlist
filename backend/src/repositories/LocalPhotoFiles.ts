import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
      throw error;
    }
  }

  async remove(filename: string): Promise<void> {
    await rm(join(this.#directory, filename), { force: true });
  }
}
