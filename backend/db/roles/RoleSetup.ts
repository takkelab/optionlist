// data.md §4 のロールと、マイグレーションを流す DB を用意する（npm --prefix backend run db:roles / db:roles:test / db:roles:cloud）
// ロールはクラスタ全体のものなので、マイグレーション（DB ごと）ではなく、管理用のユーザー（ADMIN_DATABASE_URL）でここで作る
// 何度流しても同じ結果になる。表の権限・ポリシー・関数はマイグレーションで付ける
// 確認用・本番（env）は、共用の Cloud SQL で環境ごとにログイン用のロールを分ける（docs/decisions/0056）。
// Cloud SQL の管理用ユーザー（postgres）は superuser ではないので、superuser でなくても通る SQL だけを流す

import type { AdminConnector, AdminSql } from "./AdminSql";

export type RoleUrls = {
  // ol_migrator（dbmate）。この URL の DB を ol_migrator の持ち物として用意する
  migrator: string;
  // ol_app（アプリ）
  app: string;
  // ol_cleanup・ol_metrics（R9・R10 で使う）。なければパスワードを付けない（env ではログイン用のロールを作らない）
  cleanup?: string;
  metrics?: string;
};

export type DeployedEnv = "staging" | "production";

export type DatabaseOptions = {
  // 持ち主が ol_migrator でない DB を消して作り直す（env では使えない）
  recreate: boolean;
  // テスト用 DB（名前が _test で終わる）だけを扱い、持ち主にかかわらずいつも作り直す（別のブランチのマイグレーションの表を残さない）
  // マイグレーションのテストの <名前>_migrations も消す
  test: boolean;
  // 確認用・本番。ol_* はログインしないグループのロールにし、<ロール>_<env> のログイン用のロールを作る（docs/decisions/0056）
  env?: DeployedEnv;
};

// never: 持ち主が違えば止まる / foreign: 持ち主が違えば消す / always: いつも消す
type DropWhen = "never" | "foreign" | "always";

export interface RoleInstaller {
  install(urls: RoleUrls, options: DatabaseOptions): Promise<string[]>;
}

// ログイン用のロールがグループのロールをどう使うか。inherit: 権限を引き継ぐ（ポリシーも効く）/ set: 接続したら SET ROLE した状態にする
// set は強いロール（ol_migrator・ol_cleanup）用。引き継がないので、ログイン用のロールのままでは何もできない（data.md §4）
type Membership = { group: string; use: "inherit" | "set" };
type RoleSpec = { name: string; login: boolean; createdb: boolean; url?: string; member?: Membership };
type RoleRow = { rolcanlogin: boolean; rolcreatedb: boolean; rolsuper: boolean; rolcreaterole: boolean; rolreplication: boolean; rolbypassrls: boolean };
type OwnerRow = { owner: string };

const ATTRIBUTE_KEYWORDS: Record<keyof RoleRow, string> = {
  rolcanlogin: "LOGIN",
  rolcreatedb: "CREATEDB",
  rolsuper: "SUPERUSER",
  rolcreaterole: "CREATEROLE",
  rolreplication: "REPLICATION",
  rolbypassrls: "BYPASSRLS",
};
const MIGRATOR = "ol_migrator";
const APP = "ol_app";
const GROUPS = [MIGRATOR, APP, "ol_cleanup", "ol_metrics", "ol_definer", "ol_incident"];

export class RoleSetup implements RoleInstaller {
  readonly #sql: AdminSql;
  readonly #connector: AdminConnector | null;

  // connector は env のときだけ要る
  constructor(sql: AdminSql, connector: AdminConnector | null = null) {
    this.#sql = sql;
    this.#connector = connector;
  }

