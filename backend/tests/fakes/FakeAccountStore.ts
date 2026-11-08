import type { AccountStore, CreatedUser, FoundUser, RestoreAttempt, RestoreResult } from "../../src/repositories/AccountRepository";
import type { UserRow, UserStore } from "../../src/repositories/UserRepository";
import type { SessionKeySource } from "../../src/services/AccountService";

// restore に渡された値（ハッシュは 16 進の文字列）
export type RecordedRestore = { codeHash: string; newSessionHash: string; ipHash: string; currentUserId: number | null; replace: boolean };

// メモリ上の認証の関数（auth_find_user・auth_create_user・auth_restore）と users の行。鍵のハッシュは 16 進の文字列で持つ
export class FakeAccountStore implements AccountStore, UserStore {
  readonly #users = new Map<string, FoundUser>();
  readonly #ipHashes: string[] = [];
  readonly #touched: { userId: number; at: string }[] = [];
  readonly #rows = new Map<number, UserRow>();
  readonly #codes = new Map<number, string>();
  readonly #photos = new Map<number, string[]>();
  readonly #removed: number[] = [];
  readonly #restores: RecordedRestore[] = [];
  #restoreResult: RestoreResult = { status: "not_found" };
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

  async restore(attempt: RestoreAttempt): Promise<RestoreResult> {
    const { codeHash, newSessionHash, ipHash, currentUserId, replace } = attempt;
    this.#restores.push({ codeHash: codeHash.toString("hex"), newSessionHash: newSessionHash.toString("hex"), ipHash: ipHash.toString("hex"), currentUserId, replace });
    return this.#restoreResult;
  }

  async touch(userId: number, now: Date): Promise<void> {
    this.#touched.push({ userId, at: now.toISOString() });
  }

  async find(userId: number): Promise<UserRow | null> {
    return this.#rows.get(userId) ?? null;
  }

  async setRecoveryCode(userId: number, codeHash: Buffer): Promise<boolean> {
    const row = this.#rows.get(userId);
    if (row === undefined) return false;
    this.#rows.set(userId, { ...row, hasRecoveryCode: true });
    this.#codes.set(userId, codeHash.toString("hex"));
    return true;
  }

  async remove(userId: number): Promise<string[]> {
    this.#removed.push(userId);
    this.#rows.delete(userId);
    return this.#photos.get(userId) ?? [];
  }

  // 鍵のハッシュ（16 進）の人を置く
  give(sessionHashHex: string, user: FoundUser): void {
    this.#users.set(sessionHashHex, user);
  }

  // users の行と、その人の写真のファイル名を置く
  giveRow(userId: number, row: UserRow, photos: string[] = []): void {
    this.#rows.set(userId, row);
    this.#photos.set(userId, photos);
  }

  // restore が返す結果を決める
  answerRestore(result: RestoreResult): void {
    this.#restoreResult = result;
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

  // setRecoveryCode で入れたハッシュ（16 進）
  codeOf(userId: number): string | undefined {
    return this.#codes.get(userId);
  }

  removed(): number[] {
    return [...this.#removed];
  }

  restores(): RecordedRestore[] {
    return [...this.#restores];
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
