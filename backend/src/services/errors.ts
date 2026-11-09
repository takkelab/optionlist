import type { ApiError } from "../../../shared/types";

export type ErrorCode = Exclude<ApiError["error"]["code"], "INTERNAL_ERROR">;

const STATUS: Record<ErrorCode, number> = { VALIDATION_ERROR: 400, FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409, TOO_MANY_REQUESTS: 429 };

// 想定内のエラー（api.md §3）。controllers・services が投げ、共通のエラーハンドラ（middleware/ErrorHandler）が
// code に対応する status で応答する。どの層からも読むので services に置く（docs/decisions/0007）
// 継承は Error だけなので（L9）、種類ごとのサブクラスは作らず code で区別する
// retryAfterSeconds は TOO_MANY_REQUESTS のときの Retry-After（秒）
// extra は応答の本文に error と並べて添える値（復旧コードの 409 の localItemCount。api.md §3）
export class AppError extends Error {
  readonly #code: ErrorCode;
  readonly #retryAfterSeconds: number | null;
  readonly #extra: Record<string, number>;

  constructor(code: ErrorCode, message: string, retryAfterSeconds: number | null = null, extra: Record<string, number> = {}) {
    super(message);
    this.#code = code;
    this.#retryAfterSeconds = retryAfterSeconds;
    this.#extra = { ...extra };
  }

  extra(): Record<string, number> {
    return { ...this.#extra };
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
