import pg from "pg";
import type { CustomTypesConfig, Pool } from "pg";

export interface PoolFactory {
  create(): Pool;
}

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

// 接続先は DATABASE_URL（dbmate と同じ値。backend/.env・.env.test、CI はワークフローで .env.test を作る）
// 日時がサーバーの設定で変わらないよう、接続ごとに TimeZone を UTC にする
export class PgPoolFactory implements PoolFactory {
  readonly #env: NodeJS.ProcessEnv;

  constructor(env: NodeJS.ProcessEnv) {
    this.#env = env;
  }

  create(): Pool {
    const connectionString = this.#env.DATABASE_URL;
    if (connectionString === undefined || connectionString === "") {
      throw new Error("DATABASE_URL が未設定です。backend/.env.example（テストは .env.test.example）を参考に設定してください");
    }
    return new pg.Pool({ connectionString, max: 10, options: "-c TimeZone=UTC", types: new AppTypeParsers() });
  }
}
