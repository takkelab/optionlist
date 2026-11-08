import { createHash, randomBytes } from "node:crypto";
import type { Pool } from "pg";

// テストの人。cookie はそのまま Cookie ヘッダーに入れる値（"ol_session=…"。手元・テストの名前。api.md §6）
export type TestUser = { id: number; cookie: string };

export interface UserFactory {
  // 鍵が分かっている人を作る。lastSeenAt を渡さなければ今（その日のうちは last_seen_at を書かない）
  create(lastSeenAt?: Date): Promise<TestUser>;
}

// テストの前提の人を DB に直接作る（ol_migrator の接続で。RLS の USING (true) のポリシーで全員の行を書ける。testing.md §0）
export class TestUsers implements UserFactory {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async create(lastSeenAt: Date = new Date()): Promise<TestUser> {
    const key = randomBytes(32).toString("base64url");
    const hash = createHash("sha256");
    hash.update(key);
    const { rows } = await this.#pool.query<{ id: number }>(
      "INSERT INTO users (session_hash, created_at, last_seen_at) VALUES ($1, $2, $2) RETURNING id",
      [hash.digest(), lastSeenAt],
    );
    const [row] = rows;
    if (row === undefined) throw new Error("users に入らなかった");
    return { id: row.id, cookie: `ol_session=${key}` };
  }
}
