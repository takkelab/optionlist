import type { Pool, RowDataPacket } from "mysql2/promise";

export type Snapshot = { columns: string[]; indexes: string[]; foreignKeys: string[]; rowCounts: string[] };

export interface SchemaReader {
  take(): Promise<Snapshot>;
}

interface ColumnRow extends RowDataPacket {
  tableName: string;
  columnName: string;
  columnType: string;
  nullable: string;
  columnDefault: string | null;
  extra: string;
}

interface IndexRow extends RowDataPacket {
  tableName: string;
  indexName: string;
  nonUnique: number;
  columnNames: string;
}

interface ForeignKeyRow extends RowDataPacket {
  tableName: string;
  columnName: string;
  referencedTable: string;
  referencedColumn: string;
  deleteRule: string;
}

interface TableRow extends RowDataPacket {
  tableName: string;
}

interface CountRow extends RowDataPacket {
  n: number;
}

// dbmate の管理表。rollback しても残るので比べない
const IGNORED_TABLE = "schema_migrations";

// information_schema からテーブル・列・索引・外部キーと行数を読み、比べやすい文字列の一覧にする（testing.md §1）
export class SchemaSnapshot implements SchemaReader {
  readonly #pool: Pool;
  readonly #schema: string;

  constructor(pool: Pool, schema: string) {
    this.#pool = pool;
    this.#schema = schema;
  }

  async take(): Promise<Snapshot> {
    return {
      columns: await this.#columns(),
      indexes: await this.#indexes(),
      foreignKeys: await this.#foreignKeys(),
      rowCounts: await this.#rowCounts(),
    };
  }

  async #columns(): Promise<string[]> {
    const [rows] = await this.#pool.query<ColumnRow[]>(
      `SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName, COLUMN_TYPE AS columnType, IS_NULLABLE AS nullable,
              COLUMN_DEFAULT AS columnDefault, EXTRA AS extra
         FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME <> ? ORDER BY TABLE_NAME, ORDINAL_POSITION`,
      [this.#schema, IGNORED_TABLE],
    );
    return rows.map((r) => {
      const nullable = r.nullable === "YES" ? "NULL" : "NOT NULL";
      const fallback = r.columnDefault === null ? "" : ` DEFAULT ${r.columnDefault}`;
      return `${r.tableName}.${r.columnName} ${r.columnType} ${nullable}${fallback} ${r.extra}`.trim();
    });
  }

  async #indexes(): Promise<string[]> {
    const [rows] = await this.#pool.query<IndexRow[]>(
      `SELECT TABLE_NAME AS tableName, INDEX_NAME AS indexName, NON_UNIQUE AS nonUnique,
              GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columnNames
         FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME <> ?
        GROUP BY TABLE_NAME, INDEX_NAME, NON_UNIQUE ORDER BY TABLE_NAME, INDEX_NAME`,
      [this.#schema, IGNORED_TABLE],
    );
    // ORDER BY は照合順序（大文字小文字を区別しない）に左右されるので、JS で並べ直す
    return rows.map((r) => `${r.tableName}.${r.indexName}${r.nonUnique === 0 ? " UNIQUE" : ""} (${r.columnNames})`).sort();
  }

  async #foreignKeys(): Promise<string[]> {
    const [rows] = await this.#pool.query<ForeignKeyRow[]>(
      `SELECT k.TABLE_NAME AS tableName, k.COLUMN_NAME AS columnName, k.REFERENCED_TABLE_NAME AS referencedTable,
              k.REFERENCED_COLUMN_NAME AS referencedColumn, r.DELETE_RULE AS deleteRule
         FROM information_schema.KEY_COLUMN_USAGE k
         JOIN information_schema.REFERENTIAL_CONSTRAINTS r
           ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
        WHERE k.TABLE_SCHEMA = ? ORDER BY k.TABLE_NAME, k.COLUMN_NAME`,
      [this.#schema],
    );
    return rows.map(
      (r) => `${r.tableName}.${r.columnName} -> ${r.referencedTable}.${r.referencedColumn} ON DELETE ${r.deleteRule}`,
    ).sort();
  }

  async #rowCounts(): Promise<string[]> {
    const [tables] = await this.#pool.query<TableRow[]>(
      `SELECT TABLE_NAME AS tableName FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME <> ? ORDER BY TABLE_NAME`,
      [this.#schema, IGNORED_TABLE],
    );
    const counts: string[] = [];
    for (const { tableName } of tables) {
      const [rows] = await this.#pool.query<CountRow[]>("SELECT COUNT(*) AS n FROM ??", [`${this.#schema}.${tableName}`]);
      const [row] = rows;
      counts.push(`${tableName}: ${row?.n ?? 0}`);
    }
    return counts;
  }
}
