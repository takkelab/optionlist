import type { BundleSizeMeasurer } from "./bundle-size-measurer.ts";
import type { CoverageReader } from "./coverage-reader.ts";
import type { CollectedMetrics, MetricCollector } from "./static-analysis-collector.ts";
import type { CheckResult, CommandRunner, FileSource, Measurement } from "./types.ts";

export interface CommandCollectorDeps {
  runner: CommandRunner;
  files: FileSource;
  coverage: CoverageReader;
  bundle: BundleSizeMeasurer;
  log: (message: string) => void;
}

interface UnitCoverageScope {
  name: string;
  command: string;
  sourceDirs: string[];
  summaryPath: string;
}

// UT だけのカバレッジの対象（testing.md §4）。command で UT を流すと summaryPath に summary が出る
// 範囲は backend/vitest.unit.config.ts・frontend/vitest.unit.config.ts の coverage.include と同じにする（scripts/tests で確かめる）
export const UNIT_SCOPES: UnitCoverageScope[] = [
  {
    name: "backend",
    command: "npm --prefix backend run -s test:unit:coverage",
    sourceDirs: ["backend/src/services", "backend/src/controllers"],
    summaryPath: "backend/coverage/unit/coverage-summary.json",
  },
  {
    name: "frontend",
    command: "npm --prefix frontend run -s test:unit:coverage",
    sourceDirs: ["frontend/src/lib"],
    summaryPath: "frontend/coverage/unit/coverage-summary.json",
  },
];
const AUDIT_DIRS = [".", "backend", "frontend"];
// backend の npm run test:migrations が vitest の JSON レポーターで書き出す
const MIGRATION_RESULTS = "backend/coverage/migrations/results.json";

// コマンドを実行して測る指標（型、audit、テストとカバレッジ、ビルドと JS サイズ）。lint は lint-collector.ts
export class CommandCollector implements MetricCollector {
  readonly #runner: CommandRunner;
  readonly #files: FileSource;
  readonly #coverage: CoverageReader;
  readonly #bundle: BundleSizeMeasurer;
  readonly #log: (message: string) => void;
  readonly #checks: CheckResult[] = [];

  constructor(deps: CommandCollectorDeps) {
    this.#runner = deps.runner;
    this.#files = deps.files;
    this.#coverage = deps.coverage;
    this.#bundle = deps.bundle;
    this.#log = deps.log;
  }

  collect(): CollectedMetrics {
    const measurements: Measurement[] = [
      this.#typeErrors(),
      this.#auditHigh(),
      ...this.#backendTests(),
      this.#migrationTests(),
      this.#unitCoverage(),
      this.#bundleSize(),
    ];
    return { checks: this.#checks, measurements, findings: [] };
  }

  #run(name: string, command: string): { ok: boolean; output: string; durationSec: number } {
    this.#log(`▶ ${name}: ${command}`);
    const result = this.#runner.run(command);
    const ok = result.exitCode === 0;
    if (!ok) this.#log(result.output);
    this.#checks.push({ name, ok, durationSec: result.durationSec });
    return { ok, output: result.output, durationSec: result.durationSec };
  }

