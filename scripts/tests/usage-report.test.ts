import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ErrorCount, PeriodCounts, Retention, UsageSource } from "../lib/usage-report.ts";
import { MetricsUsageReporter } from "../lib/usage-report.ts";

const NOW = new Date("2026-11-08T00:00:00.000Z");
const NOBODY: PeriodCounts = { activeUsers: 0, achievers: 0, achievements: 0, suggestionAdds: 0, firstAchievementDaysMedian: null, clientErrors: 0 };

type Views = { week?: Partial<PeriodCounts>; fourWeeks?: Partial<PeriodCounts>; retention?: Retention; stale?: number | null; errors?: ErrorCount[] };

// ビューが返す集計の値をそのまま返すフェイク
class FakeUsageSource implements UsageSource {
  readonly #views: Views;

  constructor(views: Views) {
    this.#views = views;
  }

  async periods(): Promise<{ week: PeriodCounts; fourWeeks: PeriodCounts }> {
    return { week: { ...NOBODY, ...this.#views.week }, fourWeeks: { ...NOBODY, ...this.#views.fourWeeks } };
  }

  async retention(): Promise<Retention> {
    return this.#views.retention ?? { cohort: 0, retained: 0 };
  }

  async stalePendingMedian(): Promise<number | null> {
    return this.#views.stale ?? null;
  }

  async topClientErrors(): Promise<ErrorCount[]> {
    return this.#views.errors ?? [];
  }
}

const collect = (views: Views) => new MetricsUsageReporter(new FakeUsageSource(views), () => NOW).collect();
const format = async (views: Views) => {
  const reporter = new MetricsUsageReporter(new FakeUsageSource(views), () => NOW);
  return reporter.format(await reporter.collect());
};

describe("MetricsUsageReporter", () => {
  it("divides the counts by the people who used it, and the 4 weeks also by 4", async () => {
    const usage = await collect({
      week: { activeUsers: 4, achievers: 2, achievements: 6, suggestionAdds: 2, firstAchievementDaysMedian: 3, clientErrors: 1 },
      fourWeeks: { activeUsers: 10, achievers: 4, achievements: 20, suggestionAdds: 8, firstAchievementDaysMedian: 5.5, clientErrors: 2 },
    });
    assert.deepEqual(usage.week, {
      activeUsers: 4, achievers: 2, achieverRate: 0.5, achievementsPerUser: 1.5, suggestionAddsPerUser: 0.5, firstAchievementDays: 3, clientErrorsPer100Users: 25,
    });
    // 割合と中央値は割らない。件数は ÷ 10 人 ÷ 4 週
    assert.deepEqual(usage.fourWeeksPerWeek, {
      activeUsers: 10, achievers: 4, achieverRate: 0.4, achievementsPerUser: 0.5, suggestionAddsPerUser: 0.2, firstAchievementDays: 5.5, clientErrorsPer100Users: 5,
    });
  });

  it("formats every indicator in metrics.md §6, judging only the frontend errors", async () => {
    const text = await format({
      week: { activeUsers: 4, achievers: 2, achievements: 6, clientErrors: 1 },
      fourWeeks: { activeUsers: 10, achievers: 4, achievements: 20, suggestionAdds: 8, firstAchievementDaysMedian: 5.5, clientErrors: 2 },
      retention: { cohort: 3, retained: 1 },
      stale: 2,
      errors: [{ message: "TypeError: x", count: 2 }],
    });
    assert.match(text, /\| \*\*達成した人の割合\*\* \| 50%（2 \/ 4 人） \| 40%（4 \/ 10 人） \| 観測 \|/);
    assert.match(text, /\| 1 人あたりの達成数 \| 1\.50 \| 0\.50 \| 観測 \|/);
    assert.match(text, /\| 使った人の数 \| 4 人 \| 10 人（4 週間で） \| 観測 \|/);
    assert.match(text, /\| 続けて使った人の割合（4 週前の週に作ったアカウント） \| 33%（1 \/ 3 人） \| {2}\| 観測 \|/);
    assert.match(text, /\| 提案から追加した件数（1 人あたり） \| 0 \| 0\.20 \| 観測 \|/);
    assert.match(text, /\| 追加から初回達成までの日数（中央値） \| - \| 5\.5 日 \| 観測 \|/);
    assert.match(text, /\| やりたいリストの滞留（作って 90 日以上の pending の件数。1 人あたりの中央値） \| 2 \| {2}\| 観測 \|/);
    // 1 週間は 100 人あたり 25 件で目標を超え、4 週間は 5 件でちょうど目標
    assert.match(text, /\| frontend のエラー数（使った人 100 人あたり） \| 25 ✗ \| 5 ✓ \| 5 件以下 \/ 週 \|/);
    assert.match(text, /- 2 件: TypeError: x/);
    assert.equal(text.split("\n").filter((line) => /^\| (?!指標|-)/.test(line)).length, 8);
  });

  it("shows a dash instead of dividing by zero when nobody used it, and leaves out the error list", async () => {
    const text = await format({ week: { clientErrors: 3 } });
    assert.match(text, /\| \*\*達成した人の割合\*\* \| - \| - \|/);
    assert.match(text, /\| 1 人あたりの達成数 \| - \| - \|/);
    assert.match(text, /\| 続けて使った人の割合（4 週前の週に作ったアカウント） \| - \|/);
    assert.match(text, /\| やりたいリストの滞留（.*） \| - \|/);
    assert.match(text, /\| frontend のエラー数（使った人 100 人あたり） \| - \| - \|/);
    assert.doesNotMatch(text, /多いエラー/);
  });
});
