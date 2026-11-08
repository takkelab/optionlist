import type { Pool } from "pg";
import type { ErrorCount, UsageSource } from "./usage-report.ts";

type CountRow = { n: string };

// UsageSource の本物。日時は timestamptz なので、Date をそのまま渡して比べられる
export class PgUsageSource implements UsageSource {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  achievements(from: Date, to: Date): Promise<number> {
    return this.#count("SELECT COUNT(*) AS n FROM achievements WHERE achieved_at >= $1 AND achieved_at < $2", [from, to]);
  }

  suggestionAdds(from: Date, to: Date): Promise<number> {
    return this.#count("SELECT COUNT(*) AS n FROM options WHERE suggestion_id IS NOT NULL AND created_at >= $1 AND created_at < $2", [from, to]);
  }

  // 秒の端数は切り捨てる
  async firstAchievementSeconds(from: Date, to: Date): Promise<number[]> {
    const { rows } = await this.#pool.query<{ seconds: string }>(
      `SELECT floor(EXTRACT(EPOCH FROM f.first_at - o.created_at))::bigint AS seconds
         FROM options o
         JOIN (SELECT option_id, MIN(achieved_at) AS first_at FROM achievements GROUP BY option_id) f ON f.option_id = o.id
        WHERE f.first_at >= $1 AND f.first_at < $2`,
      [from, to],
    );
    return rows.map((row) => Number(row.seconds));
  }

  stalePending(before: Date): Promise<number> {
    return this.#count("SELECT COUNT(*) AS n FROM options WHERE status = 'pending' AND created_at < $1", [before]);
  }

  async clientErrors(from: Date, to: Date): Promise<ErrorCount[]> {
    const { rows } = await this.#pool.query<{ message: string | null; n: string }>(
      `SELECT payload->>'message' AS message, COUNT(*) AS n
         FROM events
        WHERE type = 'client_error' AND occurred_at >= $1 AND occurred_at < $2
        GROUP BY message
        ORDER BY n DESC, message`,
      [from, to],
    );
    return rows.map((row) => ({ message: String(row.message), count: Number(row.n) }));
  }

  async #count(sql: string, params: unknown[]): Promise<number> {
    const { rows } = await this.#pool.query<CountRow>(sql, params);
    return Number(rows[0]?.n ?? 0);
  }
}
