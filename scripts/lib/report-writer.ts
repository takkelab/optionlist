import type { CheckResult, Finding, MetricResult, Outcome } from "./types.ts";

export interface MetricsReport {
  generatedAt: string;
  ok: boolean;
  checks: CheckResult[];
  metrics: MetricResult[];
  findings: Finding[];
}

export interface ReportWriter {
  build(checks: CheckResult[], metrics: MetricResult[], findings: Finding[]): MetricsReport;
  toMarkdown(report: MetricsReport): string;
}

const OUTCOME_LABELS: Record<Outcome, string> = {
  pass: "✅ 合格",
  fail: "❌ 失敗",
  warn: "⚠️ 警告",
  observed: "👀 観測",
  notApplicable: "➖ 対象なし",
  notMeasured: "⏳ 未計測",
};

export class MarkdownReportWriter implements ReportWriter {
  readonly #now: () => Date;

  constructor(now: () => Date) {
    this.#now = now;
  }

  build(checks: CheckResult[], metrics: MetricResult[], findings: Finding[]): MetricsReport {
    const ok = checks.every((c) => c.ok) && metrics.every((m) => m.outcome !== "fail");
    return { generatedAt: this.#now().toISOString(), ok, checks, metrics, findings };
  }

  toMarkdown(report: MetricsReport): string {
    const lines = [
      `## metrics:check ${report.ok ? "✅ 合格" : "❌ 失敗"}`,
      "",
      "| チェック | 結果 | 時間 |",
      "|---|---|---|",
      ...report.checks.map((c) => `| ${c.name} | ${c.ok ? "✅" : "❌"} | ${c.durationSec}s |`),
      "",
      "| 節 | 指標 | 計測値 | 目標 | 結果 | 備考 |",
      "|---|---|---|---|---|---|",
      ...report.metrics.map((m) => this.#metricRow(m)),
    ];
    if (report.findings.length > 0) {
      lines.push("", "### 検出箇所", "", ...report.findings.map((f) => `- ${f.file}:${f.line} ${f.message}`));
    }
    return `${lines.join("\n")}\n`;
  }

  #metricRow(m: MetricResult): string {
    const d = m.definition;
    const value = m.value === undefined ? "-" : `${m.value}${d.unit}`;
    const target = `${d.op === "min" ? "≥" : "≤"} ${d.target}${d.unit}`;
    return `| ${d.section} | ${d.label} | ${value} | ${target} | ${OUTCOME_LABELS[m.outcome]} | ${m.detail ?? ""} |`;
  }
}
