import type { ErrorRequestHandler, RequestHandler } from "express";

export interface Middleware {
  handler(): RequestHandler;
}

export interface ErrorMiddleware {
  handler(): ErrorRequestHandler;
}

// ログの種類（docs/decisions/0042）。Cloud Logging のログベースの指標とアラートは kind で拾う
export type LogKind =
  | "unhandled_error"
  | "orphan_file_error"
  | "account_cleanup_error"
  | "db_pool_error"
  | "server_started"
  | "server_start_failed"
  | "cleanup_result"
  | "cleanup_failed";

// 1 行に出すもの。ここにないキーは出さない（Cookie・復旧コード・タイトル・写真の名前をうっかり載せないため）
export type LogEntry = {
  kind: LogKind;
  message: string;
  error?: unknown;
  route?: string;
  status?: number;
  durationMs?: number;
  // 削除のジョブが消した件数（種類ごと。data.md §5）。件数だけで、ID・ファイル名は入れない
  counts?: Record<string, number>;
};

// アプリのログの出し先（architecture.md §4.3）。server.ts は infra/JsonLogger、テストは FakeLogger か console を渡す
export interface Logger {
  error(entry: LogEntry): void;
  info(entry: LogEntry): void;
}
