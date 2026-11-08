// npm --prefix backend run db:perf-data。metrics.md §1 の性能用データをテスト用 DB（backend/.env.test）に入れる
import { PgDatabase } from "../../src/infra/PgDatabase";
import { PgPoolFactory } from "../../src/infra/PgPoolFactory";
import { PromMetrics } from "../../src/metrics/PromMetrics";
import { PERF_DATA_COUNTS, PerfDataGenerator, SeededRandom, TestDatabaseGuard } from "./PerfDataGenerator";

new TestDatabaseGuard().ensureSafe(process.env.DATABASE_URL);
const pool = new PgPoolFactory(process.env, console).create();
const started = performance.now();
try {
  const db = new PgDatabase(pool, new PromMetrics());
  await new PerfDataGenerator(db, PERF_DATA_COUNTS, new SeededRandom(20261101), new Date()).generate();
  console.log(`性能用データを入れた（${Math.round(performance.now() - started)}ms）`, PERF_DATA_COUNTS);
} finally {
  await pool.end();
}
