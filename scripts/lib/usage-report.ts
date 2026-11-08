// npm run metrics:usage の集計（metrics.md §6）。DB は UsageSource 越しに読み、テストではフェイクを渡す

export type ErrorCount = { message: string; count: number };

// 期間はすべて [from, to)
export interface UsageSource {
  achievements(from: Date, to: Date): Promise<number>;
  // 期間内に作った option のうち、提案から追加したもの（消した項目は数えない）
  suggestionAdds(from: Date, to: Date): Promise<number>;
  // 期間内に初めて達成した option の、作成から最初の達成までの秒数
  firstAchievementSeconds(from: Date, to: Date): Promise<number[]>;
  // 今の pending のうち、before より前に作ったもの
  stalePending(before: Date): Promise<number>;
  // client_error をメッセージごとに数えたもの（多い順）
  clientErrors(from: Date, to: Date): Promise<ErrorCount[]>;
}

export type PeriodUsage = {
  achievements: number;
  suggestionAdds: number;
  // 中央値（日）。初めての達成がなければ null
  firstAchievementDays: number | null;
  clientErrors: number;
};

export type Usage = {
  at: Date;
  week: PeriodUsage;
  // 直近 4 週間。件数は 4 で割って週あたりにする（中央値はそのまま）
  fourWeeksPerWeek: PeriodUsage;
  stalePending: number;
  // 直近 4 週間で多いエラー（3 つまで）
  topErrors: ErrorCount[];
};

export interface UsageReporter {
  collect(): Promise<Usage>;
  format(usage: Usage): string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const STALE_DAYS = 90;
const TOP_ERRORS = 3;
// 目標値（metrics.md §6）。ほかは観測
const ACHIEVEMENTS_MIN = 1;

export class MetricsUsageReporter implements UsageReporter {
  readonly #source: UsageSource;
  readonly #now: () => Date;

  constructor(source: UsageSource, now: () => Date = () => new Date()) {
    this.#source = source;
    this.#now = now;
  }

  async collect(): Promise<Usage> {
    const at = this.#now();
    const weekAgo = new Date(at.getTime() - WEEK_MS);
    const fourWeeksAgo = new Date(at.getTime() - 4 * WEEK_MS);
    const week = await this.#period(weekAgo, at, 1);
    const fourWeeks = await this.#period(fourWeeksAgo, at, 4);
    const stalePending = await this.#source.stalePending(new Date(at.getTime() - STALE_DAYS * DAY_MS));
    const errors = await this.#source.clientErrors(fourWeeksAgo, at);
    return { at, week, fourWeeksPerWeek: fourWeeks, stalePending, topErrors: errors.slice(0, TOP_ERRORS) };
  }

  format(usage: Usage): string {
    const { week, fourWeeksPerWeek: four } = usage;
    const rows = [
      ["**週あたりの達成数**", this.#judged(week.achievements, week.achievements >= ACHIEVEMENTS_MIN), this.#judged(four.achievements, four.achievements >= ACHIEVEMENTS_MIN), `${ACHIEVEMENTS_MIN} 件以上`],
      ["提案から追加した件数", this.#number(week.suggestionAdds), this.#number(four.suggestionAdds), "観測"],
      ["追加から初回達成までの日数（中央値）", this.#days(week.firstAchievementDays), this.#days(four.firstAchievementDays), "観測"],
      ["frontend のエラー数", this.#judged(week.clientErrors, week.clientErrors === 0), this.#judged(four.clientErrors, four.clientErrors === 0), "0 件"],
      [`やりたいリストの滞留（作って ${STALE_DAYS} 日以上の pending）`, `${usage.stalePending}（今の件数）`, "", "観測"],
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

  async #period(from: Date, to: Date, weeks: number): Promise<PeriodUsage> {
    const errors = await this.#source.clientErrors(from, to);
    const seconds = await this.#source.firstAchievementSeconds(from, to);
    const median = this.#median(seconds);
    return {
      achievements: (await this.#source.achievements(from, to)) / weeks,
      suggestionAdds: (await this.#source.suggestionAdds(from, to)) / weeks,
      firstAchievementDays: median === null ? null : median / (DAY_MS / 1000),
      clientErrors: errors.reduce((sum, e) => sum + e.count, 0) / weeks,
    };
  }

  #median(values: number[]): number | null {
    if (values.length === 0) return null;
    const sorted = values.toSorted((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? (sorted[middle] ?? 0) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
  }

  #judged(value: number, ok: boolean): string {
    return `${this.#number(value)} ${ok ? "✓" : "✗"}`;
  }

  // 週あたりに割った値は小数 1 桁まで
  #number(value: number): string {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  }

  #days(value: number | null): string {
    return value === null ? "-" : `${value.toFixed(1)} 日`;
  }
}
