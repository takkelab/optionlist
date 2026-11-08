import type { ErrorRequestHandler, RequestHandler } from "express";

export interface Middleware {
  handler(): RequestHandler;
}

export interface ErrorMiddleware {
  handler(): ErrorRequestHandler;
}

// 想定外のエラーの出力先（server.ts では console を渡す）
export interface Logger {
  error(message: string, error: unknown): void;
}
