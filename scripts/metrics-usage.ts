// npm run metrics:usage。metrics.md §6 の利用状況を、直近 1 週間と 4 週間（週あたり）で表示する
// 接続先は backend/.env の DATABASE_URL（package.json で --env-file に渡す）
import { createPool } from "mysql2/promise";
import { MySqlUsageSource } from "./lib/mysql-usage-source.ts";
import { MetricsUsageReporter } from "./lib/usage-report.ts";

const url = process.env.DATABASE_URL;
if (url === undefined) {
  console.error("DATABASE_URL がない。backend/.env.example を backend/.env にコピーして DATABASE_URL を入れる");
  process.exit(1);
}

const pool = createPool({ uri: url, timezone: "Z" });
try {
  const reporter = new MetricsUsageReporter(new MySqlUsageSource(pool));
  console.log(reporter.format(await reporter.collect()));
} finally {
  await pool.end();
}
