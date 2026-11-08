import type { CollectedMetrics, MetricCollector } from "./static-analysis-collector.ts";
import type { CheckResult, CommandRunner, Finding, Measurement } from "./types.ts";

export interface LintCollectorDeps {
  runner: CommandRunner;
  // architecture.md §2 に当たる oxlint のルール名（tools/lint-rules/design-rules.ts の DESIGN_RULES のキー）
  designRules: string[];
  log: (message: string) => void;
}

interface OxlintDiagnostic {
  code: string;
  severity: string;
  message: string;
  filename: string;
  labels: { span: { line: number } }[];
}

// lint（oxlint ＋自作ルール）と自作ルールのテストを実行し、metrics.md §2「コード設計ルールの違反」を数える
export class LintCollector implements MetricCollector {
  readonly #runner: CommandRunner;
  readonly #codes: Set<string>;
  readonly #log: (message: string) => void;
  readonly #checks: CheckResult[] = [];

  constructor(deps: LintCollectorDeps) {
    this.#runner = deps.runner;
    this.#codes = new Set(deps.designRules.map((rule) => this.#codeOf(rule)));
    this.#log = deps.log;
  }

  collect(): CollectedMetrics {
    this.#run("自作 lint ルールのテスト", "npm run -s test:lint-rules");
    const { measurement, findings } = this.#designRuleViolations();
    return { checks: this.#checks, measurements: [measurement], findings };
  }

  #run(name: string, command: string): string {
    this.#log(`▶ ${name}: ${command}`);
    const result = this.#runner.run(command);
    const ok = result.exitCode === 0;
    if (!ok && name !== "lint") this.#log(result.output);
    this.#checks.push({ name, ok, durationSec: result.durationSec });
    return result.output;
  }

  #designRuleViolations(): { measurement: Measurement; findings: Finding[] } {
    const output = this.#run("lint", "npm run -s lint -- -f json");
    const diagnostics = this.#parse(output);
    if (diagnostics === null) {
      this.#log(output);
      const detail = "oxlint の JSON 出力を読めなかった（設定やプラグインの読み込みエラー）";
      return { measurement: { id: "design-rule-violations", kind: "missing", detail }, findings: [] };
    }
    // 警告（oxlint の correctness の既定など）は数えず、エラーだけをレポートに出す
    const findings = diagnostics.filter((d) => d.severity === "error").map((d) => ({
      file: d.filename,
      line: d.labels[0]?.span.line ?? 0,
      message: `${d.code}: ${d.message}`,
    }));
    const violations = diagnostics.filter((d) => this.#codes.has(d.code)).length;
    return { measurement: { id: "design-rule-violations", kind: "value", value: violations }, findings };
  }

  #parse(output: string): OxlintDiagnostic[] | null {
    const json = output.slice(output.indexOf("{"), output.lastIndexOf("}") + 1);
    try {
      const parsed = JSON.parse(json) as { diagnostics?: OxlintDiagnostic[] };
      return Array.isArray(parsed.diagnostics) ? parsed.diagnostics : null;
    } catch (error) {
      this.#log(`oxlint の出力を JSON として読めない: ${(error as Error).message}`);
      return null;
    }
  }

  // oxlint の設定のルール名 → 診断の code（design/x → design(x)、typescript/x → typescript(x)、x → eslint(x)）
  #codeOf(rule: string): string {
    const [plugin, name] = rule.includes("/") ? rule.split("/") : ["eslint", rule];
    return `${plugin}(${name})`;
  }
}
