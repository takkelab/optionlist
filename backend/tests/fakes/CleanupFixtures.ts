import type { Pool } from "pg";
import { TestUsers } from "./TestUsers";

export type TableCounts = { users: number; options: number; achievements: number; events: number; authAttempts: number };

export interface CleanupSeeds {
  user(lastSeenAt: Date): Promise<number>;
  option(userId: number): Promise<number>;
  achievement(userId: number, optionId: number, photoFilename: string | null): Promise<void>;
  event(receivedAt: Date): Promise<number>;
  authAttempt(occurredAt: Date): Promise<number>;
  userIds(): Promise<number[]>;
  counts(): Promise<TableCounts>;
}

// 削除のジョブのテストの前提の行を、ol_migrator（DATABASE_URL）で直接作る（testing.md §0）。ジョブ自身は ol_cleanup でつなぐ
export class CleanupFixtures implements CleanupSeeds {
  readonly #pool: Pool;
  readonly #users: TestUsers;

  constructor(pool: Pool) {
    this.#pool = pool;
    this.#users = new TestUsers(pool);
  }

  async user(lastSeenAt: Date): Promise<number> {
    const { id } = await this.#users.create(lastSeenAt);
    return id;
  }

  async option(userId: number): Promise<number> {
    const { rows } = await this.#pool.query<{ id: number }>(
      "INSERT INTO options (title, sort_order, created_at, updated_at, user_id) VALUES ('項目', 1000, now(), now(), $1) RETURNING id",
      [userId],
    );
    return this.#id(rows);
  }

  async achievement(userId: number, optionId: number, photoFilename: string | null): Promise<void> {
    await this.#pool.query(
      "INSERT INTO achievements (option_id, user_id, achieved_at, photo_filename, photo_bytes) VALUES ($1, $2, now(), $3, $4)",
      [optionId, userId, photoFilename, photoFilename === null ? null : 10],
    );
  }

  async event(receivedAt: Date): Promise<number> {
    const { rows } = await this.#pool.query<{ id: number }>(
      "INSERT INTO events (type, payload, occurred_at, received_at) VALUES ('client_error', '{}', $1, $1) RETURNING id",
      [receivedAt],
    );
    return this.#id(rows);
  }

  async authAttempt(occurredAt: Date): Promise<number> {
    const { rows } = await this.#pool.query<{ id: number }>(
      "INSERT INTO auth_attempts (kind, ip_hash, occurred_at) VALUES ('create_account', $2, $1) RETURNING id",
      [occurredAt, Buffer.alloc(32)],
    );
    return this.#id(rows);
  }

  async userIds(): Promise<number[]> {
    const { rows } = await this.#pool.query<{ id: number }>("SELECT id FROM users ORDER BY id");
    return rows.map((row) => row.id);
  }

  async counts(): Promise<TableCounts> {
    const { rows } = await this.#pool.query<TableCounts>(
      `SELECT (SELECT count(*) FROM users)::int AS users, (SELECT count(*) FROM options)::int AS options,
              (SELECT count(*) FROM achievements)::int AS achievements, (SELECT count(*) FROM events)::int AS events,
              (SELECT count(*) FROM auth_attempts)::int AS "authAttempts"`,
    );
    const [row] = rows;
    if (row === undefined) throw new Error("件数が返らなかった");
    return row;
  }

  #id(rows: { id: number }[]): number {
    const [row] = rows;
    if (row === undefined) throw new Error("行が入らなかった");
    return row.id;
  }
}
