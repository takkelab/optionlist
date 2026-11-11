import { spawn } from "node:child_process";
import { PassThrough } from "node:stream";
import type { Readable } from "node:stream";

export interface DumpSource {
  // 書き出しの中身。pg_dump が終了コード 0 で終わったときだけ正しく終わり、失敗したらエラーで壊れる
  dump(): Readable;
  // 書き出す DB の名前（ファイル名に使う）
  database(): string;
}

export type PgConnection = { host: string; port: string; user: string; password: string; database: string; sslmode: string };

// pg_dump を起動する方法（テストでは node で代わりの出力を出す）
export type DumpProgram = { command: string; args: string[] };

// DATABASE_URL（postgres://ユーザー:パスワード@ホスト:ポート/DB?host=…&sslmode=…）を libpq の環境変数の値に分ける
// 確認用・本番はホストが空で、Unix ソケットを ?host=/cloudsql/… で渡す（infra/config.ts の socketDatabaseUrl）。WHATWG の URL では読めないので文字列で分ける
export class PgConnectionParser implements ConnectionParser {
  parse(url: string): PgConnection {
    const match = /^postgres(?:ql)?:\/\/([^:@/]*):([^@]*)@([^/?]*)\/([^?]+)(?:\?(.*))?$/.exec(url);
    if (match === null) throw new Error("DATABASE_URL の形が違う（postgres://ユーザー:パスワード@ホスト/DB）");
    const [, user = "", password = "", hostPort = "", database = "", query = ""] = match;
    const params = new URLSearchParams(query);
    const [host = "", port = ""] = hostPort.split(":");
    return {
      host: params.get("host") ?? host,
      port: params.get("port") ?? port,
      user: decodeURIComponent(user),
      password: decodeURIComponent(password),
      database: decodeURIComponent(database),
      sslmode: params.get("sslmode") ?? "",
    };
  }
}

export interface ConnectionParser {
  parse(url: string): PgConnection;
}

// pg_dump --format=custom --enable-row-security で 1 つの DB を書き出す（data.md §6）
// 接続先は環境変数（PGPASSWORD など）で渡し、パスワードをコマンドラインに出さない
// 中身は PassThrough に流し、pg_dump が 0 で終わったと分かってから終える。失敗なら壊すので、書き込み先は途中までのファイルを確定しない
export class PgDump implements DumpSource {
  readonly #connection: PgConnection;
  readonly #program: DumpProgram;

  readonly #baseEnv: NodeJS.ProcessEnv;

  // baseEnv: 子のプロセスに引き継ぐ環境（接続先の値はこの上に重ねる）。BackupEntry は受け取った環境を渡す
  constructor(
    connection: PgConnection,
    program: DumpProgram = { command: "pg_dump", args: ["--format=custom", "--enable-row-security", "--no-password"] },
    baseEnv: NodeJS.ProcessEnv = process.env,
  ) {
    this.#connection = connection;
    this.#program = program;
    this.#baseEnv = baseEnv;
  }

  database(): string {
    return this.#connection.database;
  }

  dump(): Readable {
    const { host, port, user, password, database, sslmode } = this.#connection;
    // 空の値は渡さない（libpq は空でも「設定あり」と読み、PGSSLMODE="" などで止まる）
    const values = { PGHOST: host, PGPORT: port, PGUSER: user, PGPASSWORD: password, PGDATABASE: database, PGSSLMODE: sslmode };
    const env = { ...this.#baseEnv, ...Object.fromEntries(Object.entries(values).filter(([, value]) => value !== "")) };
    const child = spawn(this.#program.command, this.#program.args, { env, stdio: ["ignore", "pipe", "pipe"] });
    const { stdout, stderr: errors } = child;
    const out = new PassThrough();
    let stderr = "";
    errors.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    stdout.pipe(out, { end: false });
    child.once("error", (error) => out.destroy(error));
    child.once("close", (code) => {
      if (code === 0) out.end();
      else out.destroy(new Error(`pg_dump が終了コード ${code} で終わった: ${stderr.trim().slice(0, 500)}`));
    });
    return out;
  }
}
