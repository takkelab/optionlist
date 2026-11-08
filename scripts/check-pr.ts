// PR の検査（testing.md §6 の 8）。CI の pr-check ジョブから実行する
// 環境変数: PR_BODY（PR 本文）、BASE_SHA（比較元のコミット）
import { DecisionRecordCheck, GitNameStatusParser, IncidentSectionCheck } from "./lib/pr-checks.ts";
import { ShellCommandRunner } from "./lib/shell-command-runner.ts";

const body = process.env.PR_BODY ?? "";
const base = process.env.BASE_SHA ?? "origin/main";

const diff = new ShellCommandRunner(process.cwd()).run(`git diff --no-renames --name-status ${base}...HEAD`);
if (diff.exitCode !== 0) {
  console.error(diff.output);
  process.exit(1);
}
const changes = new GitNameStatusParser().parse(diff.output);

const errors = [new IncidentSectionCheck(), new DecisionRecordCheck()].flatMap((c) => c.check(body, changes));
for (const error of errors) console.error(`❌ ${error}`);
if (errors.length === 0) console.log("✅ PR の検査に合格");
process.exit(errors.length === 0 ? 0 : 1);
