import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { defineConfig } from "vitest/config";

// 性能の統合テスト（testing.md §3、npm run test:perf）。通常のテストとは分け、カバレッジも取らない
const testEnv = existsSync(".env.test") ? parseEnv(readFileSync(".env.test", "utf8")) : {};

export default defineConfig({
  test: {
    include: ["tests/perf/**/*.test.ts"],
    env: testEnv,
    // ヒープ増加を GC 後の値で比べる（metrics.md §4）
    execArgv: ["--expose-gc"],
    testTimeout: 120_000,
    hookTimeout: 60_000,
  },
});
