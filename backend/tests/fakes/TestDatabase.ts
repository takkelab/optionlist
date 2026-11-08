import type { Pool } from "pg";

export interface DataReset {
  reset(): Promise<void>;
}

// マスターデータ（themes・tags・suggestions・suggestion_tags）以外のテーブル
const DATA_TABLES = ["achievements", "events", "options"];

// API テストの前にテスト用 DB のデータを空にする（testing.md §2）。マスターデータは残す
// 外部キーでつながった表は 1 本の TRUNCATE にまとめて消す。ID も 1 から振り直す（テストが ID に頼れるように）
export class TestDatabase implements DataReset {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async reset(): Promise<void> {
    await this.#pool.query(`TRUNCATE TABLE ${DATA_TABLES.join(", ")} RESTART IDENTITY`);
  }
}
