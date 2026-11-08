// .claude/settings.json の Stop hook（node scripts/stop-hook.ts）。対象のフォルダは引数で変えられる（テスト用。既定はリポジトリのルート）
// 結果は stderr に出す（exit 2 のとき、Claude Code は stderr を Claude に見せる）
import { resolve } from "node:path";
import { ShellCommandRunner } from "./lib/shell-command-runner.ts";
import { StopHook } from "./lib/stop-hook.ts";

const root = resolve(process.argv[2] ?? resolve(import.meta.dirname, ".."));
const { exitCode, message } = new StopHook(root, new ShellCommandRunner(root)).check();
if (message !== "") console.error(message);
process.exit(exitCode);
