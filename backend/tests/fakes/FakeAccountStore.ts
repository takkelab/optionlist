import type { AccountStore, CreatedUser, FoundUser } from "../../src/repositories/AccountRepository";
import type { UserStore } from "../../src/repositories/UserRepository";
import type { SessionKeySource } from "../../src/services/AccountService";

// メモリ上の認証の関数（auth_find_user・auth_create_user）と users の last_seen_at。鍵のハッシュは 16 進の文字列で持つ
export class FakeAccountStore implements AccountStore, UserStore {
  readonly #users = new Map<string, FoundUser>();
  readonly #ipHashes: string[] = [];
  readonly #touched: { userId: number; at: string }[] = [];
  #nextId = 1;
  #rateLimited = false;

  async findBySession(sessionHash: Buffer): Promise<FoundUser | null> {
    return this.#users.get(sessionHash.toString("hex")) ?? null;
  }

  async create(sessionHash: Buffer, ipHash: Buffer): Promise<CreatedUser> {
    this.#ipHashes.push(ipHash.toString("hex"));
    if (this.#rateLimited) return { status: "rate_limited", retryAfterSeconds: 120 };
    const userId = this.#nextId++;
    this.#users.set(sessionHash.toString("hex"), { userId, lastSeenAt: new Date() });
    return { status: "ok", userId };
  }

  async touch(userId: number, now: Date): Promise<void> {
    this.#touched.push({ userId, at: now.toISOString() });
  }

  // 鍵のハッシュ（16 進）の人を置く
  give(sessionHashHex: string, user: FoundUser): void {
    this.#users.set(sessionHashHex, user);
  }

  rateLimit(): void {
    this.#rateLimited = true;
  }

  // create に渡された IP のハッシュ（16 進。呼ばれた順）
  ipHashes(): string[] {
    return [...this.#ipHashes];
  }

  touched(): { userId: number; at: string }[] {
    return [...this.#touched];
  }
}

// 決まった鍵を順に返す
export class FixedSessionKeys implements SessionKeySource {
  readonly #keys: string[];

  constructor(keys: string[]) {
    this.#keys = [...keys];
  }

  next(): string {
    const key = this.#keys.shift();
    if (key === undefined) throw new Error("鍵が足りない");
    return key;
  }
}
