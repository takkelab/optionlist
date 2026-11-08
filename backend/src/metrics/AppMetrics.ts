// metrics.md §5 の実行時メトリクス。使う側は必要な面だけをインタフェースで受け取る（実装は PromMetrics）

export type RequestLabels = { method: string; route: string; status: string };

export interface OrphanFileMetrics {
  countOrphanFileError(): void;
}

export interface RequestMetrics {
  observeRequest(labels: RequestLabels, seconds: number): void;
}

export interface ErrorMetrics {
  countUnhandledError(): void;
}

export interface QueryMetrics {
  observeQuery(seconds: number): void;
}

// /api/metrics で返す Prometheus のテキスト
export interface MetricsExporter {
  contentType(): string;
  render(): Promise<string>;
}
