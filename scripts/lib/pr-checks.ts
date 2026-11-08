export interface ChangedFile {
  status: string;
  path: string;
}

export interface PrCheck {
  // 問題があればその説明を返す。なければ空配列
  check(body: string, changes: ChangedFile[]): string[];
}

const INCIDENT_HEADING = "詰まった点と再発防止策";

// process.md §2-5。PR 本文の「詰まった点と再発防止策」が空なら失敗（なければ「なし」と書く）
export class IncidentSectionCheck implements PrCheck {
  check(body: string): string[] {
    const lines = body.replace(/<!--[\s\S]*?-->/g, "").split(/\r?\n/);
    const start = lines.findIndex((line) => /^#{1,6}\s/.test(line) && line.includes(INCIDENT_HEADING));
    if (start === -1) return [`PR 本文に「## ${INCIDENT_HEADING}」の見出しがない`];
    const rest = lines.slice(start + 1);
    const end = rest.findIndex((line) => /^#{1,6}\s/.test(line));
    const content = (end === -1 ? rest : rest.slice(0, end)).join("\n").trim();
    if (content === "") return [`「${INCIDENT_HEADING}」が空（なければ「なし」と書く）`];
    return [];
  }
}

const CONFIG_FILE = "metrics.config.json";
const DECISION_FILE = /^docs\/decisions\/\d{4}-[^/]+\.md$/;

// process.md §3。目標値（metrics.config.json）を変えたら docs/decisions/ に記録を追加する
export class DecisionRecordCheck implements PrCheck {
  check(_body: string, changes: ChangedFile[]): string[] {
    if (!changes.some((c) => c.path === CONFIG_FILE)) return [];
    if (changes.some((c) => c.status.startsWith("A") && DECISION_FILE.test(c.path))) return [];
    return [`${CONFIG_FILE} を変えたのに docs/decisions/NNNN-*.md の追加がない`];
  }
}

export interface ChangedFileParser {
  parse(output: string): ChangedFile[];
}

// `git diff --name-status` の出力を読む（リネームは新しいパスを使う）
export class GitNameStatusParser implements ChangedFileParser {
  parse(output: string): ChangedFile[] {
    return output
      .split(/\r?\n/)
      .filter((line) => line.trim() !== "")
      .map((line) => {
        const [status, ...paths] = line.split("\t");
        return { status, path: paths[paths.length - 1] };
      });
  }
}