  #typeErrors(): Measurement {
    const result = this.#run("型チェック", "npm run -s typecheck");
    const { output } = result;
    const count = (output.match(/error TS\d+/g) ?? []).length;
    return { id: "type-errors", kind: "value", value: result.ok ? count : Math.max(count, 1) };
  }

  #auditHigh(): Measurement {
    const counts = AUDIT_DIRS.map((dir) => {
      this.#log(`▶ npm audit: ${dir}`);
      const { output } = this.#runner.run(`npm --prefix ${dir} audit --json`);
      const { metadata } = JSON.parse(output) as { metadata: { vulnerabilities: Record<string, number> } };
      const vulns = metadata.vulnerabilities;
      return { dir, count: (vulns.high ?? 0) + (vulns.critical ?? 0) };
    });
    const detail = counts.map((c) => `${c.dir}: ${c.count}`).join(", ");
    return { id: "audit-high", kind: "value", value: counts.reduce((sum, c) => sum + c.count, 0), detail };
  }

  #backendTests(): Measurement[] {
    const result = this.#run("backend テスト（UT ＋ API、カバレッジ）", "npm --prefix backend run -s test:coverage");
    const duration: Measurement = { id: "backend-test-duration", kind: "value", value: result.durationSec };
    const summary = this.#coverage.read("backend/coverage/all/coverage-summary.json");
    if (summary === null) {
      const detail = "カバレッジが出ていない";
      return [
        duration,
        { id: "backend-coverage-lines", kind: "missing", detail },
        { id: "backend-coverage-branches", kind: "missing", detail },
      ];
    }
    return [
      duration,
      { id: "backend-coverage-lines", kind: "value", value: summary.lines },
      { id: "backend-coverage-branches", kind: "value", value: summary.branches },
    ];
  }

  // マイグレーションテストはマイグレーション 1 本ごとに up / down のケースがあるので、失敗したケース数を数える（testing.md §1）
  // コマンドが失敗したのに結果ファイルが古い・失敗 0 件のときも見逃さないよう、最低 1 件にする
  #migrationTests(): Measurement {
    const result = this.#run("マイグレーションテスト", "npm --prefix backend run -s test:migrations");
    if (!this.#files.exists(MIGRATION_RESULTS)) {
      return { id: "migration-test-failures", kind: "missing", detail: "テスト結果（JSON）が出ていない" };
    }
    const { numFailedTests, numTotalTests } = JSON.parse(this.#files.read(MIGRATION_RESULTS)) as {
      numFailedTests: number;
      numTotalTests: number;
    };
    if (numTotalTests === 0) return { id: "migration-test-failures", kind: "missing", detail: "テストが 0 件" };
    return { id: "migration-test-failures", kind: "value", value: result.ok ? numFailedTests : Math.max(numFailedTests, 1) };
  }

  #unitCoverage(): Measurement {
    const scopes = UNIT_SCOPES.filter((s) => this.#files.list(s.sourceDirs, [".ts", ".tsx"]).length > 0);
    for (const scope of scopes) this.#run(`${scope.name} UT（カバレッジ）`, scope.command);
    if (scopes.length === 0) {
      return { id: "ut-coverage-lines", kind: "notApplicable", detail: "UT の対象（services・controllers・lib）がまだない" };
    }
    const summaries = scopes.map((s) => ({ scope: s, summary: this.#coverage.read(s.summaryPath) }));
    const missing = summaries.filter((s) => s.summary === null).map((s) => s.scope.name);
    if (missing.length > 0) {
      return { id: "ut-coverage-lines", kind: "missing", detail: `${missing.join(", ")} の UT カバレッジがない` };
    }
    const total = summaries.reduce((sum, s) => sum + (s.summary?.totalLines ?? 0), 0);
    if (total === 0) return { id: "ut-coverage-lines", kind: "missing", detail: "UT カバレッジの対象行が 0" };
    const covered = summaries.reduce((sum, s) => sum + ((s.summary?.lines ?? 0) * (s.summary?.totalLines ?? 0)) / 100, 0);
    const value = Math.round((covered / total) * 1000) / 10;
    return { id: "ut-coverage-lines", kind: "value", value, detail: scopes.map((s) => s.name).join(" + ") };
  }

  #bundleSize(): Measurement {
    const result = this.#run("frontend ビルド", "npm --prefix frontend run -s build");
    if (!result.ok) return { id: "initial-js-gzip", kind: "missing", detail: "ビルドに失敗した" };
    const kb = this.#bundle.initialJsGzipKb("frontend/dist");
    if (kb === null) return { id: "initial-js-gzip", kind: "missing", detail: "dist/index.html から JS が見つからない" };
    return { id: "initial-js-gzip", kind: "value", value: kb };
  }
}
