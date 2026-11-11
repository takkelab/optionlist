import { readFileSync } from "node:fs";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DbmateCli } from "../fakes/DbmateCli";
import { ShortLivedConnection } from "../fakes/ShortLivedConnection";

// testing.md §7 の 2。最新までマイグレーションした DB の pg_catalog を読んで、RLS・ロール・認証の関数を確かめる
// マイグレーションのテストと同じ <テスト用 DB 名>_migrations を使う（ファイルは並列に流れない。vitest.config.ts）
// 「RLS coverage」の失敗の数が metrics.md §2 の「RLS の付け忘れ」になる（scripts/lib/command-collector.ts）
if (!process.env.DATABASE_URL || !process.env.APP_DATABASE_URL || !process.env.ADMIN_DATABASE_URL || !process.env.METRICS_DATABASE_URL) {
  throw new Error(
    "DATABASE_URL・APP_DATABASE_URL・ADMIN_DATABASE_URL・METRICS_DATABASE_URL が未設定です。backend/.env.test.example を参考に .env.test を作ってください（足したら db:roles:test を流し直す）",
  );
}
const migratorUrl = new URL(process.env.DATABASE_URL);
migratorUrl.pathname = `${migratorUrl.pathname}_migrations`;
const appUrl = new URL(process.env.APP_DATABASE_URL);
appUrl.pathname = migratorUrl.pathname;
const metricsUrl = new URL(process.env.METRICS_DATABASE_URL);
metricsUrl.pathname = migratorUrl.pathname;
// ロールの属性・メンバーシップ・持ち主の違反を入れる検査だけが使う（superuser。入れた違反はトランザクションで戻す）
const adminUrl = new URL(process.env.ADMIN_DATABASE_URL);
adminUrl.pathname = migratorUrl.pathname;

// RLS の対象外の表（data.md §4）。足すときは data.md §4 と docs/decisions/ にも理由を書く
const MASTER_TABLES = ["suggestion_tags", "suggestions", "tags", "themes"];
// ol_app が読めない表（events は INSERT だけ、auth_attempts は認証の関数を通してだけ触る）
const UNREADABLE_TABLES = ["auth_attempts", "events"];
const ALLOWLIST = [...MASTER_TABLES, ...UNREADABLE_TABLES, "schema_migrations"];

const sql = new ShortLivedConnection(migratorUrl.toString());
const migrator = new DbmateCli(migratorUrl.toString(), "db/migrations");
await migrator.drop();
await migrator.up();

const tables = (
  await sql.rows<{ name: string }>(
    "SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY 1",
  )
).map((r) => r.name);
const userTables = tables.filter((t) => !ALLOWLIST.includes(t));
// backend/db/checks/rls-checks.sql を「-- check: <名前>」で区切る
const checks = readFileSync("db/checks/rls-checks.sql", "utf8")
  .split(/^-- check: /m)
  .slice(1)
  .map((section): [string, string] => {
    const [name = "", ...body] = section.split("\n");
    return [name.trim(), body.join("\n")];
  });

type TableState = { rls: boolean; force: boolean; ownerNotNull: boolean; usingPolicy: boolean; checkPolicy: boolean };

afterAll(async () => {
  await migrator.drop();
});

describe("RLS coverage", () => {
  it("finds the user tables in data.md §4", () => {
    expect(userTables).toEqual(["achievements", "options", "users"]);
  });

  // 新しい表を足して RLS を付け忘れると、ここで 1 件落ちる
  it.each(userTables)("%s has RLS, FORCE, a NOT NULL owner column and an app.user_id policy", async (table) => {
    const column = table === "users" ? "id" : "user_id";
    const [state] = await sql.rows<TableState>(
      `SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS force,
              COALESCE((SELECT a.attnotnull FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = $2 AND NOT a.attisdropped), false) AS "ownerNotNull",
              EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = $1 AND p.qual LIKE '%app.user_id%') AS "usingPolicy",
              EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = $1 AND p.with_check LIKE '%app.user_id%') AS "checkPolicy"
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = $1`,
      [table, column],
    );
    expect(state).toEqual({ rls: true, force: true, ownerNotNull: true, usingPolicy: true, checkPolicy: true });
  });
});

