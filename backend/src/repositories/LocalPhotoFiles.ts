import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export type PhotoExtension = "jpg" | "png" | "webp";

export interface PhotoFiles {
  // サーバーで決めた名前で保存し、その名前を返す
  save(bytes: Buffer, extension: PhotoExtension): Promise<string>;
  // すでにないファイルは失敗にしない
  remove(filename: string): Promise<void>;
  // 配信するフォルダ
  directory(): string;
}

// 写真をフォルダ（UPLOAD_DIR）に置く。名前はサーバーで決める（パストラバーサル対策。api.md §5）
export class LocalPhotoFiles implements PhotoFiles {
  readonly #directory: string;

  constructor(directory: string) {
    this.#directory = resolve(directory);
  }

  async save(bytes: Buffer, extension: PhotoExtension): Promise<string> {
    await mkdir(this.#directory, { recursive: true });
    const filename = `${randomUUID()}.${extension}`;
    await writeFile(join(this.#directory, filename), bytes);
    return filename;
  }

  async remove(filename: string): Promise<void> {
    await rm(join(this.#directory, filename), { force: true });
  }

  directory(): string {
    return this.#directory;
  }
}
