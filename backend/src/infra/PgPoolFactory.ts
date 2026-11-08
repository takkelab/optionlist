import pg from "pg";
import type { CustomTypesConfig, Pool } from "pg";

export interface PoolFactory {
  create(): Pool;
}

// 使っていない接続が切れたとき（DB の再起動・メンテナンスなど）のログの出し先
export interface PoolErrorLogger {
  error(message: string, error: unknown): void;
}

export type DatabaseUrlName = "APP_DATABASE_URL" | "DATABASE_URL";

const { types: builtinTypes } = pg;
const INT8_OID = 20;
const DATE_OID = 1082;

// 型の変換（data.md §1）。bigint（ID・COUNT(*)）は number で読む（ID は Number.MAX_SAFE_INTEGER を超えない）。
// date（予定日）は Date にするとタイムゾーンでずれうるので、2026-11-23 の文字列のまま読む。それ以外（timestamptz → Date など）は pg の既定
// pg の types.setTypeParser はプロセス全体を変えるので使わず、このプールにだけ渡す
class AppTypeParsers implements CustomTypesConfig {
  getTypeParser(oid: number, format?: "text" | "binary"): (value: string) => unknown {
    if (oid === INT8_OID) return Number;
    if (oid === DATE_OID) return String;
    return builtinTypes.getTypeParser(oid, format);
  }
}

// 接続先の環境変数の名前を受け取る（data.md §1）。アプリは APP_DATABASE_URL（ol_app。RLS を受ける）、
// テストの後始末と性能用データは DATABASE_URL（ol_migrator。dbmate と同じ値）。backend/.env・.env.test、CI はワークフローで .env.test を作る
// 日時がサーバーの設定で変わらないよう、接続ごとに TimeZone を UTC にする
// プールは、使っていない接続のエラーを error イベントで出す。受け手がないとプロセスごと落ちるので、ログに出すだけにする
// （切れた接続はプールが捨て、次の SQL は新しい接続で流れる。DB に届かなければ /api/health/db が 503 を返す）
export class PgPoolFactory implements PoolFactory {
  readonly #env: NodeJS.ProcessEnv;
  readonly #logger: PoolErrorLogger;
  readonly #urlName: DatabaseUrlName;

  constructor(env: NodeJS.ProcessEnv, logger: PoolErrorLogger, urlName: DatabaseUrlName) {
    this.#env = env;
    this.#logger = logger;
    this.#urlName = urlName;
  }

  create(): Pool {
    const connectionString = this.#env[this.#urlName];
    if (connectionString === undefined || connectionString === "") {
      throw new Error(`${this.#urlName} が未設定です。backend/.env.example（テストは .env.test.example）を参考に設定してください`);
    }
    const pool = new pg.Pool({ connectionString, max: 10, options: "-c TimeZone=UTC", types: new AppTypeParsers() });
    pool.on("error", (error) => this.#logger.error("DB の接続が切れた（使っていない接続）", error));
    return pool;
  }
}
