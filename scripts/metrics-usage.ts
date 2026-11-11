// npm run metrics:usage [-- --env <staging|production>]。metrics.md §6 の利用状況を、直近 1 週間と 4 週間（週あたり）で表示する
// 読むのは ol_metrics で、集計のビュー（usage_*）だけ（docs/decisions/0043）
// 手元: backend/.env の METRICS_DATABASE_URL（package.json で --env-file に渡す）
// --env: Cloud SQL Auth Proxy を起動し、秘密の値 optionlist-<env>-metrics-database-url のパスワードで ol_metrics_<env> としてつなぐ
//        （PowerShell では「METRICS_DATABASE_URL=… npm run …」と書けないため。docs/decisions/0060）
import pg from "pg";
import { ENV_NAMES, envConfig, passwordOf } from "../infra/config.ts";
import { CloudSqlProxy, readSecret } from "../infra/lib/cloud-sql.ts";
import { CliGcloud } from "../infra/lib/gcloud.ts";
import { PgUsageSource } from "./lib/pg-usage-source.ts";
import { MetricsUsageReporter } from "./lib/usage-report.ts";

const report = async (url: string): Promise<void> => {
  const pool = new pg.Pool({ connectionString: url, options: "-c TimeZone=UTC" });
  try {
    const reporter = new MetricsUsageReporter(new PgUsageSource(pool));
    console.log(reporter.format(await reporter.collect()));
  } finally {
    await pool.end();
  }
};

const args = process.argv.slice(2);
const envIndex = args.indexOf("--env");
try {
  if (envIndex === -1) {
    const url = process.env.METRICS_DATABASE_URL;
    if (url === undefined || url === "") {
      throw new Error("METRICS_DATABASE_URL がない。backend/.env.example を見て backend/.env に書き足し、npm --prefix backend run db:roles を流し直す");
    }
    await report(url);
  } else {
    const env = ENV_NAMES.find((name) => name === args[envIndex + 1]);
    if (env === undefined) throw new Error("使い方: npm run metrics:usage [-- --env <staging|production>]");
    const c = envConfig(env);
    const password = passwordOf(readSecret(new CliGcloud(false), c.secrets.metricsDatabaseUrl));
    const proxy = await CloudSqlProxy.start();
    try {
      await report(proxy.url(c.roles.metrics, password, c.database));
    } finally {
      proxy.stop();
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
