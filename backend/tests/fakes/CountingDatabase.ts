import type { Database } from "../../src/infra/MySqlDatabase";

// SQL 文ごとに、最初の params（EXPLAIN 用）と実行時間を残す
export type RecordedQuery = { sql: string; params: unknown[]; durationsMs: number[] };

// 性能テスト用に Database を包み、SQL の本数・1 本ごとの実行時間・流した SQL を記録する（metrics.md §4）
export class CountingDatabase implements Database {
  readonly #inner: Database;
  readonly #statements = new Map<string, RecordedQuery>();
  #count = 0;

  constructor(inner: Database) {
    this.#inner = inner;
  }

  async query(sql: string, params: unknown[] = []): Promise<unknown> {
    this.#count++;
    const recorded = this.#statements.get(sql) ?? { sql, params, durationsMs: [] };
    this.#statements.set(sql, recorded);
    const { durationsMs } = recorded;
    const started = performance.now();
    try {
      return await this.#inner.query(sql, params);
    } finally {
      durationsMs.push(performance.now() - started);
    }
  }

  count(): number {
    return this.#count;
  }

  durationsMs(): number[] {
    return this.statements().flatMap((s) => s.durationsMs);
  }

  statements(): RecordedQuery[] {
    return [...this.#statements.values()];
  }
}
