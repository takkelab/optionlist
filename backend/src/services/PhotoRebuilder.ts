import sharp from "sharp";

export interface PhotoRebuilder {
  // 作り直した JPEG。画像として読めなければ null
  rebuild(bytes: Buffer): Promise<Buffer | null>;
}

const LONG_SIDE = 1280;
const QUALITY = 80;
// 解凍すると巨大になる画像（解凍爆弾）を読まない（docs/decisions/0051）
const MAX_INPUT_PIXELS = 50_000_000;

// 受け取った写真を sharp で作り直す（api.md §5、docs/decisions/0037）。向きを直してから長辺 1280px まで縮め、JPEG 品質 80 にする
// sharp は withMetadata を呼ばなければ EXIF（撮った場所など）・ICC などのメタデータを付けない
// maxInputPixels はテストで小さくして、上限を超える画像を読まないことを確かめる
// failOn は error にする（途中で切れた JPEG のような警告だけのものは読む。スマホの写真を必要以上に断らない）
export class SharpPhotoRebuilder implements PhotoRebuilder {
  readonly #maxInputPixels: number;

  constructor(maxInputPixels = MAX_INPUT_PIXELS) {
    this.#maxInputPixels = maxInputPixels;
  }

  async rebuild(bytes: Buffer): Promise<Buffer | null> {
    try {
      const image = sharp(bytes, { failOn: "error", limitInputPixels: this.#maxInputPixels });
      const rotated = image.rotate();
      const resized = rotated.resize({ width: LONG_SIDE, height: LONG_SIDE, fit: "inside", withoutEnlargement: true });
      const encoded = resized.jpeg({ quality: QUALITY });
      return await encoded.toBuffer();
    } catch {
      return null;
    }
  }
}
