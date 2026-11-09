import type { ErrorRequestHandler, Response } from "express";
import type { ApiError } from "../../../shared/types";
import type { ErrorMetrics } from "../metrics/AppMetrics";
import { AppError } from "../services/errors";
import type { ErrorMiddleware, Logger } from "./Middleware";

// 共通のエラーハンドラ（api.md §1・§3）。応答は必ず { error: { code, message } } の形にする
// - AppError: その code と status
// - express.json などが投げる 4xx（JSON の解析失敗、大きすぎる本文）: 400 VALIDATION_ERROR
// - それ以外: ログに出し、unhandled_errors_total を増やして 500 INTERNAL_ERROR（中身は応答に出さない）
export class ErrorHandler implements ErrorMiddleware {
  readonly #metrics: ErrorMetrics;
  readonly #logger: Logger;

  constructor(metrics: ErrorMetrics, logger: Logger) {
    this.#metrics = metrics;
    this.#logger = logger;
  }

  handler(): ErrorRequestHandler {
    return (error: unknown, _req, res, _next) => this.#handle(error, res);
  }

  #handle(error: unknown, res: Response): void {
    if (error instanceof AppError) {
      const retryAfter = error.retryAfterSeconds();
      if (retryAfter !== null) res.setHeader("Retry-After", String(retryAfter));
      res.status(error.status()).json({ ...error.extra(), ...this.#body(error.code(), error.message) });
      return;
    }
    if (this.#isClientError(error)) {
      res.status(400).json(this.#body("VALIDATION_ERROR", "リクエストの本文を読めない"));
      return;
    }
    this.#logger.error("想定外のエラー", error);
    this.#metrics.countUnhandledError();
    res.status(500).json(this.#body("INTERNAL_ERROR", "サーバーで想定外のエラーが起きた"));
  }

  // body-parser（express.json）のエラーは status に 4xx を持つ（413 なども api.md §3 に合わせて 400 で返す）
  #isClientError(error: unknown): boolean {
    if (typeof error !== "object" || error === null || !("status" in error)) return false;
    const { status } = error;
    return typeof status === "number" && status >= 400 && status < 500;
  }

  #body(code: ApiError["error"]["code"], message: string): ApiError {
    return { error: { code, message } };
  }
}
