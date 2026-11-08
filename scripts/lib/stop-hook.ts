import { existsSync } from "node:fs";
import { join } from "node:path";
import type { CommandRunner } from "./types.ts";

// Stop hook の結果。exitCode 2 は Claude Code にターンを終えさせず、message を見せる
export type HookResult = { exitCode: 0 | 2; message: string };

export interface TurnEndCheck {
  check(): HookResult;
}

// 依存を入れるフォルダ（CLAUDE.md の Commands の「初回」）
const PACKAGE_DIRS = [".", "backend", "frontend"];

// ターンの終わりに型チェックを流す（.claude/settings.json の Stop hook）。
// 依存が入っていないと tsc が見つからないという cmd のエラー（Shift_JIS で文字化け）になり、原因が分かりにくいので、
// 先に node_modules を確かめ、なければ初回の手順を流すよう言って止まる（docs/harness/incidents.md #18）
export class StopHook implements TurnEndCheck {
  readonly #root: string;
  readonly #runner: CommandRunner;

  constructor(root: string, runner: CommandRunner) {
    this.#root = root;
    this.#runner = runner;
  }

  check(): HookResult {
    const missing = PACKAGE_DIRS.filter((dir) => !existsSync(join(this.#root, dir, "node_modules")));
    if (missing.length > 0) {
      const where = missing.map((dir) => (dir === "." ? "ルート" : dir)).join("・");
      return {
        exitCode: 2,
        message: [
          `依存が入っていない（${where} に node_modules がない）。型チェックはまだ流せない。`,
          "CLAUDE.md の初回の手順を流す: npm install / npm --prefix backend install / npm --prefix frontend install / npx playwright install chromium",
        ].join("\n"),
      };
    }
    const { exitCode, output } = this.#runner.run("npm run -s typecheck");
    return exitCode === 0 ? { exitCode: 0, message: "" } : { exitCode: 2, message: output };
  }
}
