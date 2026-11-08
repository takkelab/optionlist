import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { ViteBundleSizeMeasurer } from "../lib/bundle-size-measurer.ts";
import { CommandCollector, UNIT_SCOPES } from "../lib/command-collector.ts";
import { JsonCoverageReader } from "../lib/coverage-reader.ts";
import { CssDesignTokenChecker } from "../lib/design-token-checker.ts";
import { E2eCollector } from "../lib/e2e-collector.ts";
import { LintCollector } from "../lib/lint-collector.ts";
import { CommentLintDisableDetector } from "../lib/lint-disable-detector.ts";
import { RuleTesterCaseChecker } from "../lib/lint-rule-test-checker.ts";
import { TargetMetricsJudge } from "../lib/metrics-judge.ts";
import { PerfCollector } from "../lib/perf-collector.ts";
import { MarkdownReportWriter } from "../lib/report-writer.ts";
import { StaticAnalysisCollector } from "../lib/static-analysis-collector.ts";
import { AstSwallowedExceptionDetector } from "../lib/swallowed-exception-detector.ts";
import type { MetricDefinition } from "../lib/types.ts";
import { FakeCommandRunner, FakeFileSource } from "./fakes.ts";

const metric = (id: string, overrides: Partial<MetricDefinition> = {}): MetricDefinition => ({
  id,
  section: "§2",
  label: id,
  op: "max",
  target: 0,
  unit: "件",
  judge: "fail",
  since: "1a",
  ...overrides,
});

describe("TargetMetricsJudge", () => {
  const judge = new TargetMetricsJudge({
    metrics: [
      metric("min", { op: "min", target: 80 }),
      metric("max"),
      metric("warn", { judge: "warn", target: 60 }),
      metric("na"),
      metric("later", { since: "3" }),
    ],
  });

  it("目標との比較、警告、対象なし、未計測を判定する", () => {
    const results = judge.judge([
      { id: "min", kind: "value", value: 79.9 },
      { id: "max", kind: "value", value: 0 },
      { id: "warn", kind: "value", value: 61 },
      { id: "na", kind: "notApplicable", detail: "対象なし" },
    ]);
    assert.deepEqual(
      results.map((r) => r.outcome),
      ["fail", "pass", "warn", "notApplicable", "notMeasured"],
    );
  });

  it("計測できなかった指標は目標を割ったのと同じに扱う", () => {
    const results = judge.judge([
      { id: "max", kind: "missing", detail: "x" },
      { id: "warn", kind: "missing", detail: "x" },
    ]);
    assert.deepEqual(
      results.slice(1, 3).map((r) => r.outcome),
      ["fail", "warn"],
    );
  });

  it("config にない指標を渡すとエラーにする（id の打ち間違いを防ぐ）", () => {
    assert.throws(() => judge.judge([{ id: "typo", kind: "value", value: 1 }]));
  });
});

describe("MarkdownReportWriter", () => {
  const writer = new MarkdownReportWriter(() => new Date("2026-11-01T00:00:00Z"));
  const pass = { definition: metric("a"), outcome: "pass" as const, value: 0 };

  it("チェックの失敗か fail の指標があれば ok=false", () => {
    assert.equal(writer.build([{ name: "t", ok: true, durationSec: 1 }], [pass], []).ok, true);
    assert.equal(writer.build([{ name: "t", ok: false, durationSec: 1 }], [pass], []).ok, false);
    assert.equal(writer.build([], [{ ...pass, outcome: "fail" }], []).ok, false);
    assert.equal(writer.build([], [{ ...pass, outcome: "warn" }], []).ok, true);
  });

  it("マークダウンに指標と検出箇所を出す", () => {
    const report = writer.build([], [pass], [{ file: "a.ts", line: 3, message: "例外を握り潰している" }]);
    const markdown = writer.toMarkdown(report);
    assert.match(markdown, /\| §2 \| a \| 0件 \| ≤ 0件 \| ✅ 合格 \|/);
    assert.match(markdown, /- a\.ts:3 例外を握り潰している/);
  });
});

