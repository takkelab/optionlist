import type { MetricsJudge } from "./metrics-judge.ts";
import type { CollectedMetrics, MetricCollector } from "./static-analysis-collector.ts";
import type { CheckResult, CommandRunner, FileSource, Measurement } from "./types.ts";

export interface PerfCollectorDeps {
  runner: CommandRunner;
  files: FileSource;
  judge: MetricsJudge;
  // 目標を割ったときに測り直す回数（metrics.config.json の perf.retriesOnFail）
  retries: number;
  log: (message: string) => void;
}

// backend の npm run test:perf（tests/perf/）が書き出す
export const PERF_RESULTS = "backend/coverage/perf/results.json";
// 性能テストが出す指標（metrics.md §4）
export const PERF_METRIC_IDS = [
  "read-api-p95",
  "write-api-p95",
  "image-upload-p95",
  "sql-p95",
  "sql-per-request",
  "full-table-scans",
  "heap-growth",
  "rss-max",
];

type Attempt = { ok: boolean; measurements: Measurement[]; failed: string[] };

// 性能の統合テスト（testing.md §3）。CI のランナーは性能がぶれるので、目標を割った指標があれば
// retries 回まで測り直す（metrics.md §4）。指標ごとに、どれかの回で目標を満たせばその値、
// すべての回で割ったら最後の値を返す（「2 回とも割ったら失敗」）
// テストのコマンド自体が失敗したときは、ぶれではないので測り直さない
export class PerfCollector implements MetricCollector {
  readonly #deps: PerfCollectorDeps;
  readonly #checks: CheckResult[] = [];

  constructor(deps: PerfCollectorDeps) {
    this.#deps = deps;
  }

  collect(): CollectedMetrics {
    const attempts = [this.#measure(1)];
    for (let i = 1; i <= this.#deps.retries; i++) {
      const last = attempts[attempts.length - 1];
      if (last === undefined || !last.ok || last.failed.length === 0) break;
      this.#deps.log(`目標を割った指標があるので測り直す: ${last.failed.join(", ")}`);
      attempts.push(this.#measure(i + 1));
    }
    const measurements = PERF_METRIC_IDS.map((id) => {
      const attempt = attempts.find((a) => !a.failed.includes(id)) ?? attempts[attempts.length - 1];
      return attempt?.measurements.find((m) => m.id === id) ?? { id, kind: "missing" as const, detail: "計測していない" };
    });
    return { checks: this.#checks, measurements, findings: [] };
  }

  #measure(round: number): Attempt {
    const command = "npm --prefix backend run -s test:perf";
    this.#deps.log(`▶ 性能テスト（${round} 回目）: ${command}`);
    const result = this.#deps.runner.run(command);
    const ok = result.exitCode === 0;
    if (!ok) this.#deps.log(result.output);
    this.#checks.push({ name: `性能テスト（${round} 回目）`, ok, durationSec: result.durationSec });
    // 失敗したときは前回の結果ファイルが残っていても使わない
    const measurements = ok ? this.#read() : this.#missing("性能テストが失敗した");
    const failed = this.#deps.judge
      .judge(measurements)
      .filter((r) => r.outcome === "fail" && PERF_METRIC_IDS.includes(r.definition.id))
      .map((r) => r.definition.id);
    return { ok, measurements, failed };
  }

  #read(): Measurement[] {
    if (!this.#deps.files.exists(PERF_RESULTS)) return this.#missing("結果（JSON）が出ていない");
    const { measurements } = JSON.parse(this.#deps.files.read(PERF_RESULTS)) as {
      measurements: { id: string; value: number; detail?: string }[];
    };
    return PERF_METRIC_IDS.map((id): Measurement => {
      const found = measurements.find((m) => m.id === id);
      if (found === undefined) return { id, kind: "missing", detail: "性能テストが値を出していない" };
      return { id, kind: "value", value: found.value, detail: found.detail };
    });
  }

  #missing(detail: string): Measurement[] {
    return PERF_METRIC_IDS.map((id) => ({ id, kind: "missing", detail }));
  }
}
