// npm run metrics:usage の集計（metrics.md §6）。DB は UsageSource 越しに集計のビュー（usage_*）を読み、テストではフェイクを渡す
// ビューは件数・日数だけを返す（docs/decisions/0043）。ここでは「使った人 1 人あたり」に直して表にする

export type ErrorCount = { message: string; count: number };

// 1 つの期間（直近 7 日・28 日）の件数。ビュー usage_periods の 1 行
export type PeriodCounts = {
  // 期間内に last_seen_at を書いた人
  activeUsers: number;
  // 使った人のうち、期間内に達成がある人
  achievers: number;
  achievements: number;
  // 期間内に作った option のうち、提案から追加したもの（消した項目は数えない）
  suggestionAdds: number;
  // 期間内に初めて達成した option の、作成から最初の達成までの日数の中央値。なければ null
  firstAchievementDaysMedian: number | null;
  clientErrors: number;
};

// 4 週前の週に作ったアカウント（cohort）のうち、その後の 3 週にも使った人（retained）
export type Retention = { cohort: number; retained: number };

export interface UsageSource {
  periods(): Promise<{ week: PeriodCounts; fourWeeks: PeriodCounts }>;
  retention(): Promise<Retention>;
  // 直近 4 週間に使った人ごとの「作成から 90 日以上の pending」の件数の中央値。使った人がいなければ null
  stalePendingMedian(): Promise<number | null>;
  // 直近 4 週間の client_error で多いメッセージ（3 つまで、多い順）
  topClientErrors(): Promise<ErrorCount[]>;
}

// 割り算の値は、使った人が 0 なら null（表では -）
export type PeriodUsage = {
  activeUsers: number;
  achievers: number;
  achieverRate: number | null;
  // 件数は ÷ 使った人。4 週間はさらに 4 で割って週あたりにする
  achievementsPerUser: number | null;
  suggestionAddsPerUser: number | null;
  firstAchievementDays: number | null;
  clientErrorsPer100Users: number | null;
};

export type Usage = {
  at: Date;
  week: PeriodUsage;
  fourWeeksPerWeek: PeriodUsage;
  retention: Retention;
  stalePendingMedian: number | null;
  topErrors: ErrorCount[];
};

export interface UsageReporter {
  collect(): Promise<Usage>;
  format(usage: Usage): string;
}

// 目標値（metrics.md §6 ※仮決め）。ほかは観測
const CLIENT_ERRORS_MAX_PER_100_USERS = 5;
const STALE_DAYS = 90;

export class MetricsUsageReporter implements UsageReporter {
  readonly #source: UsageSource;
  readonly #now: () => Date;

  constructor(source: UsageSource, now: () => Date = () => new Date()) {
    this.#source = source;
    this.#now = now;
  }

  async collect(): Promise<Usage> {
    const { week, fourWeeks } = await this.#source.periods();
    return {
      at: this.#now(),
      week: this.#perUser(week, 1),
      fourWeeksPerWeek: this.#perUser(fourWeeks, 4),
      retention: await this.#source.retention(),
      stalePendingMedian: await this.#source.stalePendingMedian(),
      topErrors: await this.#source.topClientErrors(),
    };
  }

  format(usage: Usage): string {
    const { week, fourWeeksPerWeek: four, retention } = usage;
    const errorsOk = (value: number | null) => (value === null ? "-" : `${this.#number(value)} ${value <= CLIENT_ERRORS_MAX_PER_100_USERS ? "✓" : "✗"}`);
    const rows = [
      ["**達成した人の割合**", this.#rate(week.achieverRate, week.achievers, week.activeUsers), this.#rate(four.achieverRate, four.achievers, four.activeUsers), "観測"],
      ["1 人あたりの達成数", this.#optional(week.achievementsPerUser), this.#optional(four.achievementsPerUser), "観測"],
      ["使った人の数", `${week.activeUsers} 人`, `${four.activeUsers} 人（4 週間で）`, "観測"],
      ["続けて使った人の割合（4 週前の週に作ったアカウント）", this.#rate(retention.cohort === 0 ? null : retention.retained / retention.cohort, retention.retained, retention.cohort), "", "観測"],
      ["提案から追加した件数（1 人あたり）", this.#optional(week.suggestionAddsPerUser), this.#optional(four.suggestionAddsPerUser), "観測"],
      ["追加から初回達成までの日数（中央値）", this.#days(week.firstAchievementDays), this.#days(four.firstAchievementDays), "観測"],
      [`やりたいリストの滞留（作って ${STALE_DAYS} 日以上の pending の件数。1 人あたりの中央値）`, this.#optional(usage.stalePendingMedian), "", "観測"],
      ["frontend のエラー数（使った人 100 人あたり）", errorsOk(week.clientErrorsPer100Users), errorsOk(four.clientErrorsPer100Users), `${CLIENT_ERRORS_MAX_PER_100_USERS} 件以下 / 週`],
    ];
    const lines = [
      `# 利用状況（${usage.at.toLocaleString("ja-JP")} 時点）`,
      "",
      "| 指標 | 直近 1 週間 | 直近 4 週間（週あたり） | 目標 |",
      "|------|-------------|-------------------------|------|",
      ...rows.map((cells) => `| ${cells.join(" | ")} |`),
    ];
    if (usage.topErrors.length > 0) {
      lines.push("", "多いエラー（直近 4 週間）:", ...usage.topErrors.map((e) => `- ${e.count} 件: ${e.message}`));
    }
    return `${lines.join("\n")}\n`;
  }

  #perUser(counts: PeriodCounts, weeks: number): PeriodUsage {
    const users = counts.activeUsers;
    const per = (value: number) => (users === 0 ? null : value / users / weeks);
    return {
      activeUsers: users,
      achievers: counts.achievers,
      achieverRate: users === 0 ? null : counts.achievers / users,
      achievementsPerUser: per(counts.achievements),
      suggestionAddsPerUser: per(counts.suggestionAdds),
      firstAchievementDays: counts.firstAchievementDaysMedian,
      clientErrorsPer100Users: users === 0 ? null : (counts.clientErrors / users / weeks) * 100,
    };
  }

  #rate(rate: number | null, part: number, whole: number): string {
    return rate === null ? "-" : `${Math.round(rate * 100)}%（${part} / ${whole} 人）`;
  }

  // 割った値は小数 2 桁まで（1 人あたりの値は 1 より小さいことが多い）
  #number(value: number): string {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }

  #optional(value: number | null): string {
    return value === null ? "-" : this.#number(value);
  }

  #days(value: number | null): string {
    return value === null ? "-" : `${value.toFixed(1)} 日`;
  }
}
