import mysql from "mysql2/promise";
import type { Pool } from "mysql2/promise";

export interface PoolFactory {
  create(): Pool;
}

// 接続先は DATABASE_URL（dbmate と同じ値。backend/.env・.env.test、CI はワークフローで .env.test を作る）
export class MySqlPoolFactory implements PoolFactory {
  readonly #env: NodeJS.ProcessEnv;

  constructor(env: NodeJS.ProcessEnv) {
    this.#env = env;
  }

  create(): Pool {
    const uri = this.#env.DATABASE_URL;
    if (uri === undefined || uri === "") {
      throw new Error("DATABASE_URL が未設定です。backend/.env.example（テストは .env.test.example）を参考に設定してください");
    }
    return mysql.createPool({ uri, connectionLimit: 10, timezone: "Z" });
  }
}
