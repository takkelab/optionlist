import type { Pool } from "pg";
import type { ErrorCount, PeriodCounts, Retention, UsageSource } from "./usage-report.ts";

// UsageSource の本物。ol_metrics で集計のビュー（usage_*。backend/db/migrations の usage_views）だけを読む
// ol_metrics は表を読めないので、ここに表の名前を書いても権限のエラーになる（docs/decisions/0043）
// count(*) は bigint なので文字列で返る。数に直す

type PeriodRow = {
  period: string;
  active_users: string;
  achievers: string;
  achievements: string;
  suggestion_adds: string;
  first_achievement_days_median: number | null;
  client_errors: string;
};

export class PgUsageSource implements UsageSource {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async periods(): Promise<{ week: PeriodCounts; fourWeeks: PeriodCounts }> {
    const { rows } = await this.#pool.query<PeriodRow>(
      `SELECT period, active_users, achievers, achievements, suggestion_adds, first_achievement_days_median, client_errors
         FROM usage_periods`,
    );
    const pick = (period: string): PeriodCounts => {
      const row = rows.find((r) => r.period === period);
      if (row === undefined) throw new Error(`usage_periods に ${period} の行がない`);
      return {
        activeUsers: Number(row.active_users),
        achievers: Number(row.achievers),
        achievements: Number(row.achievements),
        suggestionAdds: Number(row.suggestion_adds),
        firstAchievementDaysMedian: row.first_achievement_days_median,
        clientErrors: Number(row.client_errors),
      };
    };
    return { week: pick("week"), fourWeeks: pick("four_weeks") };
  }

  async retention(): Promise<Retention> {
    const { rows } = await this.#pool.query<{ cohort: string; retained: string }>("SELECT cohort, retained FROM usage_retention");
    return { cohort: Number(rows[0]?.cohort ?? 0), retained: Number(rows[0]?.retained ?? 0) };
  }

  async stalePendingMedian(): Promise<number | null> {
    const { rows } = await this.#pool.query<{ median: number | null }>("SELECT median FROM usage_stale_pending");
    return rows[0]?.median ?? null;
  }

  async topClientErrors(): Promise<ErrorCount[]> {
    const { rows } = await this.#pool.query<{ message: string | null; errors: string }>(
      "SELECT message, errors FROM usage_client_error_messages ORDER BY errors DESC, message",
    );
    // payload に message がない行は 1 つにまとまって NULL で返る
    return rows.map((row) => ({ message: row.message ?? "（メッセージなし）", count: Number(row.errors) }));
  }
}