describe("ViteBundleSizeMeasurer", () => {
  it("index.html が読む script と modulepreload の gzip 合計を返す", () => {
    const files = new FakeFileSource({
      "dist/index.html":
        '<script type="module" crossorigin src="/assets/index.js"></script><link rel="modulepreload" href="/assets/vendor.js">',
      "dist/assets/index.js": "a".repeat(5000),
      "dist/assets/vendor.js": "b".repeat(5000),
      "dist/assets/lazy.js": "c".repeat(5000),
    });
    const kb = new ViteBundleSizeMeasurer(files).initialJsGzipKb("dist");
    assert.ok(kb !== null && kb > 0 && kb < 1, `${kb}`);
  });

  it("ビルドしていない、または JS が 1 本も見つからなければ null", () => {
    assert.equal(new ViteBundleSizeMeasurer(new FakeFileSource({})).initialJsGzipKb("dist"), null);
    const noScript = new FakeFileSource({ "dist/index.html": "<html></html>" });
    assert.equal(new ViteBundleSizeMeasurer(noScript).initialJsGzipKb("dist"), null);
  });
});

describe("JsonCoverageReader", () => {
  it("分岐が 1 つもない（Unknown）ときは 100% とみなす", () => {
    const files = new FakeFileSource({
      "s.json": JSON.stringify({ total: { lines: { pct: 92.5, total: 40 }, branches: { pct: "Unknown", total: 0 } } }),
    });
    assert.deepEqual(new JsonCoverageReader(files).read("s.json"), { lines: 92.5, branches: 100, totalLines: 40 });
  });
});

describe("CommandCollector", () => {
  const audit = JSON.stringify({ metadata: { vulnerabilities: { high: 1, critical: 1, moderate: 3 } } });
  const collect = (files: Record<string, string>) => {
    const runner = new FakeCommandRunner([
      ["audit", { output: audit }],
      ["typecheck", { exitCode: 2, output: "a.ts(1,1): error TS2322: x\nb.ts(1,1): error TS2345: y" }],
      ["test:coverage", { durationSec: 12.3 }],
    ]);
    const fileSource = new FakeFileSource(files);
    return new CommandCollector({
      runner,
      files: fileSource,
      coverage: new JsonCoverageReader(fileSource),
      bundle: new ViteBundleSizeMeasurer(fileSource),
      log: () => undefined,
    }).collect();
  };

  it("型エラー・audit・テスト時間を数え、失敗したコマンドをチェックに出す", () => {
    const { measurements, checks } = collect({});
    const value = (id: string) => measurements.find((m) => m.id === id);
    assert.deepEqual(value("type-errors"), { id: "type-errors", kind: "value", value: 2 });
    assert.equal((value("audit-high") as { value: number }).value, 6);
    assert.equal((value("backend-test-duration") as { value: number }).value, 12.3);
    assert.deepEqual(
      checks.filter((c) => !c.ok).map((c) => c.name),
      ["型チェック"],
    );
  });

  it("カバレッジやビルド成果物が出ていなければ missing（未計測で見逃さない）", () => {
    const { measurements } = collect({});
    for (const id of ["backend-coverage-lines", "backend-coverage-branches", "initial-js-gzip"]) {
      assert.equal(measurements.find((m) => m.id === id)?.kind, "missing", id);
    }
  });

  it("UT の対象がなければ対象なし、あるのにカバレッジがなければ missing", () => {
    const none = collect({}).measurements.find((m) => m.id === "ut-coverage-lines");
    assert.equal(none?.kind, "notApplicable");
    const missing = collect({ "backend/src/services/a.ts": "" }).measurements.find((m) => m.id === "ut-coverage-lines");
    assert.equal(missing?.kind, "missing");
  });

  it("マイグレーションテストの失敗件数を数え、結果がなければ missing", () => {
    const value = (files: Record<string, string>) =>
      collect(files).measurements.find((m) => m.id === "migration-test-failures");
    assert.equal(value({})?.kind, "missing");
    const results = (failed: number, total: number) =>
      JSON.stringify({ numFailedTests: failed, numTotalTests: total });
    const path = "backend/coverage/migrations/results.json";
    assert.deepEqual(value({ [path]: results(2, 9) }), { id: "migration-test-failures", kind: "value", value: 2 });
    assert.equal(value({ [path]: results(0, 0) })?.kind, "missing");
  });

  it("マイグレーションテストのコマンドが失敗したら、結果が 0 件でも 1 件以上にする", () => {
    const runner = new FakeCommandRunner([
      ["audit", { output: '{"metadata":{"vulnerabilities":{}}}' }],
      ["test:migrations", { exitCode: 1 }],
    ]);
    const files = new FakeFileSource({ "backend/coverage/migrations/results.json": JSON.stringify({ numFailedTests: 0, numTotalTests: 9 }) });
    const { measurements } = new CommandCollector({
      runner,
      files,
      coverage: new JsonCoverageReader(files),
      bundle: new ViteBundleSizeMeasurer(files),
      log: () => undefined,
    }).collect();
    const failures = measurements.find((m) => m.id === "migration-test-failures");
    assert.equal(failures?.kind === "value" && failures.value, 1);
  });

  it("UT カバレッジは backend と frontend の行数で重み付けして合算する", () => {
    const summary = (pct: number, total: number) =>
      JSON.stringify({ total: { lines: { pct, total }, branches: { pct: 100, total: 0 } } });
    const ut = collect({
      "backend/src/services/a.ts": "",
      "frontend/src/lib/b.ts": "",
      "backend/coverage/unit/coverage-summary.json": summary(100, 30),
      "frontend/coverage/unit/coverage-summary.json": summary(50, 10),
    }).measurements.find((m) => m.id === "ut-coverage-lines");
    assert.equal(ut?.kind === "value" && ut.value, 87.5);
  });
});

