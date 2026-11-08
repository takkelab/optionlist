import { defineConfig } from "vitest/config";

// UT だけのカバレッジ（metrics.md §2）。DB や HTTP を使わない tests/unit/ だけを実行する
// vitest.config.ts を mergeConfig しないこと: 配列が連結され、coverage.include が src 全体になる
// coverage.include は scripts/lib/command-collector.ts の UNIT_SCOPES と同じ範囲にする
export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      reportsDirectory: "coverage/unit",
      reportOnFailure: true,
      include: ["src/services/**/*.ts", "src/controllers/**/*.ts"],
    },
  },
});
