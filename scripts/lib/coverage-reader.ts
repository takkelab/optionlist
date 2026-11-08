import type { FileSource } from "./types.ts";

export interface CoverageSummary {
  lines: number;
  branches: number;
  totalLines: number;
}

export interface CoverageReader {
  // vitest の json-summary を読む。ファイルがなければ null
  read(summaryPath: string): CoverageSummary | null;
}

interface CoverageTotal {
  total: { lines: { pct: number; total: number }; branches: { pct: number; total: number } };
}

export class JsonCoverageReader implements CoverageReader {
  readonly #files: FileSource;

  constructor(files: FileSource) {
    this.#files = files;
  }

  read(summaryPath: string): CoverageSummary | null {
    if (!this.#files.exists(summaryPath)) return null;
    const { total } = JSON.parse(this.#files.read(summaryPath)) as CoverageTotal;
    // 分岐が 1 つもないときは istanbul が "Unknown" を返すので 100% とみなす
    const branches = typeof total.branches.pct === "number" ? total.branches.pct : 100;
    return { lines: total.lines.pct, branches, totalLines: total.lines.total };
  }
}