  // してきたことを 1 行ずつ返す（エントリーポイントが表示する）
  async install(urls: RoleUrls, options: DatabaseOptions): Promise<string[]> {
    if (options.env !== undefined && (options.recreate || options.test)) {
      throw new Error("--env は --recreate・--test と一緒に使わない（確認用・本番の DB は消さない）");
    }
    const suffix = options.env === undefined ? "" : `_${options.env}`;
    this.#expectUser(urls.migrator, `${MIGRATOR}${suffix}`, "DATABASE_URL");
    this.#expectUser(urls.app, `${APP}${suffix}`, "APP_DATABASE_URL");
    for (const [url, role, envName] of [[urls.cleanup, "ol_cleanup", "CLEANUP_DATABASE_URL"], [urls.metrics, "ol_metrics", "METRICS_DATABASE_URL"]] as const) {
      if (url !== undefined) this.#expectUser(url, `${role}${suffix}`, envName);
    }
    const specs = options.env === undefined ? this.#localSpecs(urls) : this.#envSpecs(urls, options.env);
    const done: string[] = [];
    for (const spec of specs) done.push(await this.#ensureRole(spec));
    // 関数とビューの持ち主を ol_definer にするために SET ROLE だけができる（権限は引き継がない。data.md §4）
    await this.#sql.rows(`GRANT ol_definer TO ${MIGRATOR} WITH INHERIT FALSE, SET TRUE`);
    done.push("ol_definer → ol_migrator（INHERIT FALSE, SET TRUE）");
    for (const spec of specs) if (spec.member !== undefined) done.push(await this.#ensureMembership(spec.name, spec.member));
    const name = this.#databaseName(urls.migrator, options);
    if (options.env !== undefined) {
      const logins = specs.filter((s) => s.login).map((s) => s.name);
      done.push(...(await this.#ensureEnvDatabase(name, `ol_owner_${options.env}`, logins)));
      return done;
    }
    const dropWhen: DropWhen = options.test ? "always" : options.recreate ? "foreign" : "never";
    done.push(await this.#ensureDatabase(name, dropWhen, true));
    if (options.test) done.push(await this.#ensureDatabase(`${name}_migrations`, "always", false));
    return done;
  }

  // 手元・CI: ol_* にそのままログインする
  #localSpecs(urls: RoleUrls): RoleSpec[] {
    // ol_migrator の CREATEDB は、手元と CI で dbmate が DB を作り、マイグレーションのテストが DB を消して作り直すため（docs/decisions/0048）
    return [
      { name: MIGRATOR, login: true, createdb: true, url: urls.migrator },
      { name: APP, login: true, createdb: false, url: urls.app },
      { name: "ol_cleanup", login: true, createdb: false, url: urls.cleanup },
      { name: "ol_metrics", login: true, createdb: false, url: urls.metrics },
      { name: "ol_definer", login: false, createdb: false },
      { name: "ol_incident", login: false, createdb: false },
    ];
  }

  // 確認用・本番: ol_* はログインしない。ログイン用のロールは自分の環境の DB にだけつなげる（docs/decisions/0056）
  // マイグレーションは Cloud Run Job の dbmate migrate で流すので、DB を作らない（CREATEDB を付けない）
  #envSpecs(urls: RoleUrls, env: DeployedEnv): RoleSpec[] {
    // ol_owner_<env>: この環境の DB の持ち主。誰もメンバーにしない（docs/decisions/0056）
    const groups: RoleSpec[] = [...GROUPS, `ol_owner_${env}`].map((name) => ({ name, login: false, createdb: false }));
    const logins: RoleSpec[] = [
      { name: `${MIGRATOR}_${env}`, login: true, createdb: false, url: urls.migrator, member: { group: MIGRATOR, use: "set" } },
      { name: `${APP}_${env}`, login: true, createdb: false, url: urls.app, member: { group: APP, use: "inherit" } },
    ];
    if (urls.cleanup !== undefined) {
      logins.push({ name: `ol_cleanup_${env}`, login: true, createdb: false, url: urls.cleanup, member: { group: "ol_cleanup", use: "set" } });
    }
    if (urls.metrics !== undefined) {
      logins.push({ name: `ol_metrics_${env}`, login: true, createdb: false, url: urls.metrics, member: { group: "ol_metrics", use: "inherit" } });
    }
    return [...groups, ...logins];
  }

  // 名前とパスワードは識別子・文字列として format で引用してから流す（ALTER ROLE はプレースホルダを取れない）
  // 属性は、今の値と違うものだけを ALTER する（superuser でないと、NOSUPERUSER などを書くだけで拒まれる）
  async #ensureRole(spec: RoleSpec): Promise<string> {
    const want = { rolcanlogin: spec.login, rolcreatedb: spec.createdb, rolsuper: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false };
    const keys = Object.keys(want) as (keyof RoleRow)[];
    // 属性の列名と、ALTER ROLE の書き方（LOGIN / NOLOGIN）
    const flagOf = (key: keyof RoleRow, value: boolean) => `${value ? "" : "NO"}${ATTRIBUTE_KEYWORDS[key]}`;
    const flags = keys.map((key) => flagOf(key, want[key])).join(" ");
    const [row] = await this.#sql.rows<RoleRow>(
      "SELECT rolcanlogin, rolcreatedb, rolsuper, rolcreaterole, rolreplication, rolbypassrls FROM pg_roles WHERE rolname = $1",
      [spec.name],
    );
    if (row === undefined) {
      // CREATE ROLE は false の属性を書いても superuser を求めないが、既定値と同じなので、true のものだけを書く
      const on = keys.filter((key) => want[key]).map((key) => flagOf(key, true));
      await this.#sql.rows(await this.#format(`CREATE ROLE %I ${on.length === 0 ? "NOLOGIN" : on.join(" ")}`, [spec.name]));
    } else {
      const changed = keys.filter((key) => row[key] !== want[key]).map((key) => flagOf(key, want[key]));
      if (changed.length > 0) await this.#sql.rows(await this.#format(`ALTER ROLE %I ${changed.join(" ")}`, [spec.name]));
    }
    const password = spec.url === undefined ? "" : decodeURIComponent(new URL(spec.url).password);
    if (password !== "") await this.#sql.rows(await this.#format("ALTER ROLE %I PASSWORD %L", [spec.name, password]));
    return `${spec.name}（${flags}${password === "" ? "" : "、パスワードあり"}）`;
  }

  async #ensureMembership(name: string, member: Membership): Promise<string> {
    const inherit = member.use === "inherit" ? "TRUE" : "FALSE";
    const set = member.use === "set" ? "TRUE" : "FALSE";
    await this.#sql.rows(await this.#format(`GRANT %I TO %I WITH INHERIT ${inherit}, SET ${set}`, [member.group, name]));
    // set: 接続した時点で SET ROLE した状態にする（作った表の持ち主がグループのロールになる。RESET ROLE でもここに戻る）
    const roleDefault = member.use === "set" ? this.#format("ALTER ROLE %I SET role = %L", [name, member.group]) : this.#format("ALTER ROLE %I RESET role", [name]);
    await this.#sql.rows(await roleDefault);
    return `${member.group} → ${name}（INHERIT ${inherit}, SET ${set}${member.use === "set" ? "、接続したら SET ROLE" : ""}）`;
  }

  async #ensureDatabase(name: string, dropWhen: DropWhen, create: boolean): Promise<string> {
    const [row] = await this.#sql.rows<OwnerRow>(
      "SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname = $1",
      [name],
    );
    if (row !== undefined && row.owner === MIGRATOR && dropWhen !== "always") return `${name}（そのまま。持ち主は ${MIGRATOR}）`;
    if (row !== undefined) {
      if (dropWhen === "never") {
        throw new Error(
          `DB ${name} の持ち主が ${row.owner} です。中のデータを消して ${MIGRATOR} の持ち物として作り直すなら --recreate を付けて流してください（npm --prefix backend run db:roles -- --recreate）`,
        );
      }
      await this.#sql.rows(await this.#format("DROP DATABASE %I WITH (FORCE)", [name]));
    }
    if (!create) return `${name}（消した。マイグレーションのテストが作る）`;
    await this.#sql.rows(await this.#format(`CREATE DATABASE %I OWNER ${MIGRATOR} ENCODING 'UTF8' TEMPLATE template0`, [name]));
    return `${name}（${row === undefined ? "作った" : "作り直した"}。持ち主は ${MIGRATOR}）`;
  }

  // 確認用・本番の DB。持ち主は環境ごとの ol_owner_<env>（どのログイン用のロールからも届かない）。持ち主が違えば止まる（消さない）
  // DB の持ち主と権限はクラスタ全体の pg_database にあるので、両方の環境で ol_migrator を持ち主にすると、確認用の
  // ol_migrator_staging から本番の DB に CONNECT を足す・消すことができてしまう（docs/decisions/0056）
  // ol_migrator には、その DB の public スキーマの USAGE・CREATE だけを付ける（GRANT OPTION つき。マイグレーションが ol_definer に付けるため）
  // superuser でなければ、OWNER の指定と権限の付け替えに ol_owner_<env> への SET が要るので、その間だけ自分に付けて外す
  async #ensureEnvDatabase(name: string, owner: string, logins: string[]): Promise<string[]> {
    if (this.#connector === null) throw new Error("--env では DB につなぎ直すための connector が要る");
    const [me] = await this.#sql.rows<{ rolsuper: boolean }>("SELECT rolsuper FROM pg_roles WHERE rolname = current_user");
    const borrow = me?.rolsuper !== true;
    if (borrow) await this.#sql.rows(await this.#format("GRANT %I TO CURRENT_USER WITH INHERIT FALSE, SET TRUE", [owner]));
    try {
      const [row] = await this.#sql.rows<OwnerRow>("SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname = $1", [name]);
      if (row !== undefined && row.owner !== owner) {
        throw new Error(`DB ${name} の持ち主が ${row.owner} です（${owner} にする）。確認用・本番の DB は消さないので、手で直してください`);
      }
      if (row === undefined) await this.#sql.rows(await this.#format("CREATE DATABASE %I OWNER %I ENCODING 'UTF8' TEMPLATE template0", [name, owner]));
      // 管理用のユーザー（SESSION_USER）にも CONNECT を付ける（この後 public スキーマの権限を付けにつなぐ。どのみち持ち主に SET ROLE できる）
      const grants = logins.map((login) => this.#format("GRANT CONNECT ON DATABASE %I TO %I", [name, login]));
      grants.push(this.#format("GRANT CONNECT ON DATABASE %I TO SESSION_USER", [name]));
      await this.#asRole(this.#sql, owner, [await this.#format("REVOKE CONNECT, TEMPORARY ON DATABASE %I FROM PUBLIC", [name]), ...(await Promise.all(grants))]);
      const session = await this.#connector.connect(name);
      try {
        await this.#asRole(session, owner, [`GRANT USAGE, CREATE ON SCHEMA public TO ${MIGRATOR} WITH GRANT OPTION`]);
      } finally {
        await session.close();
      }
      return [
        `${name}（${row === undefined ? "作った" : "そのまま"}。持ち主は ${owner}）`,
        `${name} の CONNECT（PUBLIC から外し、${logins.join("・")} と管理用のユーザーだけ）`,
        `${name} の public スキーマの USAGE・CREATE → ${MIGRATOR}（GRANT OPTION つき）`,
      ];
    } finally {
      if (borrow) await this.#sql.rows(await this.#format("REVOKE %I FROM CURRENT_USER", [owner]));
    }
  }

  async #asRole(sql: AdminSql, role: string, statements: string[]): Promise<void> {
    await sql.rows(await this.#format("SET ROLE %I", [role]));
    try {
      for (const statement of statements) await sql.rows(statement);
    } finally {
      await sql.rows("RESET ROLE");
    }
  }

  #databaseName(url: string, options: DatabaseOptions): string {
    const { pathname } = new URL(url);
    const name = decodeURIComponent(pathname.slice(1));
    if (name === "") throw new Error("DATABASE_URL に DB 名がない");
    if (options.test && !name.endsWith("_test")) {
      throw new Error(`テスト用 DB は名前が _test で終わるものだけを扱う（DATABASE_URL の DB 名: "${name}"）`);
    }
    if (options.env !== undefined && !name.endsWith(`_${options.env}`)) {
      throw new Error(`--env ${options.env} の DB は名前が _${options.env} で終わるものだけを扱う（DATABASE_URL の DB 名: "${name}"）`);
    }
    return name;
  }

  #expectUser(url: string, role: string, envName: string): void {
    const user = decodeURIComponent(new URL(url).username);
    if (user !== role) throw new Error(`${envName} のユーザーは ${role} にする（今は "${user}"。backend/.env.example 参照）`);
  }

  async #format(template: string, values: string[]): Promise<string> {
    const [row] = await this.#sql.rows<{ sql: string }>("SELECT format($1::text, VARIADIC $2::text[]) AS sql", [template, values]);
    if (row === undefined) throw new Error("format が行を返さなかった");
    return row.sql;
  }
}
