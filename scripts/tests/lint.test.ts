import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LintCollector } from "../lib/lint-collector.ts";
import { RuleTesterCaseChecker } from "../lib/lint-rule-test-checker.ts";
import { FakeCommandRunner, FakeFileSource } from "./fakes.ts";

describe("LintCollector", () => {
  const diagnostic = (code: string, severity = "error") => ({
    code,
    severity,
    message: "m",
    filename: "backend/src/a.ts",
    labels: [{ span: { line: 3 } }],
  });
  const collect = (output: string, exitCode = 1) =>
    new LintCollector({
      runner: new FakeCommandRunner([["lint --", { exitCode, output }]]),
      designRules: ["max-lines", "design/law-of-demeter", "typescript/no-explicit-any", "no-restricted-imports"],
      log: () => undefined,
    }).collect();

  it("設計ルールの診断だけを違反として数え、エラーをレポートに出す", () => {
    const output = JSON.stringify({
      diagnostics: [
        diagnostic("eslint(max-lines)"),
        diagnostic("design(law-of-demeter)"),
        diagnostic("typescript(no-explicit-any)"),
        diagnostic("eslint(no-restricted-imports)"),
        diagnostic("react(rules-of-hooks)"),
        diagnostic("eslint(no-unused-vars)", "warning"),
      ],
    });
    const { measurements, findings, checks } = collect(output);
    assert.deepEqual(measurements, [{ id: "design-rule-violations", kind: "value", value: 4 }]);
    assert.equal(findings.length, 5);
    assert.deepEqual(findings[0], { file: "backend/src/a.ts", line: 3, message: "eslint(max-lines): m" });
    assert.deepEqual(
      checks.map((c) => [c.name, c.ok]),
      [
        ["自作 lint ルールのテスト", true],
        ["lint", false],
      ],
    );
  });

  it("違反がなければ 0 件", () => {
    const { measurements } = collect('{ "diagnostics": [] }', 0);
    assert.deepEqual(measurements, [{ id: "design-rule-violations", kind: "value", value: 0 }]);
  });

  it("JSON が出ない（設定やプラグインの読み込みに失敗した）ときは missing", () => {
    assert.equal(collect("Failed to parse oxlint configuration file.").measurements[0]?.kind, "missing");
    assert.equal(collect('{ "x": 1 }').measurements[0]?.kind, "missing");
  });
});

describe("RuleTesterCaseChecker", () => {
  const rule = "export const r = {};";
  const test = (cases: string) => `tester.run("a", r, { ${cases} });`;
  const check = (files: Record<string, string>) => new RuleTesterCaseChecker().check(new FakeFileSource(files));

  it("valid と invalid が 1 件以上あるテストがあれば合格", () => {
    const { measurement, findings } = check({
      "tools/lint-rules/rules/a.ts": rule,
      "tools/lint-rules/tests/a.test.ts": test(`valid: ["x;"], invalid: [{ code: "y;", errors: 1 }]`),
    });
    assert.deepEqual(measurement, { id: "lint-rules-without-tests", kind: "value", value: 0, detail: "1 ルール" });
    assert.deepEqual(findings, []);
  });

  it("テストがない、または valid・invalid のどちらかが空のルールを数える", () => {
    const { measurement, findings } = check({
      "tools/lint-rules/rules/a.ts": rule,
      "tools/lint-rules/rules/b.ts": rule,
      "tools/lint-rules/rules/c.ts": rule,
      "tools/lint-rules/tests/b.test.ts": test(`valid: [], invalid: [{ code: "y;", errors: 1 }]`),
      "tools/lint-rules/tests/c.test.ts": test(`valid: ["x;"]`),
    });
    assert.equal(measurement.kind === "value" && measurement.value, 3);
    assert.deepEqual(
      findings.map((f) => f.message),
      [
        "tools/lint-rules/tests/a.test.ts がない",
        "tools/lint-rules/tests/b.test.ts に valid のケースがない",
        "tools/lint-rules/tests/c.test.ts に invalid のケースがない",
      ],
    );
  });

  it("ルールが 1 つもなければ missing", () => {
    assert.equal(check({}).measurement.kind, "missing");
  });
});
