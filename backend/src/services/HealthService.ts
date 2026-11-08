import type { HealthStore } from "../repositories/HealthRepository";

export type DbHealth = { status: "ok" } | { status: "error"; message: string };

export interface HealthChecker {
  checkDb(): Promise<DbHealth>;
}

// 疎通確認。DB に届かないことは想定内の結果なので、例外ではなく値で返す
export class HealthService implements HealthChecker {
  readonly #store: HealthStore;

  constructor(store: HealthStore) {
    this.#store = store;
  }

  async checkDb(): Promise<DbHealth> {
    try {
      await this.#store.ping();
      return { status: "ok" };
    } catch (error) {
      return { status: "error", message: error instanceof Error ? error.message : String(error) };
    }
  }
}
