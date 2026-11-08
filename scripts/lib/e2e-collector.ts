import type { CollectedMetrics, MetricCollector } from "./static-analysis-collector.ts";
import type { CommandRunner, FileSource, Measurement } from "./types.ts";

export interface E2eCollectorDeps {
  runner: CommandRunner;
  files: FileSource;
  log: (message: string) => void;
}

// e2e/playwright.config.ts の JSON レポーターと、e2e/ui-metrics.spec.ts が書き出す
export const E2E_REPORT = "e2e/results/report.json";
export const E2E_UI_METRICS = "e2e/results/ui-metrics.json";

type PlaywrightStats = { duration: number; unexpected: number; flaky: number };
// LCP は画面（パス）ごとの秒数、タップ領域は 44×44px 未満だった要素
export type UiMetrics = {
  lcpSec: Record<string, number>;
  smallTapTargets: { screen: string; element: string; width: number; height: number }[];
};

// E2E テスト（testing.md §5）。metrics.md §2 の E2E の時間と不安定なテスト、§3 の LCP とタップ領域を出す
// Playwright は retries: 0 で流すので、失敗したテストはすべて「リトライなしで通らなかった」に数える
// コマンドが失敗したときは、前回のレポートが残っていても見逃さないよう、失敗を最低 1 件にする
export class E2eCollector implements MetricCollector {
  readonly #deps: E2eCollectorDeps;

  constructor(deps: E2eCollectorDeps) {
    this.#deps = deps;
  }

  collect(): CollectedMetrics {
    const command = "npm run -s test:e2e";
    this.#deps.log(`▶ E2E テスト: ${command}`);
    const result = this.#deps.runner.run(command);
    const ok = result.exitCode === 0;
    if (!ok) this.#deps.log(result.output);
    const checks = [{ name: "E2E テスト", ok, durationSec: result.durationSec }];
    const measurements = [...this.#fromReport(ok, result.durationSec), ...this.#fromUiMetrics(ok)];
    return { checks, measurements, findings: [] };
  }

  #fromReport(ok: boolean, commandSec: number): Measurement[] {
    if (!this.#deps.files.exists(E2E_REPORT)) {
      const detail = "レポート（JSON）が出ていない";
      return [
        { id: "e2e-test-duration", kind: "value", value: commandSec, detail: "コマンド全体の時間" },
        { id: "flaky-tests", kind: "missing", detail },
      ];
    }
    const { stats } = JSON.parse(this.#deps.files.read(E2E_REPORT)) as { stats: PlaywrightStats };
    const failed = stats.unexpected + stats.flaky;
    return [
      { id: "e2e-test-duration", kind: "value", value: Math.round(stats.duration / 100) / 10 },
      { id: "flaky-tests", kind: "value", value: ok ? failed : Math.max(failed, 1) },
    ];
  }

  #fromUiMetrics(ok: boolean): Measurement[] {
    if (!ok) return this.#missing("E2E テストが失敗した");
    if (!this.#deps.files.exists(E2E_UI_METRICS)) return this.#missing("計測結果（JSON）が出ていない");
    const metrics = JSON.parse(this.#deps.files.read(E2E_UI_METRICS)) as UiMetrics;
    const screens = Object.entries(metrics.lcpSec);
    if (screens.length === 0) return this.#missing("LCP を測った画面がない");
    const [slowest, lcp] = screens.reduce((max, entry) => (entry[1] > max[1] ? entry : max));
    const small = metrics.smallTapTargets.map((t) => `${t.screen} ${t.element} ${t.width}×${t.height}`);
    return [
      { id: "lcp", kind: "value", value: lcp, detail: `最も遅い画面: ${slowest}` },
      { id: "tap-target-violations", kind: "value", value: small.length, detail: small.join(", ") || undefined },
    ];
  }

  #missing(detail: string): Measurement[] {
    return [
      { id: "lcp", kind: "missing", detail },
      { id: "tap-target-violations", kind: "missing", detail },
    ];
  }
}
