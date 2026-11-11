import { randomUUID } from "node:crypto";
import type { Bucket } from "@google-cloud/storage";
import type { PhotoFiles } from "./PhotoFiles";

const NOT_FOUND = 404;

// 写真を Cloud Storage の非公開の入れ物（PHOTO_BUCKET）に置く（確認用・本番。api.md §5、docs/decisions/0037）
// 配信は backend が持ち主を確かめてから中身を返すので、入れ物は公開しない（署名 URL も使わない）
export class GcsPhotoFiles implements PhotoFiles {
  readonly #bucket: Bucket;

  constructor(bucket: Bucket) {
    this.#bucket = bucket;
  }

  async save(bytes: Buffer): Promise<string> {
    const filename = `${randomUUID()}.jpg`;
    const file = this.#bucket.file(filename);
    // 小さいので 1 回の要求で送る（resumable にしない）。同じ名前があれば上書きしない（ifGenerationMatch: 0）
    await file.save(bytes, { resumable: false, contentType: "image/jpeg", preconditionOpts: { ifGenerationMatch: 0 } });
    return filename;
  }

  async read(filename: string): Promise<Buffer | null> {
    const file = this.#bucket.file(filename);
    try {
      const [contents] = await file.download();
      return contents;
    } catch (error) {
      if (this.#isNotFound(error)) return null;
      throw error;
    }
  }

  async remove(filename: string): Promise<void> {
    const file = this.#bucket.file(filename);
    await file.delete({ ignoreNotFound: true });
  }

  // 置いた時刻は入れ物の timeCreated で見る（getFiles はページをまたいで全部読む）
  async listOlderThan(cutoff: Date): Promise<string[]> {
    const [files] = await this.#bucket.getFiles();
    return files
      .filter(({ metadata }) => {
        const created = metadata.timeCreated;
        return created !== undefined && new Date(created) < cutoff;
      })
      .map((file) => file.name);
  }

  #isNotFound(error: unknown): boolean {
    return error instanceof Error && "code" in error && error.code === NOT_FOUND;
  }
}
