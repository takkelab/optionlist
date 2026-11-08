import type { Database } from "../infra/PgDatabase";

export type FoundUser = { userId: number; lastSeenAt: Date };

export type CreatedUser = { status: "ok"; userId: number } | { status: "rate_limited"; retryAfterSeconds: number };

// 鍵から人を探す・アカウントを作る（data.md §4 の認証の関数）
export interface AccountStore {
  findBySession(sessionHash: Buffer): Promise<FoundUser | null>;
  create(sessionHash: Buffer, ipHash: Buffer): Promise<CreatedUser>;
}

type FindRow = { user_id: number; last_seen_at: Date };
type CreateRow = { status: string; user_id: number | null; retry_after_seconds: number | null };

// 認証の関数だけを呼ぶ（RLS の中では、まだ誰か分からないので鍵から人を探せない）。
// 利用者の表を直接読み書きしないので、生の Database を使ってよい（architecture.md §2 の L13 の許可リスト）
export class AccountRepository implements AccountStore {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  async findBySession(sessionHash: Buffer): Promise<FoundUser | null> {
    const [row] = (await this.#db.query("SELECT user_id, last_seen_at FROM auth_find_user($1)", [sessionHash])) as FindRow[];
    return row === undefined ? null : { userId: row.user_id, lastSeenAt: row.last_seen_at };
  }

  async create(sessionHash: Buffer, ipHash: Buffer): Promise<CreatedUser> {
    const [row] = (await this.#db.query("SELECT status, user_id, retry_after_seconds FROM auth_create_user($1, $2)", [
      sessionHash,
      ipHash,
    ])) as CreateRow[];
    if (row !== undefined && row.status === "ok" && row.user_id !== null) return { status: "ok", userId: row.user_id };
    if (row !== undefined && row.status === "rate_limited") return { status: "rate_limited", retryAfterSeconds: row.retry_after_seconds ?? 1 };
    throw new Error(`auth_create_user が想定外の結果を返した: ${JSON.stringify(row)}`);
  }
}
