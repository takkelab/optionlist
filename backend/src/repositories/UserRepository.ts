import type { UserScopes } from "../infra/PgDatabase";

// その人の users の行（自分の行だけ）
export interface UserStore {
  // 最後に使った日時を書く（1 日 1 回。api.md §6）
  touch(userId: number, now: Date): Promise<void>;
}

export class UserRepository implements UserStore {
  readonly #db: UserScopes;

  constructor(db: UserScopes) {
    this.#db = db;
  }

  async touch(userId: number, now: Date): Promise<void> {
    const scoped = this.#db.forUser(userId);
    await scoped.run((tx) => tx.query("UPDATE users SET last_seen_at = $2 WHERE id = $1", [userId, now]));
  }
}
