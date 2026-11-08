import * as client from "prom-client";
import type { ErrorMetrics, MetricsExporter, OrphanFileMetrics, QueryMetrics, RequestLabels, RequestMetrics } from "./AppMetrics";

// prom-client の定義（metrics.md §5）。グローバルの register は使わず、インスタンスごとに Registry を持つ
// （テストで App を作り直しても、前のテストの値やメトリクス名の重複が残らない）
export class PromMetrics implements RequestMetrics, ErrorMetrics, QueryMetrics, OrphanFileMetrics, MetricsExporter {
  readonly #registry = new client.Registry();
  readonly #requestDuration = new client.Histogram({
    name: "http_request_duration_seconds",
    help: "ルート・ステータス別の応答時間",
    labelNames: ["method", "route", "status"],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
    registers: [this.#registry],
  });
  readonly #requests = new client.Counter({
    name: "http_requests_total",
    help: "ルート・ステータス別のリクエスト数",
    labelNames: ["method", "route", "status"],
    registers: [this.#registry],
  });
  readonly #queryDuration = new client.Histogram({
    name: "db_query_duration_seconds",
    help: "SQL の実行時間",
    buckets: [0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25],
    registers: [this.#registry],
  });
  readonly #unhandledErrors = new client.Counter({
    name: "unhandled_errors_total",
    help: "共通エラーハンドラに届いた想定外のエラー数",
    registers: [this.#registry],
  });

  readonly #orphanFileErrors = new client.Counter({
    name: "orphan_file_errors_total",
    help: "画像ファイルの削除に失敗した数",
    registers: [this.#registry],
  });

  constructor() {
    client.collectDefaultMetrics({ register: this.#registry });
  }

  countOrphanFileError(): void {
    this.#orphanFileErrors.inc();
  }

  observeRequest(labels: RequestLabels, seconds: number): void {
    this.#requestDuration.observe(labels, seconds);
    this.#requests.inc(labels);
  }

  countUnhandledError(): void {
    this.#unhandledErrors.inc();
  }

  observeQuery(seconds: number): void {
    this.#queryDuration.observe(seconds);
  }

  contentType(): string {
    return this.#registry.contentType;
  }

  render(): Promise<string> {
    return this.#registry.metrics();
  }
}
