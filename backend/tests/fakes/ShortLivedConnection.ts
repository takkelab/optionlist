import pg from "pg";

export interface SqlRunner {
  rows<T>(sql: string, params?: unknown[]): Promise<T[]>;
}

// 1 本の SQL ごとに接続を開いて閉じる。マイグレーションのテストは dbmate で DB を DROP し直すので、
// プールのように接続を残すと DROP DATABASE が「ほかの接続が使っている」で止まる
export class ShortLivedConnection implements SqlRunner {
  readonly #url: string;

  constructor(url: string) {
    this.#url = url;
  }

  async rows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const client = new pg.Client({ connectionString: this.#url, options: "-c TimeZone=UTC" });
    await client.connect();
    try {
      const { rows } = await client.query(sql, params);
      return rows as T[];
    } finally {
      await client.end();
    }
  }
}
