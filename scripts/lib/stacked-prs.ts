import type { CommandRunner } from "./types.ts";

export type RetargetResult = { retargeted: number[]; problem: string | null };

export interface StackedPrRetargeter {
  // head ブランチに向けて積んだ開いている PR を、base に向け直す。1 つでも失敗したら problem に理由を入れる
  retarget(head: string, base: string): RetargetResult;
}

// 積み重ねた PR（土台の PR のブランチに向けた PR）は、土台をマージしてブランチを消すと GitHub に閉じられ、
// 閉じた PR は向き先を変えられない（docs/harness/incidents.md #11）。マージの前に向き先を土台の base へ付け替える
export class GhStackedPrRetargeter implements StackedPrRetargeter {
  readonly #runner: CommandRunner;

  constructor(runner: CommandRunner) {
    this.#runner = runner;
  }

  retarget(head: string, base: string): RetargetResult {
    const list = this.#runner.run(`gh pr list --base ${head} --state open --json number`);
    if (list.exitCode !== 0) return { retargeted: [], problem: `積み重ねた PR を探せなかった: ${list.output}` };
    const numbers = (JSON.parse(list.output) as { number: number }[]).map((pr) => pr.number);
    const retargeted: number[] = [];
    for (const n of numbers) {
      const edit = this.#runner.run(`gh pr edit ${n} --base ${base}`);
      if (edit.exitCode !== 0) return { retargeted, problem: `#${n} の向き先を ${base} に変えられなかった: ${edit.output}` };
      retargeted.push(n);
    }
    return { retargeted, problem: null };
  }
}
