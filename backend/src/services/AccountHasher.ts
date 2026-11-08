import { createHash, createHmac } from "node:crypto";

// DB に渡すのは、鍵と復旧コードの SHA-256 と、IP を IP_HASH_SECRET で HMAC したものだけ（data.md §2、api.md §6）
export interface Hasher {
  sha256(value: string): Buffer;
  ip(ip: string): Buffer;
}

export class AccountHasher implements Hasher {
  readonly #ipHashSecret: string;

  constructor(ipHashSecret: string) {
    if (ipHashSecret === "") throw new Error("IP_HASH_SECRET が未設定です。backend/.env.example を参考に設定してください");
    this.#ipHashSecret = ipHashSecret;
  }

  sha256(value: string): Buffer {
    const hash = createHash("sha256");
    hash.update(value);
    return hash.digest();
  }

  ip(ip: string): Buffer {
    const hmac = createHmac("sha256", this.#ipHashSecret);
    hmac.update(ip);
    return hmac.digest();
  }
}