describe("tables outside RLS", () => {
  it.each(UNREADABLE_TABLES)("ol_app cannot read %s", async (table) => {
    const [row] = await sql.rows<{ ok: boolean }>("SELECT has_table_privilege('ol_app', $1, 'SELECT') AS ok", [table]);
    expect(row).toEqual({ ok: false });
  });

  // マスターデータは全員に同じものを見せる表で、利用者の列を持たない
  it("keeps the user columns out of the master data", async () => {
    const rows = await sql.rows(
      "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ANY($1) AND column_name = 'user_id'",
      [MASTER_TABLES],
    );
    expect(rows).toEqual([]);
  });
});

describe("rls-checks.sql", () => {
  it("has the checks in testing.md §7", () => {
    expect(checks.length).toBeGreaterThanOrEqual(12);
  });

  it.each(checks)("%s finds no violations", async (_name, check) => {
    expect(await sql.rows(check)).toEqual([]);
  });

  // 検査がいつも 0 行を返す誤りを防ぐ。わざと違反を入れて（DDL もロールの変更もトランザクションで戻す）見つかることを確かめる
  const injected: [string, "migrator" | "admin", string[]][] = [
    ["no_bypassrls_or_superuser", "admin", ["ALTER ROLE ol_cleanup BYPASSRLS"]],
    ["app_owns_nothing", "admin", ["CREATE TABLE stray (id int)", "ALTER TABLE stray OWNER TO ol_app"]],
    ["one_app_policy_per_table", "migrator", ["CREATE POLICY extra ON options FOR SELECT TO ol_app USING (status = 'pending')"]],
    ["true_policies_only_for_strong_roles", "migrator", ["CREATE POLICY open ON achievements FOR SELECT TO PUBLIC USING (true)"]],
    ["app_is_not_a_member_of_other_roles", "admin", ["GRANT ol_incident TO ol_app"]],
    ["strong_role_memberships", "admin", ["GRANT ol_cleanup TO ol_metrics"]],
    ["incident_reads_only", "migrator", ["GRANT UPDATE ON users TO ol_incident"]],
    ["cleanup_cannot_insert_or_update", "migrator", ["GRANT INSERT ON options TO ol_cleanup"]],
    ["metrics_reads_only_usage_views", "migrator", ["GRANT SELECT ON options TO ol_metrics"]],
    ["usage_views_readers", "migrator", ["CREATE VIEW usage_stray AS SELECT 1 AS n", "GRANT SELECT ON usage_stray TO ol_app"]],
    [
      "auth_functions_are_definer_with_fixed_search_path",
      "migrator",
      ["SET ROLE ol_definer", "ALTER FUNCTION auth_find_user(bytea) SECURITY INVOKER", "RESET ROLE"],
    ],
    ["auth_functions_execute_only_by_app", "migrator", ["SET ROLE ol_definer", "GRANT EXECUTE ON FUNCTION auth_find_user(bytea) TO PUBLIC", "RESET ROLE"]],
    ["env_logins_hold_no_privileges", "admin", ["CREATE ROLE ol_app_staging LOGIN", "GRANT SELECT ON options TO ol_app_staging"]],
  ];

  // 確認用・本番のログイン用のロール（docs/decisions/0056）の誤った付け方
  const injectedEnvLogins: [string, string, string[]][] = [
    ["strong_role_memberships", "ol_migrator_staging が INHERIT", ["CREATE ROLE ol_migrator_staging LOGIN", "GRANT ol_migrator TO ol_migrator_staging WITH INHERIT TRUE, SET FALSE"]],
    ["strong_role_memberships", "ほかの名前のロールが SET", ["CREATE ROLE ol_app_staging LOGIN", "GRANT ol_cleanup TO ol_app_staging WITH INHERIT FALSE, SET TRUE"]],
    ["strong_role_memberships", "DB の持ち主に SET できる", ["CREATE ROLE ol_owner_production", "CREATE ROLE ol_migrator_staging LOGIN", "GRANT ol_owner_production TO ol_migrator_staging WITH INHERIT FALSE, SET TRUE"]],
    ["strong_role_memberships", "環境の名前の違う SET",["CREATE ROLE ol_migrator_preview LOGIN", "GRANT ol_migrator TO ol_migrator_preview WITH INHERIT FALSE, SET TRUE"]],
    ["app_is_not_a_member_of_other_roles", "ol_app_staging が ol_metrics のメンバー", ["CREATE ROLE ol_app_staging LOGIN", "GRANT ol_app TO ol_app_staging", "GRANT ol_metrics TO ol_app_staging"]],
    ["app_owns_nothing", "ol_app_production が表の持ち主", ["CREATE ROLE ol_app_production LOGIN", "CREATE TABLE stray (id int)", "ALTER TABLE stray OWNER TO ol_app_production"]],
    ["auth_functions_execute_only_by_app", "ol_metrics_staging が ol_app を引き継ぐ", ["CREATE ROLE ol_metrics_staging LOGIN", "GRANT ol_app TO ol_metrics_staging"]],
  ];

  const violationsAfter = async (as: "migrator" | "admin", statements: string[], check: string): Promise<unknown[]> => {
    const client = new pg.Client({ connectionString: (as === "admin" ? adminUrl : migratorUrl).toString() });
    await client.connect();
    try {
      await client.query("BEGIN");
      for (const statement of statements) await client.query(statement);
      const { rows } = await client.query(check);
      return rows;
    } finally {
      await client.query("ROLLBACK");
      await client.end();
    }
  };
  const checksByName = new Map(checks);
  const checkNamed = (name: string): string => checksByName.get(name) ?? "";

  it("injects a violation into every check", () => {
    expect(injected.map(([name]) => name).toSorted()).toEqual(checks.map(([name]) => name).toSorted());
  });

  it.each(injected)("%s finds an injected violation", async (name, as, statements) => {
    expect((await violationsAfter(as, statements, checkNamed(name))).length).toBeGreaterThan(0);
  });

  it.each(injectedEnvLogins)("%s finds an env login violation（%s）", async (name, _label, statements) => {
    expect((await violationsAfter("admin", statements, checkNamed(name))).length).toBeGreaterThan(0);
  });

  // db:roles:cloud（RoleSetup の env）が作る形。どの検査も 0 行のまま（docs/decisions/0056）
  it.each(checks)("%s accepts the env login roles from db:roles:cloud", async (_name, check) => {
    const statements = ["staging", "production"].flatMap((env) => [
      `CREATE ROLE ol_owner_${env}`,
      `CREATE ROLE ol_migrator_${env} LOGIN`,
      `GRANT ol_migrator TO ol_migrator_${env} WITH INHERIT FALSE, SET TRUE`,
      `CREATE ROLE ol_cleanup_${env} LOGIN`,
      `GRANT ol_cleanup TO ol_cleanup_${env} WITH INHERIT FALSE, SET TRUE`,
      `CREATE ROLE ol_app_${env} LOGIN`,
      `GRANT ol_app TO ol_app_${env} WITH INHERIT TRUE, SET FALSE`,
      `CREATE ROLE ol_metrics_${env} LOGIN`,
      `GRANT ol_metrics TO ol_metrics_${env} WITH INHERIT TRUE, SET FALSE`,
    ]);
    expect(await violationsAfter("admin", statements, check)).toEqual([]);
  });
});

