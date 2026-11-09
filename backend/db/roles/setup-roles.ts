// npm --prefix backend run db:roles（backend/.env）/ db:roles:test（backend/.env.test）/ db:roles:cloud（環境変数だけ）。data.md §4 のロールと DB を用意する
// --recreate: 持ち主が ol_migrator でない DB を消して作り直す。--test: 名前が _test で終わる DB だけを扱い、<名前>_migrations も片付ける
// --cloud --env staging|production: 確認用・本番（db:roles:cloud。infra/ が Cloud SQL Auth Proxy 越しの URL を環境変数で渡す。docs/decisions/0056）
import pg from "pg";
import { RoleSetup } from "./RoleSetup";
import type { AdminConnector, AdminSession } from "./AdminSql";

class AdminConnection implements AdminSession {
  readonly #client: pg.Client;

  constructor(client: pg.Client) {
    this.#client = client;
  }

  async rows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const { rows } = await this.#client.query(sql, params);
    return rows as T[];
  }

  async close(): Promise<void> {
    await this.#client.end();
  }
}

// ADMIN_DATABASE_URL の DB 名だけを変えてつなぐ
class AdminUrlConnector implements AdminConnector {
  readonly #url: string;

  constructor(url: string) {
    this.#url = url;
  }

  async connect(database: string): Promise<AdminSession> {
    const url = new URL(this.#url);
    url.pathname = `/${encodeURIComponent(database)}`;
    const client = new pg.Client({ connectionString: url.toString() });
    await client.connect();
    return new AdminConnection(client);
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
const envIndex = args.indexOf("--env");
const envName = envIndex === -1 ? undefined : args[envIndex + 1];
if (envName !== undefined && envName !== "staging" && envName !== "production") {
  console.error(`--env は staging か production（今は ${envName}）`);
  process.exit(1);
}
// db:roles:cloud（--cloud）で --env を忘れると、Cloud SQL の ol_migrator に LOGIN・CREATEDB が付いてしまうので止める
if (args.includes("--cloud") !== (envName !== undefined)) {
  console.error("確認用・本番は npm --prefix backend run db:roles:cloud -- --env <staging|production>（--env は db:roles:cloud だけで使う）");
  process.exit(1);
}
const adminUrl = env.ADMIN_DATABASE_URL ?? "";
const connector = new AdminUrlConnector(adminUrl);
const { pathname: adminPath } = new URL(adminUrl);
const admin = await connector.connect(decodeURIComponent(adminPath.slice(1)));
try {
  const done = await new RoleSetup(admin, connector).install(
    {
      migrator: env.DATABASE_URL ?? "",
      app: env.APP_DATABASE_URL ?? "",
      cleanup: env.CLEANUP_DATABASE_URL || undefined,
      metrics: env.METRICS_DATABASE_URL || undefined,
    },
    { recreate: args.includes("--recreate"), test: args.includes("--test"), env: envName },
  );
  for (const line of done) console.log(`- ${line}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await admin.close();
}
