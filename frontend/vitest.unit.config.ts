import { defineConfig } from 'vitest/config'

// UT だけのカバレッジ（metrics.md §2）。画面に依存しない src/lib/ だけを実行する（testing.md §4）
// coverage.include は scripts/lib/command-collector.ts の UNIT_SCOPES と同じ範囲にする
export default defineConfig({
  test: {
    include: ['src/lib/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      reportsDirectory: 'coverage/unit',
      reportOnFailure: true,
      include: ['src/lib/**/*.ts'],
      exclude: ['src/lib/**/*.test.ts'],
    },
  },
})
