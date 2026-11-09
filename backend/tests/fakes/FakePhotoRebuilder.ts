import { AppError } from "../../src/services/errors";
import type { PhotoRebuilder } from "../../src/services/PhotoRebuilder";

// 読めない画像に混ぜる印
const UNREADABLE = Buffer.from("UNREADABLE");

// 作り直しのフェイク。印（unreadable で付ける）のあるバイトは読めない画像。それ以外は size バイトの「作り直した」中身を返す
export class FakePhotoRebuilder implements PhotoRebuilder {
  readonly #size: number;

  constructor(size = 100) {
    this.#size = size;
  }

  async rebuild(bytes: Buffer): Promise<Buffer> {
    if (bytes.includes(UNREADABLE)) throw new AppError("VALIDATION_ERROR", "写真を画像として読めない");
    return Buffer.alloc(this.#size, 1);
  }

  // 先頭は header のまま（形式の判定は通る）で、作り直せない画像
  unreadable(header: Buffer): Buffer {
    return Buffer.concat([header, UNREADABLE]);
  }
}
