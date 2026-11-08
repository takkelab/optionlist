import type { Database } from "../../src/infra/PgDatabase";

// error を渡すと、すべての query がそのエラーで失敗する
export class FakeDatabase implements Database {
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

  queries(): string[] {
    return this.#queries;
  }
}
