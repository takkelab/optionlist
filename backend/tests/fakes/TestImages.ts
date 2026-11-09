import { randomBytes } from "node:crypto";
import sharp from "sharp";
import type { Sharp } from "sharp";

export interface TestImageSource {
  jpeg(width?: number, height?: number): Promise<Buffer>;
  png(width: number, height: number): Promise<Buffer>;
  jpegWithLocation(): Promise<Buffer>;
  rotatedJpeg(): Promise<Buffer>;
  noiseJpeg(bytes: number): Promise<Buffer>;
}

// 撮った場所（東京駅のあたり）。EXIF の GPS の書き方（度・分・秒の分数）
const LOCATION = { GPSLatitudeRef: "N", GPSLatitude: "35/1 40/1 52/1", GPSLongitudeRef: "E", GPSLongitude: "139/1 46/1 0/1" };
// EXIF の Orientation 6（右に 90 度回して見る）
const ROTATE_RIGHT = 6;

// テストで送る本物の画像（backend は sharp で作り直すので、先頭のバイトだけの偽物は 400 になる。api.md §5）
export class TestImages implements TestImageSource {
  async jpeg(width = 40, height = 30): Promise<Buffer> {
    const image = this.#plain(width, height);
    const encoded = image.jpeg();
    return encoded.toBuffer();
  }

  async png(width: number, height: number): Promise<Buffer> {
    const image = this.#plain(width, height);
    const encoded = image.png();
    return encoded.toBuffer();
  }

  // 位置情報の EXIF が入った JPEG（testing.md §2）
  async jpegWithLocation(): Promise<Buffer> {
    const image = this.#plain(40, 30);
    const tagged = image.withExif({ IFD0: { Make: "TestCamera" }, IFD3: LOCATION });
    const encoded = tagged.jpeg();
    return encoded.toBuffer();
  }

  // 横 40・縦 20 で保存し、Orientation で「右に回して見る」と書いた JPEG（向きを直すと横 20・縦 40）
  async rotatedJpeg(): Promise<Buffer> {
    const image = this.#plain(40, 20);
    const tagged = image.withMetadata({ orientation: ROTATE_RIGHT });
    const encoded = tagged.jpeg();
    return encoded.toBuffer();
  }

  // ノイズの JPEG。だいたい bytes の大きさになるよう、画素の数を決める（品質 95 のノイズは 1 画素 1.4 バイトほど）
  async noiseJpeg(bytes: number): Promise<Buffer> {
    const side = Math.round(Math.sqrt(bytes / 1.4));
    const raw = sharp(randomBytes(side * side * 3), { raw: { width: side, height: side, channels: 3 } });
    const encoded = raw.jpeg({ quality: 95 });
    return encoded.toBuffer();
  }

  #plain(width: number, height: number): Sharp {
    return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 120, b: 40 } } });
  }
}
