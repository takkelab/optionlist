import type { Pool } from "pg";
import type { QueryMetrics } from "../metrics/AppMetrics";

// repositories が SQL を流すための口。値は必ず params（$1 などのプレースホルダ）で渡す。返すのは行の配列
export interface Database {
  query(sql: string, params?: unknown[]): Promise<unknown>;
}

// pg のプールで SQL を実行し、1 本ごとの実行時間を db_query_duration_seconds に記録する
export class PgDatabase implements Database {
  readonly #pool: Pool;
  readonly #metrics: QueryMetrics;

  constructor(pool: Pool, metrics: QueryMetrics) {
    this.#pool = pool;
    this.#metrics = metrics;
  }

  async query(sql: string, params: unknown[] = []): Promise<unknown> {
    const started = performance.now();
    try {
      const { rows } = await this.#pool.query(sql, params);
      return rows;
    } finally {
      this.#metrics.observeQuery((performance.now() - started) / 1000);
    }
  }
}
