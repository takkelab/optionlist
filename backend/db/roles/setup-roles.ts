// npm --prefix backend run db:roles（backend/.env）/ db:roles:test（backend/.env.test）。data.md §4 のロールと DB を用意する
// --recreate: 持ち主が ol_migrator でない DB を消して作り直す。--test: 名前が _test で終わる DB だけを扱い、<名前>_migrations も片付ける
import pg from "pg";
import { RoleSetup } from "./RoleSetup";
import type { AdminSql } from "./RoleSetup";

class AdminConnection implements AdminSql {
  readonly #client: pg.Client;

  constructor(client: pg.Client) {
    this.#client = client;
  }

  async rows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const { rows } = await this.#client.query(sql, params);
    return rows as T[];
  }
}

const env = process.env;
const required = ["ADMIN_DATABASE_URL", "DATABASE_URL", "APP_DATABASE_URL"].filter((name) => (env[name] ?? "") === "");
if (required.length > 0) {
  console.error(`${required.join("・")} が未設定です。backend/.env.example（テストは .env.test.example）を参考に設定してください`);
  process.exit(1);
}
const { argv } = process;
const args = argv.slice(2);
const client = new pg.Client({ connectionString: env.ADMIN_DATABASE_URL });
await client.connect();
try {
  const done = await new RoleSetup(new AdminConnection(client)).install(
    {
      migrator: env.DATABASE_URL ?? "",
      app: env.APP_DATABASE_URL ?? "",
      cleanup: env.CLEANUP_DATABASE_URL || undefined,
      metrics: env.METRICS_DATABASE_URL || undefined,
    },
    { recreate: args.includes("--recreate"), test: args.includes("--test") },
  );
  for (const line of done) console.log(`- ${line}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await client.end();
}
