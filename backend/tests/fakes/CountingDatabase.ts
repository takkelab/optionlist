import type { Database, Queryable, UserScopedDatabase, UserScopes } from "../../src/infra/PgDatabase";

// SQL 文ごとに、最初の params（EXPLAIN 用）と実行時間を残す。userId は、その SQL を流した人（生の query なら null）
export type RecordedQuery = { sql: string; params: unknown[]; userId: number | null; durationsMs: number[] };

type Inner = Database & UserScopes;

// 性能テスト用に Database を包み、SQL の本数・1 本ごとの実行時間・流した SQL を記録する（metrics.md §4）
// forUser の run の中の SQL も数える。BEGIN・COMMIT・set_config は内側（PgDatabase）が流すので数えない
export class CountingDatabase implements Database, UserScopes {
  readonly #inner: Inner;
  readonly #statements = new Map<string, RecordedQuery>();
  #count = 0;

  constructor(inner: Inner) {
    this.#inner = inner;
  }

  query(sql: string, params: unknown[] = []): Promise<unknown> {
    return this.record(this.#inner, null, sql, params);
  }

  forUser(userId: number | null): UserScopedDatabase {
    return new CountingTransaction(this.#inner.forUser(userId), this, userId);
  }

  async record(target: Queryable, userId: number | null, sql: string, params: unknown[]): Promise<unknown> {
    this.#count++;
    const recorded = this.#statements.get(sql) ?? { sql, params, userId, durationsMs: [] };
    this.#statements.set(sql, recorded);
    const { durationsMs } = recorded;
    const started = performance.now();
    try {
      return await target.query(sql, params);
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

class CountingTransaction implements UserScopedDatabase {
  readonly #inner: UserScopedDatabase;
  readonly #counter: CountingDatabase;
  readonly #userId: number | null;

  constructor(inner: UserScopedDatabase, counter: CountingDatabase, userId: number | null) {
    this.#inner = inner;
    this.#counter = counter;
    this.#userId = userId;
  }

  run<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
    return this.#inner.run((tx) => fn(new CountingQueries(tx, this.#counter, this.#userId)));
  }
}

class CountingQueries implements Queryable {
  readonly #tx: Queryable;
  readonly #counter: CountingDatabase;
  readonly #userId: number | null;

  constructor(tx: Queryable, counter: CountingDatabase, userId: number | null) {
    this.#tx = tx;
    this.#counter = counter;
    this.#userId = userId;
  }

  query(sql: string, params: unknown[] = []): Promise<unknown> {
    return this.#counter.record(this.#tx, this.#userId, sql, params);
  }
}
