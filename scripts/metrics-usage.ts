// npm run metrics:usage。metrics.md §6 の利用状況を、直近 1 週間と 4 週間（週あたり）で表示する
// 接続先は backend/.env の DATABASE_URL（package.json で --env-file に渡す）
import pg from "pg";
import { PgUsageSource } from "./lib/pg-usage-source.ts";
import { MetricsUsageReporter } from "./lib/usage-report.ts";

const url = process.env.DATABASE_URL;
if (url === undefined) {
  console.error("DATABASE_URL がない。backend/.env.example を backend/.env にコピーして DATABASE_URL を入れる");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url, options: "-c TimeZone=UTC" });
try {
  const reporter = new MetricsUsageReporter(new PgUsageSource(pool));
  console.log(reporter.format(await reporter.collect()));
} finally {
  await pool.end();
}