describe("計測の抜けを防ぐ", () => {
  it("since が 1a〜4 の指標は、すべてどれかの collector が計測値を出す", () => {
    const config = JSON.parse(readFileSync("metrics.config.json", "utf8")) as { metrics: MetricDefinition[] };
    const files = new FakeFileSource({});
    const produced = [
      new StaticAnalysisCollector(files, {
        swallowed: new AstSwallowedExceptionDetector(),
        lintDisable: new CommentLintDisableDetector(),
        tokens: new CssDesignTokenChecker(),
        ruleTests: new RuleTesterCaseChecker(),
      }),
      new LintCollector({ runner: new FakeCommandRunner([]), designRules: [], log: () => undefined }),
      new CommandCollector({
        runner: new FakeCommandRunner([["audit", { output: '{"metadata":{"vulnerabilities":{}}}' }]]),
        files,
        coverage: new JsonCoverageReader(files),
        bundle: new ViteBundleSizeMeasurer(files),
        log: () => undefined,
      }),
      new PerfCollector({
        runner: new FakeCommandRunner([]),
        files,
        judge: new TargetMetricsJudge(config),
        retries: 0,
        log: () => undefined,
      }),
      new E2eCollector({ runner: new FakeCommandRunner([]), files, log: () => undefined }),
    ].flatMap((c) => c.collect().measurements.map((m) => m.id));
    const expected = config.metrics.filter((m) => ["1a", "1b", "1c", "2", "3", "4"].includes(m.since)).map((m) => m.id);
    assert.deepEqual(expected.filter((id) => !produced.includes(id)), []);
  });

  for (const name of ["backend", "frontend"]) {
    it(`UNIT_SCOPES の ${name} の範囲が vitest.unit.config.ts の coverage.include と同じ`, () => {
      const configText = readFileSync(`${name}/vitest.unit.config.ts`, "utf8");
      const include = /coverage:[\s\S]*?include:\s*\[([^\]]*)\]/.exec(configText)?.[1] ?? "";
      const globs = [...include.matchAll(/["']src\/([^"'*]+)\/\*\*\/\*\.ts["']/g)].map((m) => `${name}/src/${m[1]}`);
      const scope = UNIT_SCOPES.find((s) => s.name === name);
      assert.deepEqual(globs, scope?.sourceDirs);
    });
  }
});
