// npm run pr:merge -- <PR 番号>。CI（quality・pr-check・image）がすべて緑のときだけマージする（docs/decisions/0004）
// 確かめたコミットのままマージするよう --match-head-commit を付ける
// この PR のブランチへ積んだ PR は、マージの前に向き先をこの PR の base へ付け替える（docs/harness/incidents.md #11）
import { GhCliCheck } from "./lib/gh-cli-check.ts";
import type { CheckRun } from "./lib/merge-gate.ts";
import { RequiredChecksMergeGate } from "./lib/merge-gate.ts";
import { ShellCommandRunner } from "./lib/shell-command-runner.ts";
import { GhStackedPrRetargeter } from "./lib/stacked-prs.ts";

const pr = process.argv[2];
if (pr === undefined || !/^\d+$/.test(pr)) {
  console.error("使い方: npm run pr:merge -- <PR 番号>");
  process.exit(1);
}

const runner = new ShellCommandRunner(process.cwd());
const ghProblem = new GhCliCheck(runner).problem();
if (ghProblem !== null) {
  console.error(ghProblem);
  process.exit(1);
}
const view = runner.run(`gh pr view ${pr} --json headRefOid,headRefName,baseRefName,statusCheckRollup`);
if (view.exitCode !== 0) {
  console.error(view.output);
  process.exit(1);
}
const { headRefOid, headRefName, baseRefName, statusCheckRollup } = JSON.parse(view.output) as {
  headRefOid: string;
  headRefName: string;
  baseRefName: string;
  statusCheckRollup: CheckRun[];
};

const blockers = new RequiredChecksMergeGate(["quality", "pr-check", "image"]).blockers(statusCheckRollup);
if (blockers.length > 0) {
  for (const blocker of blockers) console.error(`❌ ${blocker}`);
  console.error("CI が緑になるまでマージしない");
  process.exit(1);
}

// マージでこの PR のブランチを消すと、そこへ積んだ PR が閉じられるので、先に向き先を付け替える
const stacked = new GhStackedPrRetargeter(runner).retarget(headRefName, baseRefName);
for (const n of stacked.retargeted) console.log(`↪ 積み重ねた #${n} の向き先を ${baseRefName} に変えた`);
if (stacked.problem !== null) {
  console.error(`❌ ${stacked.problem}`);
  console.error("積み重ねた PR が閉じられないよう、マージしない");
  process.exit(1);
}

console.log(`✅ CI はすべて緑（${headRefOid.slice(0, 7)}）。マージする`);
const merge = runner.run(`gh pr merge ${pr} --merge --delete-branch --match-head-commit ${headRefOid}`);
console.log(merge.output);
process.exit(merge.exitCode);
