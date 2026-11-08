import type { ApiError } from "../../../shared/types";

export type ErrorCode = Exclude<ApiError["error"]["code"], "INTERNAL_ERROR">;

const STATUS: Record<ErrorCode, number> = { VALIDATION_ERROR: 400, NOT_FOUND: 404, CONFLICT: 409 };

// 想定内のエラー（api.md §3）。controllers・services が投げ、共通のエラーハンドラ（middleware/ErrorHandler）が
// code に対応する status で応答する。どの層からも読むので services に置く（docs/decisions/0007）
// 継承は Error だけなので（L9）、種類ごとのサブクラスは作らず code で区別する
export class AppError extends Error {
  readonly #code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.#code = code;
  }

  status(): number {
    return STATUS[this.#code];
  }

  code(): ErrorCode {
    return this.#code;
  }
}
