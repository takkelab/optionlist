// 受け取る形式（api.md §5）。保存するのは作り直した JPEG だけ
export type PhotoExtension = "jpg" | "png" | "webp";

export interface PhotoFormatDetector {
  // JPEG / PNG / WebP でなければ null
  extension(bytes: Buffer): PhotoExtension | null;
}

const JPEG = Buffer.from([0xff, 0xd8, 0xff]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const RIFF = Buffer.from("RIFF", "ascii");
const WEBP = Buffer.from("WEBP", "ascii");
const WEBP_MARK_AT = 8;

// 形式は申告（Content-Type・拡張子）を信じず、ファイルの先頭のバイトで判定する（api.md §5）
export class PhotoFormat implements PhotoFormatDetector {
  extension(bytes: Buffer): PhotoExtension | null {
    if (this.#hasAt(bytes, JPEG, 0)) return "jpg";
    if (this.#hasAt(bytes, PNG, 0)) return "png";
    if (this.#hasAt(bytes, RIFF, 0) && this.#hasAt(bytes, WEBP, WEBP_MARK_AT)) return "webp";
    return null;
  }

  #hasAt(bytes: Buffer, mark: Buffer, at: number): boolean {
    const part = bytes.subarray(at, at + mark.length);
    return part.equals(mark);
  }
}
