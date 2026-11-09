import { randomBytes } from "node:crypto";
import type { AccountStore } from "../repositories/AccountRepository";
import type { UserStore } from "../repositories/UserRepository";
import { AccountHasher } from "./AccountHasher";
import type { Hasher } from "./AccountHasher";
import type { Clock } from "./Clock";
import { AppError } from "./errors";

// Cookie から決めたそのリクエストの人。refresh が true なら Cookie を入れ直す（1 日 1 回。api.md §6）
export type Session = { userId: number | null; refresh: boolean };

// セッションの middleware が読む（architecture.md §3.1 の例外。import type だけ）
export interface SessionResolver {
  resolve(sessionKey: string | null): Promise<Session>;
}

export type StartedAccount = { userId: number; sessionKey: string };

// アカウントを作る（POST /api/options だけ。api.md §6）
export interface AccountStarter {
  start(ip: string): Promise<StartedAccount>;
}

// Cookie に入れる鍵（32 バイトの乱数の base64url）。UT では決まった値を返すフェイクを渡す
export interface SessionKeySource {
  next(): string;
}

export class RandomSessionKeys implements SessionKeySource {
  next(): string {
    return randomBytes(32).toString("base64url");
  }
}

// 32 バイトの base64url（パディングなし）は 43 文字
const SESSION_KEY = /^[A-Za-z0-9_-]{43}$/;
// 「今日」は日本時間の日付で決める（api.md §6）
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

// 匿名アカウント（docs/decisions/0033）。DB には鍵の SHA-256 と、IP を IP_HASH_SECRET で HMAC したものだけを渡す
export class AccountService implements SessionResolver, AccountStarter {
  readonly #accounts: AccountStore;
  readonly #users: UserStore;
  readonly #clock: Clock;
  readonly #keys: SessionKeySource;
  readonly #hasher: Hasher;

  constructor(accounts: AccountStore, users: UserStore, clock: Clock, keys: SessionKeySource, ipHashSecret: string) {
    this.#accounts = accounts;
    this.#users = users;
    this.#clock = clock;
    this.#keys = keys;
    this.#hasher = new AccountHasher(ipHashSecret);
  }

  // 形の違う鍵は DB に問い合わせずに「アカウントがない人」にする
  async resolve(sessionKey: string | null): Promise<Session> {
    if (sessionKey === null || !SESSION_KEY.test(sessionKey)) return { userId: null, refresh: false };
    const found = await this.#accounts.findBySession(this.#hasher.sha256(sessionKey));
    if (found === null) return { userId: null, refresh: false };
    const now = this.#clock.now();
    if (this.#jstDate(found.lastSeenAt) === this.#jstDate(now)) return { userId: found.userId, refresh: false };
    await this.#users.touch(found.userId, now);
    return { userId: found.userId, refresh: true };
  }

  async start(ip: string): Promise<StartedAccount> {
    const sessionKey = this.#keys.next();
    const created = await this.#accounts.create(this.#hasher.sha256(sessionKey), this.#hasher.ip(ip));
    if (created.status === "rate_limited") {
      throw new AppError("TOO_MANY_REQUESTS", "アカウントを作る回数が多すぎる。しばらく待ってからやり直す", created.retryAfterSeconds);
    }
    return { userId: created.userId, sessionKey };
  }

  #jstDate(at: Date): string {
    return new Date(at.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
  }
}
