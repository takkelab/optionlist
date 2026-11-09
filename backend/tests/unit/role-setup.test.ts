import { describe, expect, it } from "vitest";
import { RoleSetup } from "../../db/roles/RoleSetup";
import type { AdminConnector, AdminSession, AdminSql } from "../../db/roles/AdminSql";

// db:roles:cloud（RoleSetup の env）が流す SQL（data.md §4。docs/decisions/0056）
// 手元のクラスタで流すと ol_* が NOLOGIN になって手元が壊れるので、流す SQL をフェイクで記録して確かめる。本物の Cloud SQL では infra:check が確かめる
type Role = { rolcanlogin: boolean; rolcreatedb: boolean; rolsuper: boolean; rolcreaterole: boolean; rolreplication: boolean; rolbypassrls: boolean };

// 別の DB につないだ先で流した SQL は「[DB 名] SQL」として同じ記録に残す
class RecordingSession implements AdminSession {
  readonly #database: string;
  readonly #parent: RecordingAdminSql;

  constructor(database: string, parent: RecordingAdminSql) {
    this.#database = database;
    this.#parent = parent;
  }

  async rows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.#parent.rowsIn(`[${this.#database}] `, sql, params);
  }

  async close(): Promise<void> {}
}

class RecordingAdminSql implements AdminSql, AdminConnector {
  readonly #statements: string[] = [];
  readonly #roles: Map<string, Role>;
  readonly #superuser: boolean;
  readonly #dbOwner: string | null;

  constructor(roles: Record<string, Role>, superuser: boolean, dbOwner: string | null) {
    this.#roles = new Map(Object.entries(roles));
    this.#superuser = superuser;
    this.#dbOwner = dbOwner;
  }

  all(): string[] {
    return [...this.#statements];
  }

  matching(test: (statement: string) => boolean): string[] {
    return this.#statements.filter(test);
  }

  last(): string | undefined {
    return this.#statements.at(-1);
  }

  async connect(database: string): Promise<AdminSession> {
    return new RecordingSession(database, this);
  }

  async rows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.rowsIn("", sql, params);
  }

