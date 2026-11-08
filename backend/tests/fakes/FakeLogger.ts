import type { Logger } from "../../src/middleware/Middleware";

// 想定外のエラーのログを console に出さずに覚えておく
export class FakeLogger implements Logger {
  readonly #errors: unknown[] = [];

  error(_message: string, error: unknown): void {
    this.#errors.push(error);
  }

  errors(): unknown[] {
    return this.#errors;
  }
}
