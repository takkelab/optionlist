// data.md §4 のロールと、マイグレーションを流す DB を用意する（npm --prefix backend run db:roles / db:roles:test）
// ロールはクラスタ全体のものなので、マイグレーション（DB ごと）ではなく、superuser（ADMIN_DATABASE_URL）でここで作る
// 何度流しても同じ結果になる。表の権限・ポリシー・関数はマイグレーションで付ける

export interface AdminSql {
  rows<T>(sql: string, params?: unknown[]): Promise<T[]>;
}

export type RoleUrls = {
  // ol_migrator（dbmate）。この URL の DB を ol_migrator の持ち物として用意する
  migrator: string;
  // ol_app（アプリ）
  app: string;
  // ol_cleanup・ol_metrics（R9・R10 で使う）。なければパスワードを付けない
  cleanup?: string;
  metrics?: string;
};

export type DatabaseOptions = {
  // 持ち主が ol_migrator でない DB を消して作り直す
  recreate: boolean;
  // テスト用 DB（名前が _test で終わる）だけを扱い、持ち主にかかわらずいつも作り直す（別のブランチのマイグレーションの表を残さない）
  // マイグレーションのテストの <名前>_migrations も消す
  test: boolean;
};

// never: 持ち主が違えば止まる / foreign: 持ち主が違えば消す / always: いつも消す
type DropWhen = "never" | "foreign" | "always";

export interface RoleInstaller {
  install(urls: RoleUrls, options: DatabaseOptions): Promise<string[]>;
}

type RoleSpec = { name: string; login: boolean; createdb: boolean; url?: string };
type OwnerRow = { owner: string };

const MIGRATOR = "ol_migrator";
const APP = "ol_app";

export class RoleSetup implements RoleInstaller {
  readonly #sql: AdminSql;

  constructor(sql: AdminSql) {
    this.#sql = sql;
  }

  // してきたことを 1 行ずつ返す（エントリーポイントが表示する）
  async install(urls: RoleUrls, options: DatabaseOptions): Promise<string[]> {
    this.#expectUser(urls.migrator, MIGRATOR, "DATABASE_URL");
    this.#expectUser(urls.app, APP, "APP_DATABASE_URL");
    const done: string[] = [];
    for (const spec of this.#specs(urls)) done.push(await this.#ensureRole(spec));
    // 関数とビューの持ち主を ol_definer にするために SET ROLE だけができる（権限は引き継がない。data.md §4）
    await this.#sql.rows(`GRANT ol_definer TO ${MIGRATOR} WITH INHERIT FALSE, SET TRUE`);
    done.push("ol_definer → ol_migrator（INHERIT FALSE, SET TRUE）");
    const name = this.#databaseName(urls.migrator, options);
    const dropWhen: DropWhen = options.test ? "always" : options.recreate ? "foreign" : "never";
    done.push(await this.#ensureDatabase(name, dropWhen, true));
    if (options.test) done.push(await this.#ensureDatabase(`${name}_migrations`, "always", false));
    return done;
  }

  #specs(urls: RoleUrls): RoleSpec[] {
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

  // 名前とパスワードは識別子・文字列として format で引用してから流す（ALTER ROLE はプレースホルダを取れない）
  async #ensureRole(spec: RoleSpec): Promise<string> {
    const exists = await this.#sql.rows("SELECT 1 FROM pg_roles WHERE rolname = $1", [spec.name]);
    if (exists.length === 0) await this.#sql.rows(await this.#format("CREATE ROLE %I", [spec.name]));
    const flags = `${spec.login ? "LOGIN" : "NOLOGIN"} ${spec.createdb ? "CREATEDB" : "NOCREATEDB"} NOSUPERUSER NOCREATEROLE NOREPLICATION NOBYPASSRLS`;
    await this.#sql.rows(await this.#format(`ALTER ROLE %I ${flags}`, [spec.name]));
    const password = spec.url === undefined ? "" : decodeURIComponent(new URL(spec.url).password);
    if (password !== "") await this.#sql.rows(await this.#format("ALTER ROLE %I PASSWORD %L", [spec.name, password]));
    return `${spec.name}（${flags}${password === "" ? "" : "、パスワードあり"}）`;
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

  #databaseName(url: string, options: DatabaseOptions): string {
    const { pathname } = new URL(url);
    const name = decodeURIComponent(pathname.slice(1));
    if (name === "") throw new Error("DATABASE_URL に DB 名がない");
    if (options.test && !name.endsWith("_test")) {
      throw new Error(`テスト用 DB は名前が _test で終わるものだけを扱う（DATABASE_URL の DB 名: "${name}"）`);
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
