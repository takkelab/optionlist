import type { Database } from "../infra/PgDatabase";

export interface HealthStore {
  ping(): Promise<void>;
}

// DB に届くかだけを確かめる（SQL は repositories にだけ書く）
export class HealthRepository implements HealthStore {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  async ping(): Promise<void> {
    await this.#db.query("SELECT 1");
  }
}
