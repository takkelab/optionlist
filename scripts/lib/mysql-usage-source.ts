import type { Pool, RowDataPacket } from "mysql2/promise";
import type { ErrorCount, UsageSource } from "./usage-report.ts";

// UsageSource の本物。DATETIME は UTC で入っている（backend と同じく timezone: "Z" のプールを渡す）
export class MySqlUsageSource implements UsageSource {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  achievements(from: Date, to: Date): Promise<number> {
    return this.#count("SELECT COUNT(*) AS n FROM achievements WHERE achieved_at >= ? AND achieved_at < ?", [from, to]);
  }

  suggestionAdds(from: Date, to: Date): Promise<number> {
    return this.#count("SELECT COUNT(*) AS n FROM options WHERE suggestion_id IS NOT NULL AND created_at >= ? AND created_at < ?", [from, to]);
  }

  async firstAchievementSeconds(from: Date, to: Date): Promise<number[]> {
    const [rows] = await this.#pool.query<RowDataPacket[]>(
      `SELECT TIMESTAMPDIFF(SECOND, o.created_at, f.first_at) AS seconds
         FROM options o
         JOIN (SELECT option_id, MIN(achieved_at) AS first_at FROM achievements GROUP BY option_id) f ON f.option_id = o.id
        WHERE f.first_at >= ? AND f.first_at < ?`,
      [from, to],
    );
    return rows.map((row) => Number(row.seconds));
  }

  stalePending(before: Date): Promise<number> {
    return this.#count("SELECT COUNT(*) AS n FROM options WHERE status = 'pending' AND created_at < ?", [before]);
  }

  async clientErrors(from: Date, to: Date): Promise<ErrorCount[]> {
    const [rows] = await this.#pool.query<RowDataPacket[]>(
      `SELECT JSON_UNQUOTE(JSON_EXTRACT(payload, '$.message')) AS message, COUNT(*) AS n
         FROM events
        WHERE type = 'client_error' AND occurred_at >= ? AND occurred_at < ?
        GROUP BY message
        ORDER BY n DESC, message`,
      [from, to],
    );
    return rows.map((row) => ({ message: String(row.message), count: Number(row.n) }));
  }

  async #count(sql: string, params: unknown[]): Promise<number> {
    const [rows] = await this.#pool.query<RowDataPacket[]>(sql, params);
    return Number(rows[0]?.n ?? 0);
  }
}
