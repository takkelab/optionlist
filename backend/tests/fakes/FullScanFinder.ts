// EXPLAIN の 1 行（table と type の列を見る）
export type PlanRow = Record<string, unknown>;

export interface ScanFinder {
  // EXPLAIN の行のうち、type = ALL で数える表の名前（別名でなく本当の表名）
  fullScans(sql: string, plan: PlanRow[]): string[];
}

// 別名に使わない語（FROM・JOIN の直後の表名に続く語）
const KEYWORDS = new Set(["on", "where", "left", "right", "inner", "join", "group", "order", "limit", "set", "using"]);

// 主要クエリのフルテーブルスキャン（metrics.md §4）を数える。EXPLAIN の table は別名なので、SQL の FROM・JOIN から表名に戻す
// マスターデータの表（提案の一覧の API が全部読む。docs/decisions/0021）は数えない
export class FullScanFinder implements ScanFinder {
  readonly #ignored: ReadonlySet<string>;

  constructor(ignoredTables: string[]) {
    this.#ignored = new Set(ignoredTables);
  }

  fullScans(sql: string, plan: PlanRow[]): string[] {
    const tables = this.#aliases(sql);
    return plan
      .filter((row) => row.type === "ALL")
      .map((row) => String(row.table))
      .map((name) => tables.get(name) ?? name)
      .filter((name) => !this.#ignored.has(name));
  }

  #aliases(sql: string): Map<string, string> {
    const aliases = new Map<string, string>();
    for (const [, table = "", alias] of sql.matchAll(/\b(?:FROM|JOIN)\s+(\w+)(?:\s+(?:AS\s+)?(\w+))?/gi)) {
      aliases.set(table, table);
      if (alias !== undefined && !KEYWORDS.has(alias.toLowerCase())) aliases.set(alias, table);
    }
    return aliases;
  }
}