describe("RLS for ol_app", () => {
  const app = new pg.Client({ connectionString: appUrl.toString() });

  beforeAll(async () => {
    await sql.rows(
      `INSERT INTO users (id, session_hash, created_at, last_seen_at) OVERRIDING SYSTEM VALUE VALUES (1, '\\x0a', now(), now()), (2, '\\x0b', now(), now())`,
    );
    await sql.rows(
      `INSERT INTO options (id, user_id, title, sort_order, created_at, updated_at) OVERRIDING SYSTEM VALUE VALUES
       (1, 1, 'A の項目', 0, now(), now()), (2, 2, 'B の項目', 0, now(), now())`,
    );
    await sql.rows("INSERT INTO achievements (user_id, option_id, achieved_at) VALUES (1, 1, now()), (2, 2, now())");
    // ID を書いて入れたので、auth_create_user が作る人の ID が重ならないよう identity を進める
    await sql.rows("SELECT setval(pg_get_serial_sequence('users', 'id'), 2)");
    await app.connect();
  });

  afterAll(async () => {
    await app.end();
  });

  it("shows only B's rows in every table to B", async () => {
    await app.query("BEGIN");
    try {
      await app.query("SELECT set_config('app.user_id', '2', true)");
      const { rows } = await app.query(
        `SELECT (SELECT array_agg(id) FROM users) AS users, (SELECT array_agg(user_id) FROM options) AS options,
                (SELECT array_agg(user_id) FROM achievements) AS achievements`,
      );
      expect(rows).toEqual([{ users: ["2"], options: ["2"], achievements: ["2"] }]);
    } finally {
      await app.query("ROLLBACK");
    }
  });

  // 42501 は RLS の WITH CHECK 違反（insufficient_privilege）
  it("rejects writing a row with A's user_id as B", async () => {
    for (const statement of [
      "INSERT INTO options (user_id, title, sort_order, created_at, updated_at) VALUES (1, 'x', 0, now(), now())",
      "UPDATE options SET user_id = 1 WHERE id = 2",
      "INSERT INTO achievements (user_id, option_id, achieved_at) VALUES (1, 1, now())",
    ]) {
      await app.query("BEGIN");
      try {
        await app.query("SELECT set_config('app.user_id', '2', true)");
        await expect(app.query(statement)).rejects.toMatchObject({ code: "42501" });
      } finally {
        await app.query("ROLLBACK");
      }
    }
  });

  it("does not touch A's rows from B", async () => {
    await app.query("BEGIN");
    try {
      await app.query("SELECT set_config('app.user_id', '2', true)");
      const updated = await app.query("UPDATE options SET title = 'x' WHERE id = 1");
      const deleted = await app.query("DELETE FROM achievements WHERE user_id = 1");
      expect([updated.rowCount, deleted.rowCount]).toEqual([0, 0]);
    } finally {
      await app.query("ROLLBACK");
    }
    expect(await sql.rows("SELECT title FROM options WHERE id = 1")).toEqual([{ title: "A の項目" }]);
  });

  // 一度も設定していない接続では NULL、一度 SET LOCAL した接続ではトランザクションのあとも空文字が返る。どちらもエラーにならず 0 行
  it("shows nothing without app.user_id, also after a SET LOCAL has ended", async () => {
    const count = "SELECT (SELECT count(*) FROM users) + (SELECT count(*) FROM options) + (SELECT count(*) FROM achievements) AS n";
    const fresh = new pg.Client({ connectionString: appUrl.toString() });
    await fresh.connect();
    try {
      const { rows: before } = await fresh.query(count);
      expect(before).toEqual([{ n: "0" }]);
      await fresh.query("BEGIN");
      await fresh.query("SELECT set_config('app.user_id', '1', true)");
      await fresh.query("COMMIT");
      const { rows: setting } = await fresh.query("SELECT current_setting('app.user_id', true) AS v");
      expect(setting).toEqual([{ v: "" }]);
      const { rows: after } = await fresh.query(count);
      expect(after).toEqual([{ n: "0" }]);
    } finally {
      await fresh.end();
    }
  });
});