  async rowsIn<T>(prefix: string, sql: string, params: unknown[]): Promise<T[]> {
    if (sql.startsWith("SELECT format(")) {
      const [template, values] = params as [string, string[]];
      let i = 0;
      const out = template.replace(/%[IL]/g, (spec) => {
        const value = values[i++] ?? "";
        return spec === "%I" ? `"${value}"` : `'${value}'`;
      });
      return [{ sql: out } as T];
    }
    if (sql.includes("FROM pg_roles WHERE rolname = current_user")) return [{ rolsuper: this.#superuser } as T];
    if (sql.includes("FROM pg_roles WHERE rolname = $1")) {
      const role = this.#roles.get(String(params[0]));
      return role === undefined ? [] : [role as T];
    }
    if (sql.includes("FROM pg_database")) return this.#dbOwner === null ? [] : [{ owner: this.#dbOwner } as T];
    this.#statements.push(`${prefix}${sql}`);
    return [];
  }
}

const MIGRATOR_URL = "postgres://ol_migrator_staging:m%40ss@127.0.0.1:5433/optionlist_staging";
const APP_URL = "postgres://ol_app_staging:app-pass@127.0.0.1:5433/optionlist_staging";
const URLS = { migrator: MIGRATOR_URL, app: APP_URL };
const OPTIONS = { recreate: false, test: false, env: "staging" as const };

describe("RoleSetup with --env", () => {
  it("creates NOLOGIN groups, env logins with their memberships, and a database only they can connect to", async () => {
    const sql = new RecordingAdminSql({}, false, null);
    await new RoleSetup(sql, sql).install(URLS, OPTIONS);
    expect(sql.all()).toEqual([
      'CREATE ROLE "ol_migrator" NOLOGIN',
      'CREATE ROLE "ol_app" NOLOGIN',
      'CREATE ROLE "ol_cleanup" NOLOGIN',
      'CREATE ROLE "ol_metrics" NOLOGIN',
      'CREATE ROLE "ol_definer" NOLOGIN',
      'CREATE ROLE "ol_incident" NOLOGIN',
      'CREATE ROLE "ol_owner_staging" NOLOGIN',
      'CREATE ROLE "ol_migrator_staging" LOGIN',
      `ALTER ROLE "ol_migrator_staging" PASSWORD 'm@ss'`,
      'CREATE ROLE "ol_app_staging" LOGIN',
      `ALTER ROLE "ol_app_staging" PASSWORD 'app-pass'`,
      "GRANT ol_definer TO ol_migrator WITH INHERIT FALSE, SET TRUE",
      'GRANT "ol_migrator" TO "ol_migrator_staging" WITH INHERIT FALSE, SET TRUE',
      `ALTER ROLE "ol_migrator_staging" SET role = 'ol_migrator'`,
      'GRANT "ol_app" TO "ol_app_staging" WITH INHERIT TRUE, SET FALSE',
      'ALTER ROLE "ol_app_staging" RESET role',
      // Cloud SQL の postgres は superuser ではないので、OWNER と権限の付け替えの間だけ ol_owner_staging への SET を借りる
      'GRANT "ol_owner_staging" TO CURRENT_USER WITH INHERIT FALSE, SET TRUE',
      // 持ち主は ol_migrator ではなく環境ごとの ol_owner_staging（確認用の ol_migrator_staging から本番の DB の権限を触れない）
      `CREATE DATABASE "optionlist_staging" OWNER "ol_owner_staging" ENCODING 'UTF8' TEMPLATE template0`,
      'SET ROLE "ol_owner_staging"',
      'REVOKE CONNECT, TEMPORARY ON DATABASE "optionlist_staging" FROM PUBLIC',
      'GRANT CONNECT ON DATABASE "optionlist_staging" TO "ol_migrator_staging"',
      'GRANT CONNECT ON DATABASE "optionlist_staging" TO "ol_app_staging"',
      'GRANT CONNECT ON DATABASE "optionlist_staging" TO SESSION_USER',
      "RESET ROLE",
      '[optionlist_staging] SET ROLE "ol_owner_staging"',
      "[optionlist_staging] GRANT USAGE, CREATE ON SCHEMA public TO ol_migrator WITH GRANT OPTION",
      "[optionlist_staging] RESET ROLE",
      'REVOKE "ol_owner_staging" FROM CURRENT_USER',
    ]);
  });

  // superuser でないと、NOSUPERUSER などを書くだけで拒まれる（今と同じ属性は書かない）
  it("alters only the attributes that differ from the existing roles", async () => {
    const off: Role = { rolcanlogin: false, rolcreatedb: false, rolsuper: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false };
    const roles = Object.fromEntries(["ol_migrator", "ol_app", "ol_cleanup", "ol_metrics", "ol_definer", "ol_incident", "ol_owner_staging"].map((name) => [name, off]));
    const sql = new RecordingAdminSql(
      { ...roles, ol_migrator: { ...off, rolcanlogin: true, rolcreatedb: true }, ol_migrator_staging: { ...off, rolcanlogin: true }, ol_app_staging: { ...off, rolcanlogin: true } },
      false,
      "ol_owner_staging",
    );
    await new RoleSetup(sql, sql).install(URLS, OPTIONS);
    expect(sql.matching((s) => s.startsWith("CREATE ROLE") || /^ALTER ROLE \S+ (NO)?(LOGIN|CREATEDB|SUPERUSER|CREATEROLE|REPLICATION|BYPASSRLS)\b/.test(s))).toEqual([
      'ALTER ROLE "ol_migrator" NOLOGIN NOCREATEDB',
    ]);
    expect(sql.all()).not.toContain(expect.stringContaining("CREATE DATABASE"));
  });

  it("does not borrow ol_owner_staging as a superuser", async () => {
    const sql = new RecordingAdminSql({}, true, null);
    await new RoleSetup(sql, sql).install(URLS, OPTIONS);
    expect(sql.matching((s) => s.includes("TO CURRENT_USER"))).toEqual([]);
  });

  // 前の形（持ち主が ol_migrator）の DB も、勝手に作り直さずに止まる
  it.each(["postgres", "ol_migrator"])("stops when the database belongs to %s", async (owner) => {
    const sql = new RecordingAdminSql({}, false, owner);
    await expect(new RoleSetup(sql, sql).install(URLS, OPTIONS)).rejects.toThrow(`持ち主が ${owner}`);
    // 借りた SET は失敗しても返す
    expect(sql.last()).toBe('REVOKE "ol_owner_staging" FROM CURRENT_USER');
  });

  it.each([
    [{ ...URLS, migrator: MIGRATOR_URL.replace("ol_migrator_staging", "ol_migrator") }, "ol_migrator_staging"],
    [{ ...URLS, app: APP_URL.replace("ol_app_staging", "ol_app_production") }, "ol_app_staging"],
    [{ ...URLS, migrator: MIGRATOR_URL.replace("optionlist_staging", "optionlist_production") }, "_staging で終わる"],
  ])("rejects URLs that do not belong to the environment", async (urls, message) => {
    await expect(new RoleSetup(new RecordingAdminSql({}, false, null), null).install(urls, OPTIONS)).rejects.toThrow(message);
  });

  it.each([{ recreate: true, test: false }, { recreate: false, test: true }])("refuses %o with --env", async (flags) => {
    await expect(new RoleSetup(new RecordingAdminSql({}, false, null), null).install(URLS, { ...flags, env: "staging" })).rejects.toThrow("--env");
  });
});
