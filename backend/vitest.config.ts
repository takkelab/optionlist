import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { defineConfig } from "vitest/config";

// テスト用 DB の接続先。ローカルは .env.test（.env.test.example 参照）、CI はワークフローの env で渡す
const testEnv = existsSync(".env.test") ? parseEnv(readFileSync(".env.test", "utf8")) : {};

export default defineConfig({
  test: {
    env: testEnv,
    // 性能テストは性能用データを入れてから別に流す（npm run test:perf、vitest.perf.config.ts）
    exclude: ["**/node_modules/**", "tests/perf/**"],
    // API テストは同じテスト用 DB を空にしてから使うので、ファイルを並列に流さない（docs/decisions/0008）
    fileParallelism: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      reportsDirectory: "coverage/all",
      reportOnFailure: true,
      include: ["src/**/*.ts"],
      // listen するだけのエントリーポイント。依存の組み立ては 1c 以降も server.ts に置く
      // 削除のジョブのエントリーポイント（jobs/cleanup.ts）も同じ。中身の CleanupEntry・CleanupJob・CleanupRepository はテストする
      exclude: ["src/server.ts", "src/jobs/cleanup.ts"],
    },
  },
});