// ol_metrics は集計のビューだけを読み、表は 1 つも読めない（docs/decisions/0043。testing.md §7）
// ビューは持ち主の ol_definer の権限と USING (true) のポリシーで読むので、RLS で 0 件にならず 2 人分を数える
describe("ol_metrics", () => {
  const metrics = new pg.Client({ connectionString: metricsUrl.toString() });

  beforeAll(async () => {
    await metrics.connect();
  });

  afterAll(async () => {
    await metrics.end();
  });

  it.each(tables)("cannot read the table %s", async (table) => {
    // 表の名前は pg_class から読んだもの（入力ではない）
    await expect(metrics.query(`SELECT 1 FROM "${table}" LIMIT 1`)).rejects.toMatchObject({ code: "42501" });
  });

  it("reads the usage views, counting every user's rows", async () => {
    const { rows } = await metrics.query("SELECT active_users, achievers, achievements FROM usage_periods WHERE period = 'week'");
    expect(rows).toEqual([{ active_users: "2", achievers: "2", achievements: "2" }]);
    for (const view of ["usage_retention", "usage_stale_pending", "usage_client_error_messages"]) {
      await expect(metrics.query(`SELECT * FROM ${view}`)).resolves.toBeDefined();
    }
  });
});

describe("auth functions", () => {
  const app = new pg.Client({ connectionString: appUrl.toString() });

  beforeAll(async () => {
    await app.connect();
  });

  afterAll(async () => {
    await app.end();
  });

  it("finds a user by the session hash and nothing for an unknown hash", async () => {
    const { rows } = await app.query("SELECT user_id FROM auth_find_user('\\x0a')");
    expect(rows).toEqual([{ user_id: "1" }]);
    const { rows: unknown } = await app.query("SELECT user_id FROM auth_find_user('\\xff')");
    expect(unknown).toEqual([]);
  });

  // 1 つの IP から 1 時間に 20 件まで（api.md §6）。断った試行は数えない（docs/decisions/0048）
  it("creates 20 accounts from one IP in an hour, then answers rate_limited with retry_after_seconds", async () => {
    const statuses: string[] = [];
    for (let i = 0; i < 21; i++) {
      const { rows } = await app.query("SELECT status, user_id, retry_after_seconds FROM auth_create_user($1, '\\x01')", [Buffer.from(`s${i}`)]);
      const [row] = rows as { status: string; user_id: string | null; retry_after_seconds: number | null }[];
      statuses.push(row?.status ?? "");
      if (i === 20) {
        expect(row?.user_id).toBeNull();
        expect(row?.retry_after_seconds).toBeGreaterThanOrEqual(3500);
        expect(row?.retry_after_seconds).toBeLessThanOrEqual(3600);
      }
    }
    expect(statuses).toEqual([...Array<string>(20).fill("ok"), "rate_limited"]);
    const { rows: other } = await app.query("SELECT status FROM auth_create_user('\\x7f', '\\x02')");
    expect(other).toEqual([{ status: "ok" }]);
    expect(await sql.rows("SELECT kind, count(*)::int AS n FROM auth_attempts GROUP BY kind")).toEqual([{ kind: "create_account", n: 21 }]);
  });

  // いちばん古い 1 件が 1 時間の外に出たら、断られたあとでも 1 件だけまた作れる（断った試行が窓を延ばさない）
  it("lets the IP create one more account once the oldest one leaves the hour", async () => {
    await sql.rows(
      `UPDATE auth_attempts SET occurred_at = now() - interval '61 minutes'
        WHERE id = (SELECT min(id) FROM auth_attempts WHERE ip_hash = '\\x01')`,
    );
    const { rows: again } = await app.query("SELECT status FROM auth_create_user('\\x7e', '\\x01')");
    expect(again).toEqual([{ status: "ok" }]);
    const { rows: limited } = await app.query("SELECT status FROM auth_create_user('\\x7d', '\\x01')");
    expect(limited).toEqual([{ status: "rate_limited" }]);
  });

  it("does not let the migrator call the auth functions", async () => {
    await expect(sql.rows("SELECT * FROM auth_find_user('\\x0a')")).rejects.toMatchObject({ code: "42501" });
  });
});
