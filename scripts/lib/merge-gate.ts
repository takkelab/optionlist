export interface CheckRun {
  name: string;
  status: string;
  conclusion: string;
  startedAt: string;
}

export interface MergeGate {
  // マージしてはいけない理由を返す。なければ空配列
  blockers(checks: CheckRun[]): string[];
}

// docs/decisions/0004。private の Free プランではブランチ保護が使えないので、マージの前にこれで CI を確かめる
// 同じコミットに同じ名前のチェックが何度も走る（push と pull_request、PR 本文の編集）ので、
// 名前ごとに SKIPPED を除いた最新の実行だけを見る
export class RequiredChecksMergeGate implements MergeGate {
  readonly #required: string[];

  constructor(required: string[]) {
    this.#required = required;
  }

  blockers(checks: CheckRun[]): string[] {
    const running = checks.filter((c) => c.status !== "COMPLETED").map((c) => `${c.name} が実行中`);
    const results = this.#required.map((name) => {
      const latest = checks
        .filter((c) => c.name === name && c.status === "COMPLETED" && c.conclusion !== "SKIPPED")
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
      if (latest === undefined) return `${name} の結果がない`;
      return latest.conclusion === "SUCCESS" ? null : `${name} が ${latest.conclusion}`;
    });
    return [...running, ...results.filter((r) => r !== null)];
  }
}
