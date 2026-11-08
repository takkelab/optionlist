import { OxcParsedSource } from "./source-file.ts";
import type { AstNode } from "./source-file.ts";
import type { FileSource, Finding, Measurement } from "./types.ts";

export interface LintRuleTestChecker {
  check(files: FileSource): { measurement: Measurement; findings: Finding[] };
}

const RULES_DIR = "tools/lint-rules/rules";
const TESTS_DIR = "tools/lint-rules/tests";

// metrics.md §2「自作 lint ルールのテスト」。rules/<name>.ts ごとに tests/<name>.test.ts があり、
// RuleTester の valid（例外として通す例）と invalid（検出する例）が 1 件以上あるかを見る
export class RuleTesterCaseChecker implements LintRuleTestChecker {
  check(files: FileSource): { measurement: Measurement; findings: Finding[] } {
    const rules = files.list([RULES_DIR], [".ts"]);
    if (rules.length === 0) {
      return { measurement: { id: "lint-rules-without-tests", kind: "missing", detail: `${RULES_DIR} にルールがない` }, findings: [] };
    }
    const findings = rules.flatMap((rule) => this.#checkRule(files, rule));
    const names = findings.map((f) => f.file.slice(RULES_DIR.length + 1));
    const measurement: Measurement = {
      id: "lint-rules-without-tests",
      kind: "value",
      value: findings.length,
      detail: findings.length === 0 ? `${rules.length} ルール` : names.join(", "),
    };
    return { measurement, findings };
  }

  #checkRule(files: FileSource, rule: string): Finding[] {
    const name = rule.slice(RULES_DIR.length + 1).replace(/\.ts$/, "");
    const testFile = `${TESTS_DIR}/${name}.test.ts`;
    if (!files.exists(testFile)) return [{ file: rule, line: 0, message: `${testFile} がない` }];
    const nodes = new OxcParsedSource(testFile, files.read(testFile)).nodes();
    const lacking = ["valid", "invalid"].filter((key) => !nodes.some((node) => this.#isNonEmptyCases(node, key)));
    if (lacking.length === 0) return [];
    return [{ file: rule, line: 0, message: `${testFile} に ${lacking.join("・")} のケースがない` }];
  }

  #isNonEmptyCases(node: AstNode, key: string): boolean {
    if (node.type !== "Property") return false;
    const name = node.key as { name?: unknown };
    const value = node.value as { type?: unknown; elements?: unknown[] };
    return name.name === key && value.type === "ArrayExpression" && (value.elements?.length ?? 0) > 0;
  }
}
