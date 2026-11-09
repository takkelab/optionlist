import type { PhotoRebuilder } from "../../src/services/PhotoRebuilder";

// 読めない画像に混ぜる印
const UNREADABLE = Buffer.from("UNREADABLE");

// 作り直しのフェイク。印（unreadable で付ける）のあるバイトは読めない画像。それ以外は size バイトの「作り直した」中身を返す
export class FakePhotoRebuilder implements PhotoRebuilder {
  readonly #size: number;

  constructor(size = 100) {
    this.#size = size;
  }

  async rebuild(bytes: Buffer): Promise<Buffer | null> {
    if (bytes.includes(UNREADABLE)) return null;
    return Buffer.alloc(this.#size, 1);
  }

  // 先頭は header のまま（形式の判定は通る）で、作り直せない画像
  unreadable(header: Buffer): Buffer {
    return Buffer.concat([header, UNREADABLE]);
  }
}
