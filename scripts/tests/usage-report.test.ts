import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ErrorCount, UsageSource } from "../lib/usage-report.ts";
import { MetricsUsageReporter } from "../lib/usage-report.ts";

const NOW = new Date("2026-11-08T00:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY);

type Rows = {
  achievements?: Date[];
  adds?: Date[];
  // [作成, 初めての達成]
  firsts?: [Date, Date][];
  pending?: Date[];
  errors?: [Date, string][];
};

// 行の時刻だけを持ち、期間で絞って数えるフェイク
class FakeUsageSource implements UsageSource {
  readonly #rows: Rows;

  constructor(rows: Rows) {
    this.#rows = rows;
  }

  async achievements(from: Date, to: Date): Promise<number> {
    return (this.#rows.achievements ?? []).filter((at) => at >= from && at < to).length;
  }

  async suggestionAdds(from: Date, to: Date): Promise<number> {
    return (this.#rows.adds ?? []).filter((at) => at >= from && at < to).length;
  }

  async firstAchievementSeconds(from: Date, to: Date): Promise<number[]> {
    return (this.#rows.firsts ?? []).filter(([, first]) => first >= from && first < to).map(([created, first]) => (first.getTime() - created.getTime()) / 1000);
  }

  async stalePending(before: Date): Promise<number> {
    return (this.#rows.pending ?? []).filter((at) => at < before).length;
  }

  async clientErrors(from: Date, to: Date): Promise<ErrorCount[]> {
    const counts = new Map<string, number>();
    for (const [at, message] of this.#rows.errors ?? []) {
      if (at >= from && at < to) counts.set(message, (counts.get(message) ?? 0) + 1);
    }
    return [...counts].map(([message, count]) => ({ message, count })).toSorted((a, b) => b.count - a.count);
  }
}

describe("MetricsUsageReporter", () => {
  it("counts the last week and the last 4 weeks per week", async () => {
    const source = new FakeUsageSource({
      achievements: [daysAgo(1), daysAgo(6), daysAgo(10), daysAgo(27), daysAgo(29)],
      adds: [daysAgo(2), daysAgo(20)],
      firsts: [
        [daysAgo(5), daysAgo(1)],
        [daysAgo(20), daysAgo(10)],
        [daysAgo(40), daysAgo(15)],
      ],
      pending: [daysAgo(10), daysAgo(91), daysAgo(200)],
      errors: [[daysAgo(1), "a"], [daysAgo(8), "a"], [daysAgo(9), "b"], [daysAgo(12), "c"], [daysAgo(13), "d"], [daysAgo(30), "e"]],
    });
    const usage = await new MetricsUsageReporter(source, () => NOW).collect();
    assert.deepEqual(usage.week, { achievements: 2, suggestionAdds: 1, firstAchievementDays: 4, clientErrors: 1 });
    // 4 週間: 達成 4 件、追加 2 件、エラー 5 件を 4 で割る。初回達成までの日数 4・10・25 の中央値
    assert.deepEqual(usage.fourWeeksPerWeek, { achievements: 1, suggestionAdds: 0.5, firstAchievementDays: 10, clientErrors: 1.25 });
    assert.equal(usage.stalePending, 2);
    assert.deepEqual(usage.topErrors.map((e) => e.message), ["a", "b", "c"]);
  });

  it("takes the mean of the two middle values for an even count", async () => {
    const source = new FakeUsageSource({ firsts: [[daysAgo(3), daysAgo(1)], [daysAgo(6), daysAgo(1)]] });
    const usage = await new MetricsUsageReporter(source, () => NOW).collect();
    assert.equal(usage.week.firstAchievementDays, 3.5);
  });

  it("formats the table with the targets judged and a dash when nobody achieved anything yet", async () => {
    const reporter = new MetricsUsageReporter(new FakeUsageSource({ errors: [[daysAgo(1), "TypeError: x"]] }), () => NOW);
    const text = reporter.format(await reporter.collect());
    assert.match(text, /\| \*\*週あたりの達成数\*\* \| 0 ✗ \| 0 ✗ \| 1 件以上 \|/);
    assert.match(text, /\| 追加から初回達成までの日数（中央値） \| - \| - \| 観測 \|/);
    assert.match(text, /\| frontend のエラー数 \| 1 ✗ \| 0\.3 ✗ \| 0 件 \|/);
    assert.match(text, /- 1 件: TypeError: x/);
  });

  it("marks the targets as met and leaves out the error list when there are no errors", async () => {
    const reporter = new MetricsUsageReporter(new FakeUsageSource({ achievements: [daysAgo(1), daysAgo(8), daysAgo(15), daysAgo(22)] }), () => NOW);
    const text = reporter.format(await reporter.collect());
    assert.match(text, /\| \*\*週あたりの達成数\*\* \| 1 ✓ \| 1 ✓ \|/);
    assert.match(text, /\| frontend のエラー数 \| 0 ✓ \| 0 ✓ \|/);
    assert.doesNotMatch(text, /多いエラー/);
  });
});
