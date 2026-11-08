export interface ScanFinder {
  // EXPLAIN (FORMAT JSON) の結果のうち、Seq Scan で読む表の名前（別名でなく本当の表名）
  fullScans(plan: unknown): string[];
}

type PlanNode = { "Node Type"?: unknown; "Relation Name"?: unknown; Plans?: unknown };

// 主要クエリのフルテーブルスキャン（metrics.md §4）を数える。EXPLAIN の木（Plan とその Plans）を全部たどる
// マスターデータの表（提案の一覧の API が全部読む。docs/decisions/0021）は数えない
export class FullScanFinder implements ScanFinder {
  readonly #ignored: ReadonlySet<string>;

  constructor(ignoredTables: string[]) {
    this.#ignored = new Set(ignoredTables);
  }

  // FORMAT JSON の結果は [{ Plan: {...} }] の形
  fullScans(plan: unknown): string[] {
    const roots = Array.isArray(plan) ? plan.map((entry: unknown) => this.#field(entry, "Plan")) : [];
    return roots.flatMap((node) => this.#scans(node)).filter((name) => !this.#ignored.has(name));
  }

  #scans(node: unknown): string[] {
    if (typeof node !== "object" || node === null) return [];
    const { "Node Type": type, "Relation Name": relation, Plans: children }: PlanNode = node;
    const own = type === "Seq Scan" && typeof relation === "string" ? [relation] : [];
    const nested = Array.isArray(children) ? children.flatMap((child: unknown) => this.#scans(child)) : [];
    return [...own, ...nested];
  }

  #field(value: unknown, key: string): unknown {
    return typeof value === "object" && value !== null && key in value ? (value as Record<string, unknown>)[key] : undefined;
  }
}
