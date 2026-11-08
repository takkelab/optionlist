import type { AccountStarter, Session, SessionResolver, StartedAccount } from "../../src/services/AccountService";
import { AppError } from "../../src/services/errors";

// アカウントの作成とセッションの解決のフェイク。鍵 → 人の対応を持つ
export class FakeAccounts implements AccountStarter, SessionResolver {
  readonly #sessions = new Map<string, Session>();
  readonly #started: string[] = [];
  #nextId = 1;
  #rateLimited = false;

  async start(ip: string): Promise<StartedAccount> {
    if (this.#rateLimited) throw new AppError("TOO_MANY_REQUESTS", "多すぎる", 60);
    this.#started.push(ip);
    const userId = this.#nextId++;
    const sessionKey = `key-${userId}`;
    this.#sessions.set(sessionKey, { userId, refresh: false });
    return { userId, sessionKey };
  }

  async resolve(sessionKey: string | null): Promise<Session> {
    return (sessionKey === null ? undefined : this.#sessions.get(sessionKey)) ?? { userId: null, refresh: false };
  }

  // その鍵を、決まった人・refresh の値で解決させる
  give(sessionKey: string, session: Session): void {
    this.#sessions.set(sessionKey, session);
  }

  // start を回数の制限で失敗させる
  rateLimit(): void {
    this.#rateLimited = true;
  }

  // start に渡された IP（呼ばれた順）
  startedFrom(): string[] {
    return [...this.#started];
  }
}
