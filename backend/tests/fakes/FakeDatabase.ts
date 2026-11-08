import type { Database, Queryable, UserScopedDatabase, UserScopes } from "../../src/infra/PgDatabase";

// error を渡すと、すべての query がそのエラーで失敗する。forUser の run も同じ口で流す
export class FakeDatabase implements Database, UserScopes {
  readonly #error: Error | null;
  readonly #queries: string[] = [];

  constructor(error: Error | null = null) {
    this.#error = error;
  }

  async query(sql: string): Promise<unknown> {
    this.#queries.push(sql);
    if (this.#error !== null) throw this.#error;
    return [];
  }

  forUser(_userId: number | null): UserScopedDatabase {
    return new FakeTransaction(this);
  }

  queries(): string[] {
    return this.#queries;
  }
}

class FakeTransaction implements UserScopedDatabase {
  readonly #db: Queryable;

  constructor(db: Queryable) {
    this.#db = db;
  }

  run<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
    return fn(this.#db);
  }
}
