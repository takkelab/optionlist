import type { Pool, PoolClient } from "pg";
import type { QueryMetrics } from "../metrics/AppMetrics";

// SQL を流す口。値は必ず params（$1 などのプレースホルダ）で渡す。返すのは行の配列
export interface Queryable {
  query(sql: string, params?: unknown[]): Promise<unknown>;
}

// 生のプール。利用者の表に触らないクラス（architecture.md §2 の L13 の許可リスト）だけが使う
export type Database = Queryable;

// 1 人分のトランザクション。利用者のデータに触る SQL は必ず run の中で流す（data.md §4）
export interface UserScopedDatabase {
  run<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
}

// UserScopedDatabase を作る唯一の口。userId が null（アカウントがない人）なら app.user_id を設定せず、RLS で 0 行になる
export interface UserScopes {
  forUser(userId: number | null): UserScopedDatabase;
}

// pg のプールで SQL を実行し、1 本ごとの実行時間を db_query_duration_seconds に記録する
export class PgDatabase implements Database, UserScopes {
  readonly #pool: Pool;
  readonly #metrics: QueryMetrics;

  constructor(pool: Pool, metrics: QueryMetrics) {
    this.#pool = pool;
    this.#metrics = metrics;
  }

  query(sql: string, params: unknown[] = []): Promise<unknown> {
    return new TimedQueries(this.#pool, this.#metrics).query(sql, params);
  }

  forUser(userId: number | null): UserScopedDatabase {
    return new PgUserTransaction(this.#pool, this.#metrics, userId);
  }
}

type QueryTarget = Pick<Pool | PoolClient, "query">;

// 1 本ごとの実行時間を測って流す
class TimedQueries implements Queryable {
  readonly #target: QueryTarget;
  readonly #metrics: QueryMetrics;

  constructor(target: QueryTarget, metrics: QueryMetrics) {
    this.#target = target;
    this.#metrics = metrics;
  }

  async query(sql: string, params: unknown[] = []): Promise<unknown> {
    const started = performance.now();
    try {
      const { rows } = await this.#target.query(sql, params);
      return rows;
    } finally {
      this.#metrics.observeQuery((performance.now() - started) / 1000);
    }
  }
}

// BEGIN → set_config('app.user_id', …, true)（SET LOCAL と同じ）→ fn → COMMIT。失敗したら ROLLBACK
// SET LOCAL なので、接続をプールに返したあとに前の人の値は残らない（data.md §4）。BEGIN・COMMIT・set_config は測らない（metrics.md §4）
class PgUserTransaction implements UserScopedDatabase {
  readonly #pool: Pool;
  readonly #metrics: QueryMetrics;
  readonly #userId: number | null;

  constructor(pool: Pool, metrics: QueryMetrics, userId: number | null) {
    this.#pool = pool;
    this.#metrics = metrics;
    this.#userId = userId;
  }

  async run<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
    const client = await this.#pool.connect();
    // ROLLBACK もできなかった接続（切れたなど）は、そのエラーを release に渡してプールに戻さずに捨てる
    let rollbackError: Error | undefined;
    try {
      await client.query("BEGIN");
      if (this.#userId !== null) await client.query("SELECT set_config('app.user_id', $1, true)", [String(this.#userId)]);
      const result = await fn(new TimedQueries(client, this.#metrics));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      rollbackError = await client.query("ROLLBACK").then(
        () => undefined,
        (failure: Error) => failure,
      );
      throw error;
    } finally {
      client.release(rollbackError);
    }
  }
}
