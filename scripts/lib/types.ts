export type Judge = "fail" | "warn" | "observe";

export interface MetricDefinition {
  id: string;
  section: string;
  label: string;
  op: "min" | "max";
  target: number;
  unit: string;
  judge: Judge;
  since: string;
}

export interface MetricsConfig {
  metrics: MetricDefinition[];
  // 性能（metrics.md §4）の目標を割ったときに測り直す回数。テストでは省略してよい
  perf?: { retriesOnFail: number };
}

// notApplicable: 計測対象がまだない（例: tokens.css がない）。合格として扱う
// missing: 計測するはずなのに値が取れなかった（カバレッジやビルド成果物が見つからないなど）。目標を割ったのと同じに扱う
export type Measurement =
  | { id: string; kind: "value"; value: number; detail?: string }
  | { id: string; kind: "notApplicable"; detail: string }
  | { id: string; kind: "missing"; detail: string };

// notMeasured: 計測の仕組みがまだない（since のステップで導入する）
export type Outcome = "pass" | "fail" | "warn" | "observed" | "notApplicable" | "notMeasured";

export interface MetricResult {
  definition: MetricDefinition;
  outcome: Outcome;
  value?: number;
  detail?: string;
}

// テストやビルドなど、通らなければそれだけで失敗にするもの
export interface CheckResult {
  name: string;
  ok: boolean;
  durationSec: number;
}

export interface Finding {
  file: string;
  line: number;
  message: string;
}

export interface FileSource {
  list(dirs: string[], extensions: string[]): string[];
  exists(path: string): boolean;
  read(path: string): string;
}

export interface CommandResult {
  exitCode: number;
  output: string;
  durationSec: number;
}

export interface CommandRunner {
  run(command: string, env?: Record<string, string>): CommandResult;
}
