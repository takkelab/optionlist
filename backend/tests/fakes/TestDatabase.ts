import type { Pool } from "mysql2/promise";

export interface DataReset {
  reset(): Promise<void>;
}

// マスターデータ（themes・tags・suggestions・suggestion_tags）以外のテーブル。子のテーブルから並べる
const DATA_TABLES = ["achievements", "events", "options"];

// API テストの前にテスト用 DB のデータを空にする（testing.md §2）。マスターデータは残す
// FOREIGN_KEY_CHECKS は接続ごとの設定なので、1 本の接続で TRUNCATE する
export class TestDatabase implements DataReset {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async reset(): Promise<void> {
    const connection = await this.#pool.getConnection();
    try {
      await connection.query("SET FOREIGN_KEY_CHECKS = 0");
      for (const table of DATA_TABLES) {
        await connection.query("TRUNCATE TABLE ??", [table]);
      }
      await connection.query("SET FOREIGN_KEY_CHECKS = 1");
    } finally {
      // FK チェックを止めたまま pool に戻さないよう、途中で失敗した接続は捨てる
      connection.destroy();
    }
  }
}
