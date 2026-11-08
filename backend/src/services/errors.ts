import type { ApiError } from "../../../shared/types";

export type ErrorCode = Exclude<ApiError["error"]["code"], "INTERNAL_ERROR">;

const STATUS: Record<ErrorCode, number> = { VALIDATION_ERROR: 400, NOT_FOUND: 404, CONFLICT: 409, TOO_MANY_REQUESTS: 429 };

// 想定内のエラー（api.md §3）。controllers・services が投げ、共通のエラーハンドラ（middleware/ErrorHandler）が
// code に対応する status で応答する。どの層からも読むので services に置く（docs/decisions/0007）
// 継承は Error だけなので（L9）、種類ごとのサブクラスは作らず code で区別する
// retryAfterSeconds は TOO_MANY_REQUESTS のときの Retry-After（秒）
export class AppError extends Error {
  readonly #code: ErrorCode;
  readonly #retryAfterSeconds: number | null;

  constructor(code: ErrorCode, message: string, retryAfterSeconds: number | null = null) {
    super(message);
    this.#code = code;
    this.#retryAfterSeconds = retryAfterSeconds;
  }

  status(): number {
    return STATUS[this.#code];
  }

  code(): ErrorCode {
    return this.#code;
  }

  retryAfterSeconds(): number | null {
    return this.#retryAfterSeconds;
  }
}
