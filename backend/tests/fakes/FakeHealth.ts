import type { HealthStore } from "../../src/repositories/HealthRepository";
import type { DbHealth, HealthChecker } from "../../src/services/HealthService";

// thrown を渡すと ping がそれを投げる（Error 以外の値も試せる）
export class FakeHealthStore implements HealthStore {
  readonly #thrown: unknown;

  constructor(thrown: unknown = undefined) {
    this.#thrown = thrown;
  }

  async ping(): Promise<void> {
    if (this.#thrown !== undefined) throw this.#thrown;
  }
}

export class FakeHealthChecker implements HealthChecker {
  readonly #result: DbHealth;

  constructor(result: DbHealth) {
    this.#result = result;
  }

  async checkDb(): Promise<DbHealth> {
    return this.#result;
  }
}
