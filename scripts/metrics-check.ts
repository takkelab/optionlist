// npm run metrics:check。metrics.md の指標を計測し、metrics.config.json の目標値と比べる
// CI でもローカルでも同じ判定になる。結果は metrics-report.json と（CI では）ジョブサマリーに出す
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { DESIGN_RULES } from "../tools/lint-rules/design-rules.ts";
import { ViteBundleSizeMeasurer } from "./lib/bundle-size-measurer.ts";
import { CommandCollector } from "./lib/command-collector.ts";
import { JsonCoverageReader } from "./lib/coverage-reader.ts";
import { CssDesignTokenChecker } from "./lib/design-token-checker.ts";
import { E2eCollector } from "./lib/e2e-collector.ts";
import { LintCollector } from "./lib/lint-collector.ts";
import { CommentLintDisableDetector } from "./lib/lint-disable-detector.ts";
import { RuleTesterCaseChecker } from "./lib/lint-rule-test-checker.ts";
import { TargetMetricsJudge } from "./lib/metrics-judge.ts";
import { NodeFileSource } from "./lib/node-file-source.ts";
import { PerfCollector } from "./lib/perf-collector.ts";
import { MarkdownReportWriter } from "./lib/report-writer.ts";
import { ShellCommandRunner } from "./lib/shell-command-runner.ts";
import { StaticAnalysisCollector } from "./lib/static-analysis-collector.ts";
import { AstSwallowedExceptionDetector } from "./lib/swallowed-exception-detector.ts";
import type { MetricsConfig } from "./lib/types.ts";

const root = process.cwd();
const files = new NodeFileSource(root);
const runner = new ShellCommandRunner(root);
const log = (message: string) => console.log(message);
const config = JSON.parse(readFileSync("metrics.config.json", "utf8")) as MetricsConfig;

const collectors = [
  new StaticAnalysisCollector(files, {
    swallowed: new AstSwallowedExceptionDetector(),
    lintDisable: new CommentLintDisableDetector(),
    tokens: new CssDesignTokenChecker(),
    ruleTests: new RuleTesterCaseChecker(),
  }),
  new LintCollector({ runner, designRules: Object.keys(DESIGN_RULES), log }),
  new CommandCollector({
    runner,
    files,
    coverage: new JsonCoverageReader(files),
    bundle: new ViteBundleSizeMeasurer(files),
    log,
  }),
  new PerfCollector({ runner, files, judge: new TargetMetricsJudge(config), retries: config.perf?.retriesOnFail ?? 0, log }),
  new E2eCollector({ runner, files, log }),
];
const collected = collectors.map((c) => c.collect());

const writer = new MarkdownReportWriter(() => new Date());
const report = writer.build(
  collected.flatMap((c) => c.checks),
  new TargetMetricsJudge(config).judge(collected.flatMap((c) => c.measurements)),
  collected.flatMap((c) => c.findings),
);
const markdown = writer.toMarkdown(report);

writeFileSync("metrics-report.json", `${JSON.stringify(report, null, 2)}\n`);
console.log(`\n${markdown}`);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
process.exit(report.ok ? 0 : 1);
